// src/scrapers/adapters/Southampton.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import * as stringSimilarity from 'string-similarity';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';

const DEBUG = true;
const FETCH_TIMEOUT_MS = 15000;
const SEARCH_ENDPOINT = 'https://www.southampton.ac.uk/courses';

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

type FeeType = 'home' | 'intl';
type FeeMode = 'full' | 'part' | 'unknown';

interface FeeCandidate {
    type: FeeType;
    mode: FeeMode;
    value: number;
}

interface SouthamptonTuitionExtraction extends ScrapedFees {
    hasTuitionSection: boolean;
    internationalUnavailable: boolean;
    externallyFunded: boolean;
}

function debug(msg: string): void {
    if (DEBUG) console.log(`[DEBUG] Southampton: ${msg}`);
}

export class SouthamptonAdapter extends GenericHtmlAdapter {
    private courseUrlCache = new Map<string, string | null>();

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const resolvedUrl = await this.resolveCourseUrl(courseUrl, contexts);
        let results = await super.scrapeCourse(resolvedUrl, contexts);

        const hasAnyFees = results.some(result => result.homeFee !== null || result.internationalFee !== null);
        if (hasAnyFees) {
            return results;
        }

        const primaryTitle = contexts[0]?.courseTitle || '';
        if (!primaryTitle) {
            return results;
        }

        const fallbackUrl = await this.resolveByTitle(primaryTitle);
        if (!fallbackUrl || fallbackUrl === resolvedUrl) {
            return results;
        }

