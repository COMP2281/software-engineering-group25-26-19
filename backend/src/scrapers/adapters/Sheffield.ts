// src/scrapers/adapters/Sheffield.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

const DEBUG = true;
const FETCH_TIMEOUT_MS = 15000;
const FEE_LOOKUP_ENDPOINT = 'https://ssd.dept.shef.ac.uk/fees/pgt/api/drupal-lookup.php';
const UG_FEE_LOOKUP_ENDPOINT = 'http://ssd.dept.shef.ac.uk/fees/ug/ug-fees.php';
const PG_SEARCH_ENDPOINT = 'https://www.sheffield.ac.uk/postgraduate/taught/courses/search';

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

interface FeeYearData {
    Home?: string;
    Overseas?: string;
    International?: string;
}

function debug(msg: string): void {
    if (DEBUG) Logger.debug(`[DEBUG] Sheffield: ${msg}`);
}

export class SheffieldAdapter extends GenericHtmlAdapter {
    private feeLookupCache = new Map<string, ScrapedFees | null>();
    private ugFeeLookupCache = new Map<string, ScrapedFees | null>();
    private pgCourseUrlCache = new Map<string, string | null>();

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const normalizedUrl = String(courseUrl || '').trim();
        if (normalizedUrl) {
            const primaryTitle = contexts[0]?.courseTitle || '';
            let targetUrl = normalizedUrl;

            if (primaryTitle && this.looksLikePostgraduateUrl(targetUrl)) {
                const resolvedPgUrl = await this.resolvePostgraduateUrlByTitle(primaryTitle);
                if (resolvedPgUrl) {
                    targetUrl = resolvedPgUrl;
                }
            }

            if (this.looksLikeUndergraduateUrl(targetUrl)) {
                const ugResults = await this.tryResolveUndergraduateByTitle(contexts);
                const anyFound = ugResults.some(res => res.homeFee !== null || res.internationalFee !== null);
                if (anyFound) {
                    return ugResults;
                }
            }
            return super.scrapeCourse(targetUrl, contexts);
        }

        debug(`Missing course URL. Attempting UG lookup by title for ${contexts.length} option(s).`);

        const results: OptionScrapeResult[] = [];
        for (const context of contexts) {
            const ugFees = this.isFoundationCourse(context.courseTitle)
                ? await this.extractUndergraduateFeesFromUgLookup(context.courseTitle, context.year)
                : null;
            results.push({
                optionId: context.optionId,
                homeFee: ugFees?.homeFee ?? null,
                internationalFee: ugFees?.internationalFee ?? null
            });
        }
        return results;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (isPdf) {
            return super.parseHtml(html, context, isPdf);
        }

        const apiFees = await this.extractFeesFromLookupApi(html);
        const ugFoundationFees = this.isFoundationCourse(context.courseTitle)
            ? await this.extractUndergraduateFeesFromUgLookup(context.courseTitle, context.year)
            : null;
        const genericFees = await super.parseHtml(html, context, false);

