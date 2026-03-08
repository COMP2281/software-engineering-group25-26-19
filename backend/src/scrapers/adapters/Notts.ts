import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import * as stringSimilarity from 'string-similarity';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

const DEBUG = true;
const FETCH_TIMEOUT_MS = 15000;
const PG_SEARCH_ENDPOINT = 'https://www.nottingham.ac.uk/pgstudy/courses/courses.aspx';
const UG_SEARCH_ENDPOINT = 'https://www.nottingham.ac.uk/search.aspx';

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

interface NottsFeeExtraction extends ScrapedFees {
    confidence: number;
    sawHomeLabel: boolean;
    sawInternationalLabel: boolean;
}

interface SearchCandidate {
    url: string;
    title: string;
}

function debug(message: string): void {
    if (DEBUG) Logger.debug(`[DEBUG] Notts: ${message}`);
}

export class NottsAdapter extends GenericHtmlAdapter {
    private pgUrlCache = new Map<string, string | null>();
    private ugUrlCache = new Map<string, string | null>();

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const normalizedUrl = this.normalizeIncomingUrl(courseUrl);
        const primaryContext = contexts[0];
        const primaryTitle = primaryContext?.courseTitle || '';
        const year = this.resolveYear(contexts);
        const qualification = primaryContext?.outcomeQualification || '';
        const likelyUg = this.isLikelyUndergraduate(normalizedUrl, primaryTitle, qualification);

        const candidateUrls = this.buildInitialCandidateUrls(normalizedUrl, year);

        let bestResults: OptionScrapeResult[] = [];
        let bestHitCount = -1;

        for (const candidateUrl of candidateUrls) {
            const results = await super.scrapeCourse(candidateUrl, contexts);
            const hitCount = this.countResolvedOptions(results);

            if (hitCount > bestHitCount) {
                bestHitCount = hitCount;
                bestResults = results;
            }

            if (hitCount > 0) {
                return results;
            }
        }

        if (!primaryTitle) {
            return bestResults;
        }

        const resolvedUrl = await this.resolveCourseUrlByTitle(primaryTitle, year, likelyUg, qualification);
        if (resolvedUrl && !candidateUrls.includes(resolvedUrl)) {
            debug(`Resolved course URL by title "${primaryTitle}" -> ${resolvedUrl}`);
            const resolvedResults = await super.scrapeCourse(resolvedUrl, contexts);
            const hitCount = this.countResolvedOptions(resolvedResults);

            if (hitCount > 0 || hitCount > bestHitCount) {
                return resolvedResults;
            }
        }

