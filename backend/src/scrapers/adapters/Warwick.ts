import axios from 'axios';
import * as cheerio from 'cheerio';
import * as stringSimilarity from 'string-similarity';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

const DEBUG = true;
const FETCH_TIMEOUT_MS = 20000;

const WARWICK_PG_TAUGHT_FEES_URL = 'https://warwick.ac.uk/services/finance/studentfinance/fees/postgraduatefees/';
const WARWICK_UG_HOME_FEES_URL = 'https://warwick.ac.uk/services/academicoffice/finance/fees/ugtuitionfees2017onwards';
const WARWICK_UG_INTL_FEES_URL = 'https://warwick.ac.uk/services/finance/studentfinance/fees/overseasfees/';

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9'
};

type WarwickLevelHint = 'pg' | 'ug' | 'unknown';
type WarwickFeeStatus = 'home' | 'intl' | 'all' | 'unknown';

interface WarwickPgGroup {
    title: string;
    normalizedTitle: string;
    courseCode: string;
    intensity: string;
    normalizedIntensity: string;
    qualification: string;
    isNowClosed: boolean;
    homeByYear: Map<number, number>;
    intlByYear: Map<number, number>;
}

interface WarwickUgRow {
    title: string;
    normalizedTitle: string;
    courseCode: string;
    qualification: string;
    isFoundation: boolean;
    feesByYear: Map<number, number>;
}

function debug(msg: string): void {
    if (DEBUG) Logger.debug(`[DEBUG] Warwick: ${msg}`);
}

export class WarwickAdapter extends GenericHtmlAdapter {
    private pgGroupsPromise: Promise<WarwickPgGroup[]> | null = null;
    private ugHomeRowsPromise: Promise<WarwickUgRow[]> | null = null;
    private ugIntlRowsPromise: Promise<WarwickUgRow[]> | null = null;
    private contextFeeCache = new Map<string, ScrapedFees | null>();

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const normalizedUrl = this.normalizeIncomingUrl(courseUrl);
        const unresolved: ScrapeContext[] = [];
        const resolvedByOption = new Map<string, OptionScrapeResult>();

        for (const context of contexts) {
            const centralFees = await this.resolveFromCentralTables(context, normalizedUrl);
            if (centralFees && this.hasAnyFee(centralFees)) {
                resolvedByOption.set(context.optionId, {
                    optionId: context.optionId,
                    homeFee: centralFees.homeFee ?? null,
                    internationalFee: centralFees.internationalFee ?? null
                });
            } else {
                unresolved.push(context);
            }
        }

        if (unresolved.length > 0 && normalizedUrl && !this.isLikelyLoginUrl(normalizedUrl)) {
            const fallbackResults = await super.scrapeCourse(normalizedUrl, unresolved);
            for (const result of fallbackResults) {
                resolvedByOption.set(result.optionId, result);
            }
        }