        const result: ScrapedFees = {
            homeFee: apiFees?.homeFee ?? ugFoundationFees?.homeFee ?? genericFees.homeFee,
            internationalFee: apiFees?.internationalFee ?? ugFoundationFees?.internationalFee ?? genericFees.internationalFee
        };

        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }

        return result;
    }

    private isFoundationCourse(courseTitle: string): boolean {
        const normalized = courseTitle.toLowerCase();
        return normalized.includes('foundation year') || normalized.includes('integrated foundation');
    }

    private looksLikeUndergraduateUrl(url: string): boolean {
        return /\/undergraduate\/courses\/\d{4}\//i.test(url) || /\/dll\/courses\/foundation\//i.test(url);
    }

    private looksLikePostgraduateUrl(url: string): boolean {
        return /\/postgraduate\/taught\/courses\/\d{4}\//i.test(url);
    }

    private async resolvePostgraduateUrlByTitle(courseTitle: string): Promise<string | null> {
        const cacheKey = this.normalizeTitle(courseTitle);
        if (!cacheKey) return null;

        if (this.pgCourseUrlCache.has(cacheKey)) {
            return this.pgCourseUrlCache.get(cacheKey) || null;
        }

        try {
            const response = await axios.get(PG_SEARCH_ENDPOINT, {
                headers: {
                    ...HEADERS_BROWSER,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                params: { keys: courseTitle },
                timeout: FETCH_TIMEOUT_MS,
                validateStatus: s => s < 500
            });

            if (response.status >= 400) {
                this.pgCourseUrlCache.set(cacheKey, null);
                return null;
            }

            const $ = cheerio.load(String(response.data));
            const candidates: Array<{ href: string; text: string }> = [];
            $('a[href]').each((_idx, anchor) => {
                const href = String($(anchor).attr('href') || '').trim();
                if (!/\/postgraduate\/taught\/courses\/\d{4}\//i.test(href)) return;

                const text = $(anchor).text().replace(/\s+/g, ' ').trim();
                if (!text) return;

                candidates.push({
                    href: new URL(href, 'https://www.sheffield.ac.uk').toString(),
                    text
                });
            });

            if (candidates.length === 0) {
                this.pgCourseUrlCache.set(cacheKey, null);
                return null;
            }

            const target = this.normalizeTitle(courseTitle);
            let bestUrl: string | null = null;
            let bestScore = -1;

            for (const candidate of candidates) {
                const candidateTitle = this.normalizeTitle(candidate.text);
                let score = this.tokenOverlapScore(target, candidateTitle);
                if (candidateTitle === target) score += 100;
                if (candidateTitle.includes(target) || target.includes(candidateTitle)) score += 10;

                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = candidate.href;
                }
            }

            const accepted = bestScore > 0 ? bestUrl : null;
            if (accepted) {
                debug(`Resolved PG URL by title "${courseTitle}" -> ${accepted}`);
            }

            this.pgCourseUrlCache.set(cacheKey, accepted);
            return accepted;
        } catch (error) {
            debug(`PG URL resolution failed for "${courseTitle}": ${error instanceof Error ? error.message : String(error)}`);
            this.pgCourseUrlCache.set(cacheKey, null);
            return null;
        }
    }

    private async tryResolveUndergraduateByTitle(contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const results: OptionScrapeResult[] = [];
        for (const context of contexts) {
            const ugFees = await this.extractUndergraduateFeesFromUgLookup(context.courseTitle, context.year);
            results.push({
                optionId: context.optionId,
                homeFee: ugFees?.homeFee ?? null,
                internationalFee: ugFees?.internationalFee ?? null
            });
        }
        return results;
    }

    private async extractUndergraduateFeesFromUgLookup(courseTitle: string, year: number): Promise<ScrapedFees | null> {
        const normalizedTitle = this.normalizeTitle(courseTitle);
        const targetYear = Number.isInteger(year) && year > 2000 ? String(year) : '2026';
        const cacheKey = `${normalizedTitle}:${targetYear}`;

        if (this.ugFeeLookupCache.has(cacheKey)) {
            return this.ugFeeLookupCache.get(cacheKey) || null;
        }

        const queryTitles = this.buildUndergraduateQueryTitles(courseTitle);
        let homeFee: number | null = null;
        let internationalFee: number | null = null;
        const isFoundation = this.isFoundationCourse(courseTitle);
        let foundFromFoundationSpecificQuery = false;

        for (const queryTitle of queryTitles) {
            const hasFoundationKeyword = /foundation/i.test(queryTitle);
            if (homeFee === null) {
                const candidateHome = await this.fetchUgLookupFee(queryTitle, targetYear, 'home');
                if (candidateHome !== null) {
                    homeFee = candidateHome;
                    if (hasFoundationKeyword) foundFromFoundationSpecificQuery = true;
                }
            }
            if (internationalFee === null) {
                const candidateIntl = await this.fetchUgLookupFee(queryTitle, targetYear, 'overseas');
                if (candidateIntl !== null) {
                    internationalFee = candidateIntl;
                    if (hasFoundationKeyword) foundFromFoundationSpecificQuery = true;
                }
            }

            if (
                homeFee !== null &&
                internationalFee !== null &&
                (!isFoundation || foundFromFoundationSpecificQuery)
            ) {
                break;
            }
        }

        const fees = (homeFee !== null || internationalFee !== null)
            ? { homeFee, internationalFee }
            : null;

        if (fees) {
            debug(`Resolved UG lookup fees for "${courseTitle}" (${targetYear}) -> Home £${fees.homeFee}, Intl £${fees.internationalFee}`);
        }

        this.ugFeeLookupCache.set(cacheKey, fees);
        return fees;
    }

    private buildUndergraduateQueryTitles(courseTitle: string): string[] {
        const raw = courseTitle.replace(/\s+/g, ' ').trim();
        const withoutFoundationPhrase = raw
            .replace(/\bwith an? foundation year\b/gi, '')
            .replace(/\bfoundation year\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        const firstTwoWords = withoutFoundationPhrase.split(' ').slice(0, 2).join(' ').trim();
        const firstClause = withoutFoundationPhrase.split(/\band\b/i)[0]?.trim() || '';

        const variants = [
            raw,
            raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim(),
            withoutFoundationPhrase,
            raw.replace(/\bfoundation year\b/gi, '').replace(/\s+/g, ' ').trim(),
            firstClause,
            firstTwoWords
        ];

        const unique: string[] = [];
        const seen = new Set<string>();
        for (const variant of variants) {
            const key = this.normalizeTitle(variant);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            unique.push(variant);
        }
        return unique;
    }

    private async fetchUgLookupFee(
        courseTitle: string,
        year: string,
        feeStatus: 'home' | 'overseas'
    ): Promise<number | null> {
        try {
            const response = await axios.get(UG_FEE_LOOKUP_ENDPOINT, {
                headers: {
                    ...HEADERS_BROWSER,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                params: {
                    dept_fee_yr_select: year,
                    kw_fee_select: feeStatus,
                    keyword_input: courseTitle,
                    gender: 'male',
                    submit: ''
                },
                timeout: FETCH_TIMEOUT_MS,
                validateStatus: s => s < 500
            });

            if (response.status >= 400) {
                return null;
            }

            const $ = cheerio.load(String(response.data));
            let tuitionText = '';

            $('table tr').each((_idx, tr) => {
                const cells: string[] = [];
                $(tr).find('th,td').each((__idx, cell) => {
                    cells.push($(cell).text().replace(/\s+/g, ' ').trim());
                });

                const label = (cells[0] || '').toLowerCase();
                if (cells.length >= 2 && label === 'tuition fee' && !tuitionText) {
                    tuitionText = cells[1] || '';
                }
            });

            if (!tuitionText) {
                return null;
            }

            return this.toAmount(tuitionText);
        } catch (error) {
            debug(`UG lookup failed for "${courseTitle}" (${year}, ${feeStatus}): ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    private async extractFeesFromLookupApi(html: string): Promise<ScrapedFees | null> {
        const $ = cheerio.load(html);
        const lookupEl = $('.course-pgt-fee-lookup[data-course-internal-code]').first();
        const internalCode = String(lookupEl.attr('data-course-internal-code') || '').trim();

        if (!internalCode) {
            debug('No postgraduate fee lookup code found on page.');
            return null;
        }

        const startYearRaw = String(lookupEl.attr('data-start-year') || '').trim();
        const preferredYear = /^\d{4}$/.test(startYearRaw) ? startYearRaw : null;
        const cacheKey = `${internalCode}:${preferredYear || 'latest'}`;

        if (this.feeLookupCache.has(cacheKey)) {
            return this.feeLookupCache.get(cacheKey) || null;
        }

        try {
            const response = await axios.get<Record<string, unknown>>(FEE_LOOKUP_ENDPOINT, {
                headers: {
                    ...HEADERS_BROWSER,
                    'Accept': 'application/json,text/plain,*/*'
                },
                params: { course: internalCode },
                timeout: FETCH_TIMEOUT_MS,
                validateStatus: s => s < 500
            });

            if (response.status >= 400 || !response.data) {
                debug(`PG fee API returned ${response.status} for ${internalCode}`);
                this.feeLookupCache.set(cacheKey, null);
                return null;
            }

            const feeRow = this.selectBestYearData(response.data, preferredYear);
            if (!feeRow) {
                this.feeLookupCache.set(cacheKey, null);
                return null;
            }

            const homeFee = this.toAmount(feeRow.Home);
            const internationalFee = this.toAmount(feeRow.Overseas ?? feeRow.International);

            const fees = (homeFee !== null || internationalFee !== null)
                ? { homeFee, internationalFee }
                : null;

            if (fees) {
                debug(`Resolved API fees for ${internalCode}${preferredYear ? ` (${preferredYear})` : ''} -> Home £${fees.homeFee}, Intl £${fees.internationalFee}`);
            }

            this.feeLookupCache.set(cacheKey, fees);
            return fees;
        } catch (error) {
            debug(`Fee API lookup failed for ${internalCode}: ${error instanceof Error ? error.message : String(error)}`);
            this.feeLookupCache.set(cacheKey, null);
            return null;
        }
    }

    private selectBestYearData(payload: Record<string, unknown>, preferredYear: string | null): FeeYearData | null {
        if (preferredYear && this.isFeeYearData(payload[preferredYear])) {
            return payload[preferredYear];
        }

        const yearKeys = Object.keys(payload)
            .filter(key => /^\d{4}$/.test(key))
            .sort((a, b) => Number(b) - Number(a));

        for (const yearKey of yearKeys) {
            const candidate = payload[yearKey];
            if (this.isFeeYearData(candidate)) {
                return candidate;
            }
        }

        if (this.isFeeYearData(payload)) {
            return payload;
        }

        return null;
    }

    private isFeeYearData(value: unknown): value is FeeYearData {
        return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    }

    private toAmount(raw: unknown): number | null {
        if (typeof raw !== 'string') return null;

        const poundMatch = raw.match(/(?:£|&pound;)\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)/i);
        const fallbackMatch = raw.match(/([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)/);
        const match = poundMatch || fallbackMatch;
        if (!match?.[1]) return null;

        const value = parseInt(match[1].replace(/,/g, ''), 10);
        if (Number.isNaN(value) || value < 1000 || value > 100000) return null;
        return value;
    }

    private normalizeTitle(value: string): string {
        return value
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\b(ba|bsc|beng|meng|msc|ma|mphil|foundation)\b/g, ' ')
            .replace(/[^a-z0-9 ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private tokenOverlapScore(a: string, b: string): number {
        if (!a || !b) return 0;
        const aTokens = new Set(a.split(' ').filter(Boolean));
        const bTokens = new Set(b.split(' ').filter(Boolean));
        if (aTokens.size === 0 || bTokens.size === 0) return 0;

        let overlap = 0;
        for (const token of aTokens) {
            if (bTokens.has(token)) overlap++;
        }
        const denom = Math.max(aTokens.size, bTokens.size);
        return Math.round((overlap / denom) * 100);
    }
}