        return bestResults;
    }

    protected override sanitizeForStudyMode(html: string, _studyMode: string): string {
        // Nottingham fee tables can contain multiple columns where labels are needed
        // to identify the right cell. Keep full table content intact.
        return html;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (isPdf) {
            return super.parseHtml(html, context, isPdf);
        }

        const $ = cheerio.load(html);
        const nottsFees = this.extractNottsFees($, context);
        const supplementaryFees = this.extractSupplementaryFees($);
        const genericFees = await super.parseHtml(html, context, false);

        const useNottsHome = Boolean(nottsFees && (nottsFees.sawHomeLabel || nottsFees.homeFee !== null));
        const useNottsInternational = Boolean(
            nottsFees && (nottsFees.sawInternationalLabel || nottsFees.internationalFee !== null)
        );

        const result: ScrapedFees = {
            homeFee: useNottsHome
                ? (nottsFees?.homeFee ?? null)
                : (genericFees.homeFee ?? supplementaryFees.homeFee),
            internationalFee: useNottsInternational
                ? (nottsFees?.internationalFee ?? null)
                : (genericFees.internationalFee ?? supplementaryFees.internationalFee)
        };

        if (result.homeFee === null && supplementaryFees.homeFee !== null) {
            result.homeFee = supplementaryFees.homeFee;
        }
        if (result.internationalFee === null && supplementaryFees.internationalFee !== null) {
            result.internationalFee = supplementaryFees.internationalFee;
        }

        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }

        return result;
    }

    private extractNottsFees($: cheerio.CheerioAPI, context: ScrapeContext): NottsFeeExtraction | null {
        const candidates: NottsFeeExtraction[] = [];
        const seen = new Set<string>();

        const collect = (table: Element): void => {
            const signature = $.html(table) || '';
            if (!signature || seen.has(signature)) return;
            seen.add(signature);

            const extracted = this.extractFromTable($, $(table), context);
            if (extracted && (extracted.homeFee !== null || extracted.internationalFee !== null)) {
                candidates.push(extracted);
            }
        };

        $('#feesFunding table').each((_idx, table) => collect(table));
        $('table.tableWithBorders').each((_idx, table) => collect(table));
        $('table').each((_idx, table) => {
            const text = $(table).text().toLowerCase();
            if (text.includes('home / uk') && text.includes('international')) {
                collect(table);
            }
        });

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => b.confidence - a.confidence);
        return candidates[0] || null;
    }

    private extractFromTable(
        $: cheerio.CheerioAPI,
        $table: cheerio.Cheerio<any>,
        context: ScrapeContext
    ): NottsFeeExtraction | null {
        const rows = $table.find('tr').toArray();
        if (rows.length === 0) return null;

        const matrix = rows.map(row =>
            $(row)
                .find('th,td')
                .map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
                .get()
        );

        if (matrix.every(cells => cells.length === 0)) return null;

        const headers = (matrix.find(cells => cells.length > 0) || []).map(cell => this.normalize(cell));
        const dataRows = matrix.filter(cells => cells.length > 0);
        if (dataRows.length === 0) return null;

        const homeCol = this.findHeaderIndex(headers, /(home|uk|domestic|england|rest of uk|ruk)/i);
        const intlCol = this.findHeaderIndex(headers, /(international|overseas|eu)/i);

        if (homeCol >= 0 || intlCol >= 0) {
            return this.extractFromColumnLabeledTable(dataRows, homeCol, intlCol, context);
        }

        return this.extractFromRowLabeledTable(headers, dataRows, context);
    }

    private extractFromColumnLabeledTable(
        rows: string[][],
        homeCol: number,
        intlCol: number,
        context: ScrapeContext
    ): NottsFeeExtraction | null {
        const dataRows = rows.slice(1);
        if (dataRows.length === 0) return null;

        const selectedRow = this.selectBestRowForContext(dataRows, context);
        if (!selectedRow) return null;

        const homeFee = homeCol >= 0 ? this.extractAmount(selectedRow[homeCol] || '') : null;
        const internationalFee = intlCol >= 0 ? this.extractAmount(selectedRow[intlCol] || '') : null;

        return {
            homeFee,
            internationalFee,
            confidence: this.buildConfidence(homeFee, internationalFee),
            sawHomeLabel: homeCol >= 0,
            sawInternationalLabel: intlCol >= 0
        };
    }

    private extractFromRowLabeledTable(headers: string[], rows: string[][], context: ScrapeContext): NottsFeeExtraction | null {
        const qualificationColumn = this.pickQualificationColumn(headers, context);
        let homeFee: number | null = null;
        let internationalFee: number | null = null;
        let sawHomeLabel = false;
        let sawInternationalLabel = false;

        for (const row of rows.slice(1)) {
            const label = this.normalize(row[0] || '');
            if (!label) continue;

            const rowValues = row.slice(1);
            const valueText = this.pickValueByColumn(rowValues, qualificationColumn);
            const value = this.extractAmount(valueText);

            if (/(home|uk|domestic|england|rest of uk|ruk)/.test(label) && !/(international|overseas|eu)/.test(label)) {
                sawHomeLabel = true;
                homeFee = value;
                continue;
            }

            if (/(international|overseas|eu)/.test(label)) {
                sawInternationalLabel = true;
                internationalFee = value;
            }
        }

        if (homeFee === null && internationalFee === null) return null;

        return {
            homeFee,
            internationalFee,
            confidence: this.buildConfidence(homeFee, internationalFee),
            sawHomeLabel,
            sawInternationalLabel
        };
    }

    private pickQualificationColumn(headers: string[], context: ScrapeContext): number {
        if (headers.length <= 1) return 0;

        const qualification = this.normalize(context.outcomeQualification || '');
        const mode = this.normalize(context.studyMode || '');
        const valueHeaders = headers.slice(1);

        if (qualification) {
            const byQualification = valueHeaders.findIndex(h =>
                h === qualification ||
                h.includes(qualification) ||
                qualification.includes(h)
            );
            if (byQualification >= 0) return byQualification;
        }

        if (mode.includes('part')) {
            const byPartTime = valueHeaders.findIndex(h => h.includes('part'));
            if (byPartTime >= 0) return byPartTime;
        }
        if (mode.includes('full')) {
            const byFullTime = valueHeaders.findIndex(h => h.includes('full'));
            if (byFullTime >= 0) return byFullTime;
        }

        return 0;
    }

    private pickValueByColumn(values: string[], col: number): string {
        if (values.length === 0) return '';
        if (col >= 0 && col < values.length) {
            return values[col] || '';
        }
        return values[0] || '';
    }

    private selectBestRowForContext(rows: string[][], context: ScrapeContext): string[] | null {
        const qualification = this.normalize(context.outcomeQualification || '');
        const mode = this.normalize(context.studyMode || '');

        let bestScore = -1;
        let bestRow: string[] | null = null;

        for (const row of rows) {
            const label = this.normalize(row[0] || '');
            let score = 0;

            if (qualification && (label === qualification || label.includes(qualification) || qualification.includes(label))) {
                score += 3;
            }
            if (mode.includes('part') && label.includes('part')) score += 2;
            if (mode.includes('full') && label.includes('full')) score += 2;
            if (label.includes('year') && /\b1\b/.test(label)) score += 1;

            if (score > bestScore) {
                bestScore = score;
                bestRow = row;
            }
        }

        return bestRow || rows[0] || null;
    }

    private extractAmount(text: string): number | null {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean) return null;

        const lower = clean.toLowerCase();
        if (/(^|[^a-z])(n\/a|na|not available|tbc|to be confirmed)([^a-z]|$)/i.test(lower)) {
            return null;
        }

        const match = clean.match(/(?:£|&#163;)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})(?:\.\d{2})?/i);
        if (!match?.[1]) return null;

        const value = parseInt(match[1].replace(/,/g, ''), 10);
        if (Number.isNaN(value) || value < 1000 || value > 120000) {
            return null;
        }

        return value;
    }

    private findHeaderIndex(headers: string[], regex: RegExp): number {
        return headers.findIndex(h => regex.test(h));
    }

    private normalize(value: string): string {
        return String(value || '')
            .toLowerCase()
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private buildConfidence(homeFee: number | null, internationalFee: number | null): number {
        let score = 0;
        if (homeFee !== null) score += 1;
        if (internationalFee !== null) score += 1;
        return score;
    }

    private extractSupplementaryFees($: cheerio.CheerioAPI): ScrapedFees {
        let homeFee = this.extractFeeByListLabel($, /\b(home|uk)\s*fees?\b/i);
        let internationalFee = this.extractFeeByListLabel($, /\b(international|overseas)\s*fees?\b/i);

        if (homeFee === null) {
            homeFee = this.extractAmount($('#fees-home .cmp-accordion__header').first().text());
        }
        if (internationalFee === null) {
            internationalFee = this.extractAmount($('#fees-int .cmp-accordion__header').first().text());
        }
        if (internationalFee === null) {
            internationalFee = this.extractAmount($('#fees-international .cmp-accordion__header').first().text());
        }

        if (homeFee === null) {
            homeFee = this.extractAmount($('.home-student-detail').first().text());
        }
        if (internationalFee === null) {
            internationalFee = this.extractAmount($('.international-student-detail').first().text());
        }
        if (internationalFee === null) {
            internationalFee = this.extractAmount($('.intl-student-detail, .overseas-student-detail').first().text());
        }

        return { homeFee, internationalFee };
    }

    private extractFeeByListLabel($: cheerio.CheerioAPI, labelRegex: RegExp): number | null {
        let amount: number | null = null;
        $('li').each((_idx, li) => {
            if (amount !== null) return;
            const text = $(li).text().replace(/\s+/g, ' ').trim();
            if (!labelRegex.test(text)) return;
            amount = this.extractAmount(text);
        });
        return amount;
    }

    private countResolvedOptions(results: OptionScrapeResult[]): number {
        return results.filter(result => result.homeFee !== null || result.internationalFee !== null).length;
    }

    private resolveYear(contexts: ScrapeContext[]): number {
        for (const context of contexts) {
            if (Number.isInteger(context.year) && context.year >= 2000 && context.year <= 2100) {
                return context.year;
            }
        }
        return 2026;
    }

    private isLikelyUndergraduate(url: string, courseTitle: string, qualification: string | null | undefined): boolean {
        if (/\/studywithus\/ugstudy\//i.test(url)) return true;
        if (/\/pgstudy\//i.test(url)) return false;

        const title = this.normalizeTitle(courseTitle);
        if (title.includes('foundation year')) return true;

        const qual = this.normalizeQualification(qualification || '');
        if (!qual) return false;
        return /^(ba|bsc|beng|meng|msci|mphys|fdsc|fda|hnd|hnc|l6dip|ug)/.test(qual);
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

    private buildInitialCandidateUrls(url: string, year: number): string[] {
        if (!url) return [];

        const candidates: string[] = [];
        const add = (candidate: string): void => {
            const clean = String(candidate || '').trim();
            if (!clean || candidates.includes(clean)) return;
            candidates.push(clean);
        };

        add(url);

        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return candidates;
        }

        const path = parsed.pathname;
        const withPath = (pathname: string): string => {
            const clone = new URL(parsed.toString());
            clone.pathname = pathname;
            return clone.toString();
        };

        if (/\/studywithus\/ugstudy\/courses\/ug\//i.test(path)) {
            const noUcasCode = this.removeUgCourseCodeSuffix(path);
            add(withPath(noUcasCode));

            const withYear = this.ensureUgYearInPath(noUcasCode, year);
            add(withPath(withYear));
        }

        if (/\/pgstudy\/course\/(?:taught|research)\//i.test(path)) {
            const noYear = this.removePgYearFromPath(path);
            add(withPath(noYear));

            const withYear = this.ensurePgYearInPath(noYear, year);
            add(withPath(withYear));
        }

        return candidates;
    }

    private removeUgCourseCodeSuffix(pathname: string): string {
        return pathname.replace(
            /(\/studywithus\/ugstudy\/courses\/ug\/(?:\d{4}\/)?[^\/?#]+)-u[0-9a-z]+(\.html)$/i,
            '$1$2'
        );
    }

    private ensureUgYearInPath(pathname: string, year: number): string {
        if (/\/studywithus\/ugstudy\/courses\/ug\/\d{4}\//i.test(pathname)) return pathname;
        return pathname.replace(
            /\/studywithus\/ugstudy\/courses\/ug\//i,
            `/studywithus/ugstudy/courses/UG/${year}/`
        );
    }

    private removePgYearFromPath(pathname: string): string {
        return pathname.replace(/(\/pgstudy\/course\/(?:taught|research))\/\d{4}(\/)/i, '$1$2');
    }

    private ensurePgYearInPath(pathname: string, year: number): string {
        if (/\/pgstudy\/course\/(?:taught|research)\/\d{4}\//i.test(pathname)) return pathname;
        return pathname.replace(/(\/pgstudy\/course\/(?:taught|research)\/)/i, `$1${year}/`);
    }

    private async resolveCourseUrlByTitle(
        courseTitle: string,
        year: number,
        likelyUg: boolean,
        qualification: string | null | undefined
    ): Promise<string | null> {
        if (!courseTitle.trim()) return null;

        if (likelyUg) {
            const ug = await this.resolveUgCourseUrlByTitle(courseTitle, year, qualification);
            if (ug) return ug;
            return this.resolvePgCourseUrlByTitle(courseTitle, qualification);
        }

        const pg = await this.resolvePgCourseUrlByTitle(courseTitle, qualification);
        if (pg) return pg;
        return this.resolveUgCourseUrlByTitle(courseTitle, year, qualification);
    }

    private async resolvePgCourseUrlByTitle(
        courseTitle: string,
        qualification: string | null | undefined
    ): Promise<string | null> {
        const normalizedTitle = this.normalizeTitle(courseTitle);
        const qualificationToken = this.normalizeQualification(qualification || '');
        const cacheKey = `${normalizedTitle}:${qualificationToken || '-'}`;
        if (!normalizedTitle) return null;

        if (this.pgUrlCache.has(cacheKey)) {
            return this.pgUrlCache.get(cacheKey) || null;
        }

        const queries = this.buildSearchQueries(courseTitle);
        let bestUrl: string | null = null;
        let bestScore = -1;

        for (const query of queries) {
            const candidates = await this.fetchPgCandidates(query);
            for (const candidate of candidates) {
                const score = this.scoreCandidate(
                    normalizedTitle,
                    this.normalizeTitle(candidate.title),
                    qualificationToken,
                    candidate.title
                );
                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = candidate.url;
                }
            }
        }

        const accepted = bestScore >= 0.2 ? bestUrl : null;
        this.pgUrlCache.set(cacheKey, accepted);
        return accepted;
    }

    private async resolveUgCourseUrlByTitle(
        courseTitle: string,
        year: number,
        qualification: string | null | undefined
    ): Promise<string | null> {
        const normalizedTitle = this.normalizeTitle(courseTitle);
        const qualificationToken = this.normalizeQualification(qualification || '');
        const cacheKey = `${normalizedTitle}:${year}:${qualificationToken || '-'}`;
        if (!normalizedTitle) return null;

        if (this.ugUrlCache.has(cacheKey)) {
            return this.ugUrlCache.get(cacheKey) || null;
        }

        const queries = this.buildSearchQueries(courseTitle);
        let bestUrl: string | null = null;
        let bestScore = -1;

        for (const query of queries) {
            const candidates = await this.fetchUgCandidates(query);
            for (const candidate of candidates) {
                let score = this.scoreCandidate(
                    normalizedTitle,
                    this.normalizeTitle(candidate.title),
                    qualificationToken,
                    candidate.title
                );

                if (candidate.url.includes(`/UG/${year}/`)) {
                    score += 0.15;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = candidate.url;
                }
            }
        }

        const accepted = bestScore >= 0.2 ? bestUrl : null;
        this.ugUrlCache.set(cacheKey, accepted);
        return accepted;
    }

    private async fetchPgCandidates(searchQuery: string): Promise<SearchCandidate[]> {
        try {
            const response = await axios.get(PG_SEARCH_ENDPOINT, {
                headers: HEADERS_BROWSER,
                params: {
                    level: 'all',
                    search_keywords: searchQuery
                },
                timeout: FETCH_TIMEOUT_MS,
                validateStatus: s => s < 500
            });

            if (response.status >= 400) {
                return [];
            }

            const $ = cheerio.load(String(response.data));
            const candidates: SearchCandidate[] = [];

            $('a[href]').each((_idx, anchor) => {
                const href = String($(anchor).attr('href') || '').trim();
                if (!href) return;

                let absolute: URL;
                try {
                    absolute = new URL(href, PG_SEARCH_ENDPOINT);
                } catch {
                    return;
                }

                if (!/\/pgstudy\/course\/(?:taught|research)\//i.test(absolute.pathname)) {
                    return;
                }

                const titleAttr = String($(anchor).attr('title') || '')
                    .replace(/^read more about\s*/i, '')
                    .trim();
                const cardTitle = $(anchor)
                    .closest('.singlePgResult')
                    .find('h3')
                    .first()
                    .text()
                    .replace(/\s+/g, ' ')
                    .trim();
                const text = $(anchor).text().replace(/\s+/g, ' ').trim();
                const title = titleAttr || cardTitle || text || this.slugToTitle(absolute.pathname);

                candidates.push({
                    url: this.normalizeIncomingUrl(absolute.toString()),
                    title
                });
            });

            return this.deduplicateCandidates(candidates);
        } catch (error) {
            debug(`PG search failed for "${searchQuery}": ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    private async fetchUgCandidates(searchQuery: string): Promise<SearchCandidate[]> {
        try {
            const response = await axios.get(UG_SEARCH_ENDPOINT, {
                headers: HEADERS_BROWSER,
                params: {
                    category: 'courses',
                    search_keywords: searchQuery
                },
                timeout: FETCH_TIMEOUT_MS,
                validateStatus: s => s < 500
            });

            if (response.status >= 400) {
                return [];
            }

            const $ = cheerio.load(String(response.data));
            const candidates: SearchCandidate[] = [];

            $('a[href]').each((_idx, anchor) => {
                const href = String($(anchor).attr('href') || '').trim();
                if (!href) return;

                let absolute: URL;
                try {
                    absolute = new URL(href, UG_SEARCH_ENDPOINT);
                } catch {
                    return;
                }

                if (!/\/studywithus\/ugstudy\/courses\/ug\//i.test(absolute.pathname)) {
                    return;
                }

                const titleAttr = String($(anchor).attr('title') || '').trim();
                const text = $(anchor).text().replace(/\s+/g, ' ').trim();
                const title = titleAttr || text || this.slugToTitle(absolute.pathname);
                candidates.push({
                    url: this.normalizeIncomingUrl(absolute.toString()),
                    title
                });
            });

            return this.deduplicateCandidates(candidates);
        } catch (error) {
            debug(`UG search failed for "${searchQuery}": ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    private deduplicateCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
        const unique: SearchCandidate[] = [];
        const seen = new Set<string>();

        for (const candidate of candidates) {
            const key = `${candidate.url}|${this.normalizeTitle(candidate.title)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(candidate);
        }

        return unique;
    }

    private scoreCandidate(
        normalizedTargetTitle: string,
        normalizedCandidateTitle: string,
        qualificationToken: string,
        rawCandidateTitle: string
    ): number {
        if (!normalizedCandidateTitle) return -1;

        let score = stringSimilarity.compareTwoStrings(normalizedTargetTitle, normalizedCandidateTitle);
        score += this.tokenOverlapScore(normalizedTargetTitle, normalizedCandidateTitle) / 200;

        if (normalizedCandidateTitle === normalizedTargetTitle) score += 1;
        if (
            normalizedCandidateTitle.includes(normalizedTargetTitle) ||
            normalizedTargetTitle.includes(normalizedCandidateTitle)
        ) {
            score += 0.2;
        }

        const targetQualification = this.extractQualificationToken(qualificationToken);
        if (targetQualification) {
            const candidateQualification = this.extractQualificationToken(rawCandidateTitle);
            if (candidateQualification) {
                if (candidateQualification === targetQualification) {
                    score += 0.8;
                } else {
                    score -= 0.8;
                }
            }
        }

        return score;
    }

    private buildSearchQueries(courseTitle: string): string[] {
        const raw = courseTitle.replace(/\s+/g, ' ').trim();
        const noParens = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        const noAdvanced = noParens.replace(/^\s*advanced\s+/i, '').trim();
        const noFoundation = noParens.replace(/\bwith\b.*\bfoundation year\b/i, '').trim();
        const noAndClause = noParens.split(/\band\b/i)[0]?.trim() || '';
        const tokens = this.normalizeTitle(noParens).split(' ').filter(Boolean);

        const variants = [
            raw,
            noParens,
            raw.replace(/&/g, ' and ').replace(/\s+/g, ' ').trim(),
            noAdvanced,
            noFoundation,
            noAndClause,
            tokens.slice(0, 4).join(' '),
            tokens.slice(0, 3).join(' ')
        ];

        const unique: string[] = [];
        const seen = new Set<string>();
        for (const variant of variants) {
            const normalized = this.normalizeTitle(variant);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            unique.push(variant.trim());
        }
        return unique;
    }

    private slugToTitle(pathname: string): string {
        const slug = pathname.split('/').pop() || '';
        return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    private normalizeTitle(value: string): string {
        return String(value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\b\(?with foundation year\)?\b/g, ' ')
            .replace(/\b(hons|honours)\b/g, ' ')
            .replace(/[^a-z0-9 ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private normalizeQualification(value: string): string {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private extractQualificationToken(value: string): string {
        const normalized = this.normalizeQualification(value);
        if (!normalized) return '';

        const known = [
            'phd',
            'mres',
            'msc',
            'ma',
            'mphil',
            'llm',
            'mba',
            'pgdip',
            'pgcert',
            'march',
            'meng',
            'beng',
            'msci',
            'mphys',
            'bsc',
            'ba',
            'fdsc',
            'fda'
        ];

        for (const token of known) {
            if (new RegExp(`\\b${token}\\b`, 'i').test(normalized)) {
                return token;
            }
        }
        return '';
    }

    private tokenOverlapScore(target: string, candidate: string): number {
        const targetTokens = new Set(target.split(' ').filter(Boolean));
        const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
        if (targetTokens.size === 0 || candidateTokens.size === 0) return 0;

        let overlap = 0;
        for (const token of targetTokens) {
            if (candidateTokens.has(token)) overlap++;
        }

        return Math.round((overlap / Math.max(targetTokens.size, candidateTokens.size)) * 100);
    }
}