        debug(`Retrying scrape with title-resolved URL -> ${fallbackUrl}`);
        results = await super.scrapeCourse(fallbackUrl, contexts);
        return results;
    }

    protected override sanitizeForStudyMode(html: string, _studyMode: string): string {
        // Southampton fee blocks are often shared across modes and can include
        // "full-time" labels before the first fee amount. The generic sanitizer
        // can truncate those lines, so we keep raw HTML and do mode selection
        // inside Southampton-specific parsing.
        return html;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (isPdf) {
            return super.parseHtml(html, context, isPdf);
        }

        const $ = cheerio.load(html);
        const southamptonFees = this.extractSouthamptonTuitionFees($, context.studyMode || '');
        const genericFees = await super.parseHtml(html, context, false);

        const result: ScrapedFees = {
            homeFee: this.selectHomeFee(southamptonFees, genericFees),
            internationalFee: this.selectInternationalFee(southamptonFees, genericFees)
        };

        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }

        return result;
    }

    private async resolveCourseUrl(initialUrl: string, contexts: ScrapeContext[]): Promise<string> {
        const normalized = this.normalizeIncomingUrl(initialUrl);
        const primaryTitle = contexts[0]?.courseTitle || '';

        if (!normalized && primaryTitle) {
            const resolved = await this.resolveByTitle(primaryTitle);
            if (resolved) {
                debug(`Resolved missing DB URL by title "${primaryTitle}" -> ${resolved}`);
                return resolved;
            }
            return normalized;
        }

        if (normalized && primaryTitle && this.isLikelyLegacyUrl(normalized)) {
            const resolved = await this.resolveByTitle(primaryTitle);
            if (resolved) {
                debug(`Resolved legacy URL by title "${primaryTitle}" -> ${resolved}`);
                return resolved;
            }
        }

        return normalized;
    }

    private normalizeIncomingUrl(url: string): string {
        const trimmed = String(url || '').trim();
        if (!trimmed) return '';

        try {
            const parsed = new URL(trimmed);
            parsed.hash = '';
            if (parsed.protocol === 'http:') {
                parsed.protocol = 'https:';
            }

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

            const clean = parsed.toString();
            if (clean !== trimmed) {
                debug(`Normalized course URL -> ${clean}`);
            }
            return clean;
        } catch {
            return trimmed;
        }
    }

    private isLikelyLegacyUrl(url: string): boolean {
        return (
            /\/healthsciences\/postgraduate\/taught_courses\//i.test(url) ||
            /\.page(?:$|\?)/i.test(url)
        );
    }

    private async resolveByTitle(courseTitle: string): Promise<string | null> {
        const cacheKey = this.normalizeTitle(courseTitle);
        if (!cacheKey) return null;

        if (this.courseUrlCache.has(cacheKey)) {
            return this.courseUrlCache.get(cacheKey) || null;
        }

        try {
            const response = await axios.get(SEARCH_ENDPOINT, {
                headers: HEADERS_BROWSER,
                params: { search: courseTitle },
                timeout: FETCH_TIMEOUT_MS,
                validateStatus: status => status < 500
            });

            if (response.status >= 400) {
                this.courseUrlCache.set(cacheKey, null);
                return null;
            }

            const $ = cheerio.load(String(response.data));
            const candidates: Array<{ url: string; title: string }> = [];

            $('a[href]').each((_idx: number, anchor: Element) => {
                const href = String($(anchor).attr('href') || '').trim();
                if (!href) return;

                let absolute: URL;
                try {
                    absolute = new URL(href, SEARCH_ENDPOINT);
                } catch {
                    return;
                }

                if (!this.isCoursePathCandidate(absolute.pathname)) {
                    return;
                }

                const title = this.extractCandidateTitle($(anchor).text(), absolute.pathname);
                if (!title) return;

                candidates.push({
                    url: absolute.toString(),
                    title
                });
            });

            if (candidates.length === 0) {
                this.courseUrlCache.set(cacheKey, null);
                return null;
            }

            const target = this.normalizeTitle(courseTitle);
            let bestUrl: string | null = null;
            let bestScore = -1;

            for (const candidate of candidates) {
                const normalizedCandidate = this.normalizeTitle(candidate.title);
                if (!normalizedCandidate) continue;

                let score = stringSimilarity.compareTwoStrings(target, normalizedCandidate);
                score += this.tokenOverlapScore(target, normalizedCandidate) / 200;

                if (normalizedCandidate === target) score += 1;
                if (normalizedCandidate.includes(target) || target.includes(normalizedCandidate)) score += 0.2;

                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = candidate.url;
                }
            }

            const accepted = bestScore >= 0.35 ? bestUrl : null;
            if (accepted) {
                debug(`Resolved course URL by title "${courseTitle}" -> ${accepted}`);
            }

            this.courseUrlCache.set(cacheKey, accepted);
            return accepted;
        } catch (error) {
            debug(`Failed URL resolution for "${courseTitle}": ${error instanceof Error ? error.message : String(error)}`);
            this.courseUrlCache.set(cacheKey, null);
            return null;
        }
    }

    private isCoursePathCandidate(pathname: string): boolean {
        const path = pathname.toLowerCase().replace(/\/+$/, '');
        if (!path.startsWith('/courses/')) return false;

        const blockedPrefixes = [
            '/courses/postgraduate',
            '/courses/undergraduate',
            '/courses/fees',
            '/courses/funding',
            '/courses/pre-masters-programmes',
            '/courses/exchanges.page',
            '/courses/short-courses',
            '/courses/clearing',
            '/courses/subjects'
        ];

        return !blockedPrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
    }

    private extractCandidateTitle(rawText: string, pathname: string): string {
        const cleanedText = rawText.replace(/\s+/g, ' ').trim();
        const withoutMeta = cleanedText
            .replace(/\btypical offer:.*$/i, '')
            .replace(/\bduration:.*$/i, '')
            .replace(/\bstart date:.*$/i, '')
            .trim();

        if (withoutMeta) {
            return withoutMeta;
        }

        const slug = pathname.split('/').pop() || '';
        return slug.replace(/-/g, ' ').trim();
    }

    private extractSouthamptonTuitionFees($: cheerio.CheerioAPI, studyMode: string): SouthamptonTuitionExtraction {
        const tuitionBlocks = this.collectTuitionTextBlocks($);
        if (tuitionBlocks.length === 0) {
            return {
                hasTuitionSection: false,
                internationalUnavailable: false,
                externallyFunded: false,
                homeFee: null,
                internationalFee: null
            };
        }

        const combined = tuitionBlocks.join(' ').replace(/\s+/g, ' ').trim();
        const internationalUnavailable = /not available to (?:eu and )?(?:international|overseas)/i.test(combined);
        const externallyFunded = /no self funded option available|fees for this course are paid by|paid by health education england|uk fees are paid by your trust|paid by your trust or employer/i.test(combined);

        let candidates: FeeCandidate[] = [];
        for (const block of tuitionBlocks) {
            candidates.push(...this.extractFeeCandidatesFromText(block));
        }

        if (candidates.length === 0 && !externallyFunded) {
            candidates = this.extractFeeCandidatesFromText(combined);
        }

        const wantsPartTime = /part/i.test(String(studyMode || '').toLowerCase());
        let homeFee = this.pickFee(candidates, 'home', wantsPartTime);
        let internationalFee = internationalUnavailable
            ? null
            : this.pickFee(candidates, 'intl', wantsPartTime);

        // Southampton sometimes includes split-payment lines in the same tuition block.
        // If we see a swapped-looking pair, re-select using safest extrema from matched candidates.
        if (homeFee !== null && internationalFee !== null && internationalFee < homeFee) {
            const homeValues = this.orderedCandidateValues(candidates, 'home', wantsPartTime);
            const intlValues = this.orderedCandidateValues(candidates, 'intl', wantsPartTime);
            if (homeValues.length > 0 && intlValues.length > 0) {
                const bestHome = Math.min(...homeValues);
                const bestIntl = Math.max(...intlValues);
                if (bestIntl >= bestHome) {
                    homeFee = bestHome;
                    internationalFee = bestIntl;
                    debug(`Adjusted swapped-looking fee pair -> Home £${homeFee}, Intl £${internationalFee}`);
                }
            }
        }

        return {
            hasTuitionSection: true,
            internationalUnavailable,
            externallyFunded,
            homeFee,
            internationalFee
        };
    }

    private collectTuitionTextBlocks($: cheerio.CheerioAPI): string[] {
        const blocks: string[] = [];
        const seen = new Set<string>();

        $('h1,h2,h3,h4,h5').each((_idx: number, heading: Element) => {
            const headingText = this.normalizeText($(heading).text());
            if (!headingText.includes('tuition fees')) {
                return;
            }

            const container = $(heading).closest('section,article,div');
            if (container.length === 0) {
                return;
            }

            const segments: string[] = [];
            container.find('li,p,dd,dt').each((__idx: number, node: Element) => {
                const text = $(node).text().replace(/\s+/g, ' ').trim();
                if (!text) return;
                if (this.isNoiseText(text)) return;
                segments.push(text);
            });

            if (segments.length === 0) {
                const fallback = container.text().replace(/\s+/g, ' ').trim();
                if (fallback && !this.isNoiseText(fallback)) {
                    segments.push(fallback);
                }
            }

            const combined = segments.join(' ').trim();
            if (!combined || seen.has(combined)) {
                return;
            }

            seen.add(combined);
            blocks.push(combined);
        });

        return blocks;
    }

    private extractFeeCandidatesFromText(text: string): FeeCandidate[] {
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (!normalized) return [];

        const candidates: FeeCandidate[] = [];

        const sentenceLikeSegments = normalized.split(/(?<=[.!?;])\s+/);
        for (const segmentRaw of sentenceLikeSegments) {
            const segment = segmentRaw.trim();
            if (!segment || this.isNoiseText(segment)) continue;

            const amounts = this.extractAmounts(segment);
            if (amounts.length === 0) continue;

            const lower = this.normalizeText(segment);
            const mode = this.detectMode(lower);

            const typedHomeAmounts = this.extractTypedAmounts(segment, 'home');
            const typedIntlAmounts = this.extractTypedAmounts(segment, 'intl');
            const typedHome = typedHomeAmounts[0];
            const typedIntl = typedIntlAmounts[0];

            if (typedHome !== undefined || typedIntl !== undefined) {
                if (typedHome !== undefined) this.pushCandidate(candidates, 'home', mode, typedHome);
                if (typedIntl !== undefined) this.pushCandidate(candidates, 'intl', mode, typedIntl);
                continue;
            }

            const hasHome = /\b(uk|home)\b/.test(lower);
            const hasIntl = /\b(international|overseas)\b/.test(lower);
            const hasBothPhrase = /\b(uk|home)\b[^.]{0,60}\b(and|&)\b[^.]{0,60}\b(international|overseas)\b|\b(international|overseas)\b[^.]{0,60}\b(and|&)\b[^.]{0,60}\b(uk|home)\b/.test(lower);

            if (hasBothPhrase) {
                const first = amounts[0];
                const second = amounts[1];
                if (first !== undefined) {
                    this.pushCandidate(candidates, 'home', mode, first);
                    this.pushCandidate(candidates, 'intl', mode, second ?? first);
                }
                continue;
            }

            if (hasHome && hasIntl) {
                const first = amounts[0];
                const second = amounts[1];
                if (first !== undefined) {
                    this.pushCandidate(candidates, 'home', mode, first);
                    this.pushCandidate(candidates, 'intl', mode, second ?? first);
                }
                continue;
            }

            if (hasHome) {
                const first = amounts[0];
                if (first !== undefined) {
                    this.pushCandidate(candidates, 'home', mode, first);
                }
                continue;
            }

            if (hasIntl) {
                const first = amounts[0];
                if (first !== undefined) {
                    this.pushCandidate(candidates, 'intl', mode, first);
                }
            }
        }

        return this.uniqueCandidates(candidates);
    }

    private extractTypedAmounts(segment: string, type: FeeType): number[] {
        const regexes = type === 'home'
            ? [
                /\b(?:uk|home)\s+students?\s+pay\s+£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/gi,
                /£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s+for\s+(?:uk|home)\s+students?/gi,
                /\bfor\s+(?:uk|home)\s+students?[^£]{0,30}£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/gi
            ]
            : [
                /\b(?:eu\s+and\s+)?(?:international|overseas)\s+students?\s+pay\s+£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/gi,
                /£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s+for\s+(?:eu\s+and\s+)?(?:international|overseas)\s+students?/gi,
                /\bfor\s+(?:eu\s+and\s+)?(?:international|overseas)\s+students?[^£]{0,30}£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/gi
            ];

        const values: number[] = [];
        for (const regex of regexes) {
            let match: RegExpExecArray | null = null;
            while ((match = regex.exec(segment)) !== null) {
                const amount = this.toAmount(match[1]);
                if (amount === null) continue;
                if (this.isInstallmentContext(segment, match.index)) continue;
                values.push(amount);
            }
        }

        return values;
    }

    private isInstallmentContext(segment: string, amountIndex: number): boolean {
        const context = segment
            .slice(Math.max(0, amountIndex - 50), Math.min(segment.length, amountIndex + 140))
            .toLowerCase();

        return /first year|second year|third year|split into [0-9]+ payments|another £|another [0-9]/.test(context);
    }

    private extractAmounts(text: string): number[] {
        const amounts: number[] = [];
        const regex = /£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/g;
        let match: RegExpExecArray | null = null;

        while ((match = regex.exec(text)) !== null) {
            const parsed = this.toAmount(match[1]);
            if (parsed !== null) {
                amounts.push(parsed);
            }
        }

        return amounts;
    }

    private toAmount(raw: string | undefined): number | null {
        if (!raw) return null;
        const value = parseInt(raw.replace(/,/g, ''), 10);
        if (Number.isNaN(value) || value < 1000 || value > 100000) return null;
        return value;
    }

    private pushCandidate(candidates: FeeCandidate[], type: FeeType, mode: FeeMode, value: number | null): void {
        if (value === null) return;
        candidates.push({ type, mode, value });
    }

    private uniqueCandidates(candidates: FeeCandidate[]): FeeCandidate[] {
        const seen = new Set<string>();
        const unique: FeeCandidate[] = [];

        for (const candidate of candidates) {
            const key = `${candidate.type}:${candidate.mode}:${candidate.value}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(candidate);
        }

        return unique;
    }

    private detectMode(text: string): FeeMode {
        const normalized = this.normalizeText(text);
        if (/\bpart[- ]?time\b/.test(normalized)) return 'part';
        if (/\bfull[- ]?time\b/.test(normalized)) return 'full';
        return 'unknown';
    }

    private isNoiseText(text: string): boolean {
        const normalized = this.normalizeText(text);
        return /scholarship|bursary|deposit|grant|loan|stipend|discount|accommodation|living costs|cost of living|what your fees pay for|paying your fees|funding information/.test(normalized);
    }

    private pickFee(candidates: FeeCandidate[], type: FeeType, wantsPartTime: boolean): number | null {
        const ordered = this.orderedCandidateValues(candidates, type, wantsPartTime);
        return ordered[0] ?? null;
    }

    private orderedCandidateValues(candidates: FeeCandidate[], type: FeeType, wantsPartTime: boolean): number[] {
        const matchingType = candidates.filter(candidate => candidate.type === type);
        if (matchingType.length === 0) return [];

        const preferredMode: FeeMode = wantsPartTime ? 'part' : 'full';
        const alternateMode: FeeMode = wantsPartTime ? 'full' : 'part';

        const preferred = matchingType
            .filter(candidate => candidate.mode === preferredMode)
            .map(candidate => candidate.value);

        const unknown = matchingType
            .filter(candidate => candidate.mode === 'unknown')
            .map(candidate => candidate.value);

        const alternate = matchingType
            .filter(candidate => candidate.mode === alternateMode)
            .map(candidate => candidate.value);

        return [...preferred, ...unknown, ...alternate];
    }

    private selectHomeFee(southamptonFees: SouthamptonTuitionExtraction, genericFees: ScrapedFees): number | null {
        if (southamptonFees.homeFee !== null) {
            return southamptonFees.homeFee;
        }
        if (!southamptonFees.hasTuitionSection) {
            return genericFees.homeFee;
        }
        if (southamptonFees.externallyFunded) {
            return null;
        }
        return genericFees.homeFee;
    }

    private selectInternationalFee(southamptonFees: SouthamptonTuitionExtraction, genericFees: ScrapedFees): number | null {
        if (southamptonFees.internationalFee !== null) {
            return southamptonFees.internationalFee;
        }
        if (!southamptonFees.hasTuitionSection) {
            return genericFees.internationalFee;
        }
        if (southamptonFees.internationalUnavailable || southamptonFees.externallyFunded) {
            return null;
        }
        return genericFees.internationalFee;
    }

    private normalizeText(value: string): string {
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    private normalizeTitle(value: string): string {
        return value
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\b(msc|ma|mba|mres|mphil|llm|pgdip|pgcert|doctorate|doctor|postgraduate|undergraduate)\b/g, ' ')
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

        const denominator = Math.max(aTokens.size, bTokens.size);
        return Math.round((overlap / denominator) * 100);
    }
}