        return contexts.map(context => {
            const resolved = resolvedByOption.get(context.optionId);
            if (resolved) return resolved;
            return {
                optionId: context.optionId,
                homeFee: null,
                internationalFee: null
            };
        });
    }

    private async resolveFromCentralTables(context: ScrapeContext, normalizedUrl: string): Promise<ScrapedFees | null> {
        const levelHint = this.inferLevelHint(normalizedUrl, context);
        const cacheKey = [
            levelHint,
            this.normalizeTitle(context.courseTitle),
            this.normalizeMode(context.studyMode || ''),
            String(context.year || ''),
            this.normalizeQualification(context.outcomeQualification || '')
        ].join('|');

        if (this.contextFeeCache.has(cacheKey)) {
            return this.contextFeeCache.get(cacheKey) || null;
        }

        let fees: ScrapedFees | null = null;

        if (levelHint === 'pg') {
            fees = await this.lookupPgFees(context);
        } else if (levelHint === 'ug') {
            fees = await this.lookupUgFees(context);
        } else {
            fees = await this.lookupPgFees(context);
            if (!this.hasAnyFee(fees)) {
                fees = await this.lookupUgFees(context);
            }
        }

        if (!this.hasAnyFee(fees)) {
            fees = null;
        }

        this.contextFeeCache.set(cacheKey, fees);
        return fees;
    }

    private async lookupPgFees(context: ScrapeContext): Promise<ScrapedFees | null> {
        const groups = await this.getPgGroups();
        if (groups.length === 0) return null;

        const bestGroup = this.findBestPgGroup(context, groups);
        if (!bestGroup) return null;

        const targetYear = Number(context.year);
        const homeFee = this.pickYearFee(bestGroup.homeByYear, targetYear);
        const internationalFee = this.pickYearFee(bestGroup.intlByYear, targetYear);

        if (homeFee === null && internationalFee === null) return null;

        debug(
            `Resolved PG table fees for "${context.courseTitle}" (${targetYear || 'n/a'}) ` +
            `-> Home £${homeFee}, Intl £${internationalFee}`
        );

        return { homeFee, internationalFee };
    }

    private async lookupUgFees(context: ScrapeContext): Promise<ScrapedFees | null> {
        const [homeRows, intlRows] = await Promise.all([
            this.getUgHomeRows(),
            this.getUgIntlRows()
        ]);

        if (homeRows.length === 0 && intlRows.length === 0) {
            return null;
        }

        const bestHome = this.findBestUgRow(context, homeRows);
        const bestIntl = this.findBestUgIntlRow(context, bestHome, intlRows);

        const targetYear = Number(context.year);
        const homeFee = bestHome ? this.pickYearFee(bestHome.feesByYear, targetYear) : null;
        const internationalFee = bestIntl ? this.pickYearFee(bestIntl.feesByYear, targetYear) : null;

        if (homeFee === null && internationalFee === null) return null;

        debug(
            `Resolved UG table fees for "${context.courseTitle}" (${targetYear || 'n/a'}) ` +
            `-> Home £${homeFee}, Intl £${internationalFee}`
        );

        return { homeFee, internationalFee };
    }

    private async getPgGroups(): Promise<WarwickPgGroup[]> {
        if (!this.pgGroupsPromise) {
            this.pgGroupsPromise = this.loadPgGroups();
        }
        return this.pgGroupsPromise;
    }

    private async getUgHomeRows(): Promise<WarwickUgRow[]> {
        if (!this.ugHomeRowsPromise) {
            this.ugHomeRowsPromise = this.loadUgRows(WARWICK_UG_HOME_FEES_URL);
        }
        return this.ugHomeRowsPromise;
    }

    private async getUgIntlRows(): Promise<WarwickUgRow[]> {
        if (!this.ugIntlRowsPromise) {
            this.ugIntlRowsPromise = this.loadUgRows(WARWICK_UG_INTL_FEES_URL);
        }
        return this.ugIntlRowsPromise;
    }

    private async loadPgGroups(): Promise<WarwickPgGroup[]> {
        try {
            const html = await this.fetchHtml(WARWICK_PG_TAUGHT_FEES_URL);
            const $ = cheerio.load(html);
            const table = $('table').first();
            if (!table.length) return [];

            const headers = this.readCells($, $(table).find('tr').first());
            const yearColumns = this.extractYearColumns(headers);
            if (yearColumns.size === 0) return [];

            const groups = new Map<string, WarwickPgGroup>();

            $(table).find('tr').slice(1).each((_idx, row) => {
                const cells = this.readCells($, $(row));
                if (cells.length < 7) return;

                const title = cells[0] || '';
                const courseCode = cells[1] || '';
                const intensity = cells[2] || '';
                const feeStatusRaw = cells[3] || '';
                const feeStatus = this.normalizeFeeStatus(feeStatusRaw);

                if (!this.isRealCourseTitle(title) || feeStatus === 'unknown') return;

                const key = [
                    this.normalizeTitle(title),
                    courseCode.toLowerCase(),
                    this.normalizeMode(intensity)
                ].join('|');

                if (!groups.has(key)) {
                    groups.set(key, {
                        title,
                        normalizedTitle: this.normalizeTitle(title),
                        courseCode,
                        intensity,
                        normalizedIntensity: this.normalizeMode(intensity),
                        qualification: this.normalizeQualification(title),
                        isNowClosed: /now closed/i.test(title),
                        homeByYear: new Map<number, number>(),
                        intlByYear: new Map<number, number>()
                    });
                }

                const group = groups.get(key)!;
                for (const [columnIndex, year] of yearColumns.entries()) {
                    const amount = this.extractAmount(cells[columnIndex]);
                    if (amount === null) continue;

                    if (feeStatus === 'home' || feeStatus === 'all') {
                        group.homeByYear.set(year, amount);
                    }
                    if (feeStatus === 'intl' || feeStatus === 'all') {
                        group.intlByYear.set(year, amount);
                    }
                }
            });

            const out = Array.from(groups.values());
            debug(`Loaded ${out.length} PG fee groups from Warwick central table.`);
            return out;
        } catch (error) {
            debug(`Failed loading PG fee table: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    private async loadUgRows(url: string): Promise<WarwickUgRow[]> {
        try {
            const html = await this.fetchHtml(url);
            const $ = cheerio.load(html);
            const rows: WarwickUgRow[] = [];

            $('table').each((_idx, table) => {
                const headerCells = this.readCells($, $(table).find('tr').first()).map(cell => cell.toLowerCase());
                if (!headerCells.some(cell => cell.includes('course'))) return;
                if (!headerCells.some(cell => cell.includes('ucas'))) return;

                const yearColumns = this.extractYearColumns(headerCells);
                if (yearColumns.size === 0) return;

                $(table).find('tr').slice(1).each((__idx, row) => {
                    const cells = this.readCells($, $(row));
                    if (cells.length < 4) return;

                    const title = cells[0] || '';
                    const courseCode = cells[1] || '';
                    if (!this.isRealCourseTitle(title)) return;
                    if (!/[a-z]/i.test(courseCode)) return;

                    const feesByYear = new Map<number, number>();
                    for (const [columnIndex, year] of yearColumns.entries()) {
                        const amount = this.extractAmount(cells[columnIndex]);
                        if (amount !== null) {
                            feesByYear.set(year, amount);
                        }
                    }

                    if (feesByYear.size === 0) return;

                    rows.push({
                        title,
                        normalizedTitle: this.normalizeTitle(title),
                        courseCode,
                        qualification: this.normalizeQualification(title),
                        isFoundation: /foundation/i.test(title),
                        feesByYear
                    });
                });
            });

            debug(`Loaded ${rows.length} UG rows from ${url}.`);
            return rows;
        } catch (error) {
            debug(`Failed loading UG table (${url}): ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    private findBestPgGroup(context: ScrapeContext, groups: WarwickPgGroup[]): WarwickPgGroup | null {
        const targetVariants = this.buildTitleVariants(context.courseTitle);
        const targetMode = this.normalizeMode(context.studyMode || '');
        const targetQualification = this.normalizeQualification(context.outcomeQualification || '');

        let best: WarwickPgGroup | null = null;
        let bestScore = -1;

        for (const group of groups) {
            let score = this.scoreAgainstVariants(targetVariants, group.normalizedTitle);

            if (group.isNowClosed) score -= 0.2;

            if (targetMode) {
                if (targetMode === group.normalizedIntensity) score += 0.25;
                else if (group.normalizedIntensity) score -= 0.08;
            }

            if (targetQualification) {
                if (group.qualification === targetQualification) score += 0.28;
                else if (group.qualification) score -= 0.1;
            }

            if (score > bestScore) {
                bestScore = score;
                best = group;
            }
        }

        if (!best || bestScore < 0.48) {
            return null;
        }
        return best;
    }

    private findBestUgRow(context: ScrapeContext, rows: WarwickUgRow[]): WarwickUgRow | null {
        if (rows.length === 0) return null;

        const targetVariants = this.buildTitleVariants(context.courseTitle);
        const targetQualification = this.normalizeQualification(context.outcomeQualification || '');
        const targetIsFoundation = /foundation/i.test(context.courseTitle);

        let best: WarwickUgRow | null = null;
        let bestScore = -1;

        for (const row of rows) {
            let score = this.scoreAgainstVariants(targetVariants, row.normalizedTitle);

            if (targetIsFoundation && row.isFoundation) score += 0.15;
            if (targetIsFoundation && !row.isFoundation) score -= 0.05;

            if (targetQualification) {
                if (row.qualification === targetQualification) score += 0.22;
                else if (row.qualification) score -= 0.06;
            }

            if (score > bestScore) {
                bestScore = score;
                best = row;
            }
        }

        if (!best || bestScore < 0.42) {
            return null;
        }
        return best;
    }

    private findBestUgIntlRow(context: ScrapeContext, homeRow: WarwickUgRow | null, intlRows: WarwickUgRow[]): WarwickUgRow | null {
        if (intlRows.length === 0) return null;

        if (homeRow?.courseCode) {
            const byCode = intlRows.find(row => row.courseCode.toLowerCase() === homeRow.courseCode.toLowerCase());
            if (byCode) return byCode;
        }

        if (homeRow?.normalizedTitle) {
            const byTitle = intlRows.find(row => row.normalizedTitle === homeRow.normalizedTitle);
            if (byTitle) return byTitle;
        }

        return this.findBestUgRow(context, intlRows);
    }

    private inferLevelHint(normalizedUrl: string, context: ScrapeContext): WarwickLevelHint {
        const url = normalizedUrl.toLowerCase();
        if (url.includes('/postgraduate/')) return 'pg';
        if (url.includes('/undergraduate/')) return 'ug';

        const qualification = this.normalizeQualification(context.outcomeQualification || '');
        const title = String(context.courseTitle || '').toLowerCase();

        if (this.isPgQualification(qualification) || /master|postgraduate|phd|mphil|doctoral|mres|pgcert|pgdip/i.test(title)) {
            return 'pg';
        }
        if (this.isUgQualification(qualification) || /undergraduate|foundation year|integrated foundation|bachelor/i.test(title)) {
            return 'ug';
        }

        return 'unknown';
    }

    private isPgQualification(q: string): boolean {
        return ['msc', 'ma', 'mres', 'llm', 'mba', 'pgdip', 'pgcert', 'mphil-phd'].includes(q);
    }

    private isUgQualification(q: string): boolean {
        return ['bsc', 'ba', 'beng', 'meng', 'llb', 'bmedsci', 'mbchb'].includes(q);
    }

    private normalizeIncomingUrl(url: string): string {
        const trimmed = String(url || '').trim();
        if (!trimmed) return '';

        try {
            const parsed = new URL(trimmed);
            parsed.hash = '';
            if (parsed.protocol === 'http:') parsed.protocol = 'https:';

            const toDelete: string[] = [];
            parsed.searchParams.forEach((_value, key) => {
                const lower = key.toLowerCase();
                if (
                    lower.startsWith('utm_') ||
                    lower === 'gclid' ||
                    lower === 'fbclid' ||
                    lower === 'mc_cid' ||
                    lower === 'mc_eid'
                ) {
                    toDelete.push(key);
                }
            });
            toDelete.forEach(key => parsed.searchParams.delete(key));
            return parsed.toString();
        } catch {
            return trimmed;
        }
    }

    private isLikelyLoginUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return /websignon\.warwick\.ac\.uk$/i.test(parsed.hostname) || /\/origin\/slogin/i.test(parsed.pathname);
        } catch {
            return false;
        }
    }

    private async fetchHtml(url: string): Promise<string> {
        const response = await axios.get(url, {
            headers: HEADERS_BROWSER,
            timeout: FETCH_TIMEOUT_MS,
            validateStatus: status => status < 500
        });

        if (response.status >= 400) {
            throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return String(response.data || '');
    }

    private normalizeFeeStatus(value: string): WarwickFeeStatus {
        const normalized = String(value || '').toLowerCase();
        if (/\ball\b/.test(normalized)) return 'all';
        if (/overseas|international/.test(normalized)) return 'intl';
        if (/home|uk/.test(normalized)) return 'home';
        return 'unknown';
    }

    private readCells($: cheerio.CheerioAPI, row: any): string[] {
        const cells: string[] = [];
        row.find('th,td').each((_idx: number, cell: any) => {
            cells.push(this.cleanText($(cell).text()));
        });
        return cells;
    }

    private extractYearColumns(headers: string[]): Map<number, number> {
        const yearColumns = new Map<number, number>();

        headers.forEach((header, index) => {
            const match = String(header).match(/(20\d{2})\s*-\s*(?:\d{2}|20\d{2})/);
            if (!match?.[1]) return;
            const year = parseInt(match[1], 10);
            if (!Number.isInteger(year)) return;
            yearColumns.set(index, year);
        });

        return yearColumns;
    }

    private pickYearFee(byYear: Map<number, number>, targetYear: number): number | null {
        if (byYear.size === 0) return null;

        if (Number.isInteger(targetYear) && byYear.has(targetYear)) {
            return byYear.get(targetYear) ?? null;
        }

        const entries = Array.from(byYear.entries()).sort((a, b) => b[0] - a[0]);
        if (!Number.isInteger(targetYear)) {
            return entries[0]?.[1] ?? null;
        }

        const atOrBefore = entries.find(([year]) => year <= targetYear);
        if (atOrBefore) return atOrBefore[1];

        return entries[0]?.[1] ?? null;
    }

    private scoreAgainstVariants(targetVariants: string[], candidate: string): number {
        let best = 0;
        for (const target of targetVariants) {
            const score = this.computeSimilarity(target, candidate);
            if (score > best) best = score;
        }
        return best;
    }

    private computeSimilarity(target: string, candidate: string): number {
        if (!target || !candidate) return 0;
        let score = stringSimilarity.compareTwoStrings(target, candidate);
        score += this.tokenOverlapScore(target, candidate) / 200;

        if (target === candidate) score += 1;
        if (target.includes(candidate) || candidate.includes(target)) score += 0.2;

        return score;
    }

    private tokenOverlapScore(a: string, b: string): number {
        const aTokens = new Set(a.split(' ').filter(Boolean));
        const bTokens = new Set(b.split(' ').filter(Boolean));
        if (aTokens.size === 0 || bTokens.size === 0) return 0;

        let overlap = 0;
        for (const token of aTokens) {
            if (bTokens.has(token)) overlap += 1;
        }
        return (overlap / Math.max(aTokens.size, bTokens.size)) * 100;
    }

    private buildTitleVariants(title: string): string[] {
        const raw = String(title || '').replace(/\s+/g, ' ').trim();
        const stripped = raw
            .replace(/\bwith integrated foundation year\b/gi, '')
            .replace(/\bwith a foundation year\b/gi, '')
            .replace(/\bwith foundation year\b/gi, '')
            .replace(/\bfoundation year only\b/gi, '')
            .replace(/\bfoundation year\b/gi, '')
            .replace(/\bwith placement year\b/gi, '')
            .replace(/\bwith a year in industry\b/gi, '')
            .replace(/\bwith year in industry\b/gi, '')
            .replace(/\bwith study abroad\b/gi, '')
            .replace(/\bwith year abroad\b/gi, '')
            .replace(/\btop[- ]?up\b/gi, '')
            .replace(/\bstage\s*3\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        const firstClause = stripped.split(/\b\/\b|:/)[0]?.trim() || stripped;

        const variants = [
            raw,
            raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim(),
            stripped,
            firstClause
        ];

        const unique: string[] = [];
        const seen = new Set<string>();
        for (const variant of variants) {
            const normalized = this.normalizeTitle(variant);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            unique.push(normalized);
        }
        return unique;
    }

    private normalizeTitle(value: string): string {
        return String(value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\b(with|the|of|for|in|at|a|an|and|or|course|programme|program|degree|hons|honours|students)\b/g, ' ')
            .replace(/[^a-z0-9 ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private normalizeMode(value: string): string {
        const normalized = String(value || '').toLowerCase();
        if (normalized.includes('part')) return 'part-time';
        if (normalized.includes('full')) return 'full-time';
        if (normalized.includes('distance') || normalized.includes('online')) return 'distance';
        if (normalized.includes('modular') || normalized.includes('block')) return 'modular';
        return '';
    }

    private normalizeQualification(value: string): string {
        const normalized = String(value || '').toLowerCase();
        if (/pg\s*cert|pgcert/.test(normalized)) return 'pgcert';
        if (/pg\s*dip|pgdip/.test(normalized)) return 'pgdip';
        if (/\bmsc\b/.test(normalized)) return 'msc';
        if (/\bma\b/.test(normalized)) return 'ma';
        if (/\bmres\b/.test(normalized)) return 'mres';
        if (/\bllm\b/.test(normalized)) return 'llm';
        if (/\bmba\b/.test(normalized)) return 'mba';
        if (/\bphd\b|\bmphil\b|doctoral/.test(normalized)) return 'mphil-phd';
        if (/\bbsc\b/.test(normalized)) return 'bsc';
        if (/\bba\b/.test(normalized)) return 'ba';
        if (/\bbeng\b/.test(normalized)) return 'beng';
        if (/\bmeng\b/.test(normalized)) return 'meng';
        if (/\bllb\b/.test(normalized)) return 'llb';
        if (/\bbmedsci\b/.test(normalized)) return 'bmedsci';
        if (/\bmbchb\b/.test(normalized)) return 'mbchb';
        return '';
    }

    private extractAmount(value: string | undefined): number | null {
        if (!value) return null;
        const match = String(value).match(/£\s*([0-9]{1,3}(?:,[0-9]{3})*)/);
        if (!match?.[1]) return null;
        const parsed = parseInt(match[1].replace(/,/g, ''), 10);
        if (Number.isNaN(parsed) || parsed < 1000 || parsed > 150000) return null;
        return parsed;
    }

    private hasAnyFee(fees: ScrapedFees | null | undefined): boolean {
        if (!fees) return false;
        return fees.homeFee !== null || fees.internationalFee !== null;
    }

    private isRealCourseTitle(value: string): boolean {
        const trimmed = this.cleanText(value);
        if (!trimmed || trimmed.length < 3) return false;
        if (!/[a-z]/i.test(trimmed)) return false;
        if (/^[a-z]$/i.test(trimmed)) return false;
        if (/^[a-z](\s+[a-z])+$/i.test(trimmed) && trimmed.length < 12) return false;
        if (/^(course|ucas code|fee status|full time|part time)$/i.test(trimmed)) return false;
        return true;
    }

    private cleanText(value: string): string {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }
}
