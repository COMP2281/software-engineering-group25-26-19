// src/scrapers/adapters/StAndrews.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import * as stringSimilarity from 'string-similarity';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';

const DEBUG = true;
const FETCH_TIMEOUT_MS = 15000;
const SEARCH_ENDPOINT = 'https://www.st-andrews.ac.uk/search/';

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

type DegreeKey =
    | 'default'
    | 'msc'
    | 'mlitt'
    | 'ma'
    | 'mfa'
    | 'llm'
    | 'mres'
    | 'mphil'
    | 'pgdip'
    | 'pgcert'
    | 'single_module'
    | 'other';

interface FeeEntry {
    key: DegreeKey;
    label: string;
    homeFee: number | null;
    internationalFee: number | null;
}

interface SearchCandidate {
    url: string;
    text: string;
}

function debug(msg: string): void {
    if (DEBUG) console.log(`[DEBUG] StAndrews: ${msg}`);
}

export class StAndrewsAdapter extends GenericHtmlAdapter {
    private courseUrlCache = new Map<string, string | null>();

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const primaryTitle = contexts[0]?.courseTitle || '';
        const normalizedUrl = this.normalizeIncomingUrl(courseUrl);
        const shouldTryInitial = normalizedUrl.length > 0 && !this.isKnownUselessUrl(normalizedUrl);

        let initialResults: OptionScrapeResult[] = [];
        if (shouldTryInitial) {
            initialResults = await super.scrapeCourse(normalizedUrl, contexts);
            if (this.hasAnyFees(initialResults)) {
                return initialResults;
            }
        }

        if (!primaryTitle) {
            return initialResults;
        }

        const resolvedUrl = await this.resolveCourseUrlByTitle(primaryTitle);
        if (!resolvedUrl) {
            return initialResults;
        }
        if (resolvedUrl === normalizedUrl && initialResults.length > 0) {
            return initialResults;
        }

        debug(`Resolved course URL by title "${primaryTitle}" -> ${resolvedUrl}`);
        const resolvedResults = await super.scrapeCourse(resolvedUrl, contexts);
        if (this.hasAnyFees(resolvedResults) || initialResults.length === 0) {
            return resolvedResults;
        }

        return initialResults;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (isPdf) {
            return super.parseHtml(html, context, isPdf);
        }

        const $ = cheerio.load(html);
        const customFees = this.extractStAndrewsFees($, context);
        const genericFees = await super.parseHtml(html, context, false);

        const result: ScrapedFees = {
            homeFee: customFees.homeFee ?? genericFees.homeFee,
            internationalFee: customFees.internationalFee ?? genericFees.internationalFee
        };

        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }

        return result;
    }

    private hasAnyFees(results: OptionScrapeResult[]): boolean {
        return results.some(result => result.homeFee !== null || result.internationalFee !== null);
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

            const normalized = parsed.toString();
            if (normalized !== trimmed) {
                debug(`Normalized course URL -> ${normalized}`);
            }
            return normalized;
        } catch {
            return trimmed;
        }
    }

    private isKnownUselessUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname.toLowerCase();
            const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();

            if (!/st-andrews\.ac\.uk$/.test(host)) return true;
            if (path === '' || path === '/') return true;
            if (/\/study\/pg\/taught-programmes\//i.test(path)) return true;

            return false;
        } catch {
            return true;
        }
    }

    private async resolveCourseUrlByTitle(courseTitle: string): Promise<string | null> {
        const cacheKey = this.normalizeTitle(courseTitle);
        if (!cacheKey) return null;

        if (this.courseUrlCache.has(cacheKey)) {
            return this.courseUrlCache.get(cacheKey) || null;
        }

        try {
            const response = await axios.get(SEARCH_ENDPOINT, {
                headers: HEADERS_BROWSER,
                params: { query: courseTitle },
                timeout: FETCH_TIMEOUT_MS,
                validateStatus: s => s < 500
            });

            if (response.status >= 400) {
                this.courseUrlCache.set(cacheKey, null);
                return null;
            }

            const $ = cheerio.load(String(response.data));
            const candidates = this.extractSearchCandidates($);
            if (candidates.length === 0) {
                this.courseUrlCache.set(cacheKey, null);
                return null;
            }

            const target = this.normalizeTitle(courseTitle);
            let bestUrl: string | null = null;
            let bestScore = -1;

            for (const candidate of candidates) {
                const candidateTitle = this.normalizeTitle(this.cleanCandidateText(candidate.text));
                if (!candidateTitle) continue;

                let score = stringSimilarity.compareTwoStrings(target, candidateTitle);
                score += this.tokenOverlapScore(target, candidateTitle) / 200;

                if (candidateTitle === target) score += 1;
                if (candidateTitle.includes(target) || target.includes(candidateTitle)) score += 0.2;

                if (this.isLikelyPostgraduateCandidate(candidate.url, candidate.text)) score += 0.25;
                if (this.isLikelyUndergraduateCandidate(candidate.url, candidate.text)) score -= 0.45;

                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = candidate.url;
                }
            }

            const accepted = bestScore >= 0.2 ? bestUrl : null;
            this.courseUrlCache.set(cacheKey, accepted);
            return accepted;
        } catch (error) {
            debug(`Search resolution failed for "${courseTitle}": ${error instanceof Error ? error.message : String(error)}`);
            this.courseUrlCache.set(cacheKey, null);
            return null;
        }
    }

    private extractSearchCandidates($: cheerio.CheerioAPI): SearchCandidate[] {
        const candidates: SearchCandidate[] = [];

        $('a[href]').each((_idx: number, anchor: Element) => {
            const href = String($(anchor).attr('href') || '').trim();
            if (!href || href.startsWith('#') || /^javascript:/i.test(href) || /^mailto:/i.test(href)) return;

            const text = $(anchor).text().replace(/\s+/g, ' ').trim();
            if (!text) return;

            const resolved = this.resolveSearchHref(href);
            if (!resolved) return;

            if (!this.isCourseLikePath(resolved)) return;

            candidates.push({
                url: resolved,
                text
            });
        });

        const unique: SearchCandidate[] = [];
        const seen = new Set<string>();
        for (const candidate of candidates) {
            const key = `${candidate.url}|${candidate.text}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(candidate);
        }
        return unique;
    }

    private resolveSearchHref(rawHref: string): string | null {
        try {
            const abs = new URL(rawHref, 'https://www.st-andrews.ac.uk');

            if (/\/s1\/redirect/i.test(abs.pathname)) {
                const redirectTarget = abs.searchParams.get('url');
                if (!redirectTarget) return null;
                try {
                    const decoded = decodeURIComponent(redirectTarget);
                    return new URL(decoded, 'https://www.st-andrews.ac.uk').toString();
                } catch {
                    return new URL(redirectTarget, 'https://www.st-andrews.ac.uk').toString();
                }
            }

            return abs.toString();
        } catch {
            return null;
        }
    }

    private isCourseLikePath(url: string): boolean {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname.toLowerCase();
            if (!/st-andrews\.ac\.uk$/.test(host)) return false;

            const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
            if (!path || path === '/') return false;

            if (/\/subjects\/course-search$/.test(path)) return false;
            if (/\/subjects\/modules$/.test(path)) return false;
            if (/\/subjects$/.test(path)) return false;
            if (/\/search\/?/.test(path)) return false;

            return (
                /^\/subjects\/[^/]+\/[^/]+/.test(path) ||
                /^\/study\/pg\//.test(path) ||
                /\/prospective\/pgr\//.test(path)
            );
        } catch {
            return false;
        }
    }

    private isLikelyPostgraduateCandidate(url: string, text: string): boolean {
        const combined = `${url} ${text}`.toLowerCase();
        return /(?:-msc|-mlitt|-ma|-mfa|-pgdip|-pgcert|-llm|-mres|-mphil|\/prospective\/pgr\/|postgraduate|pg online)/.test(combined);
    }

    private isLikelyUndergraduateCandidate(url: string, text: string): boolean {
        const combined = `${url} ${text}`.toLowerCase();
        return /(?:-bsc|-beng|-meng|-mphys|-msci|\/undergraduate\/|ucas code|honours degree)/.test(combined);
    }

    private cleanCandidateText(value: string): string {
        return value
            .replace(/https?:\/\/\S+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private extractStAndrewsFees($: cheerio.CheerioAPI, context: ScrapeContext): ScrapedFees {
        const focusTexts = this.extractFeeFocusTexts($);
        if (focusTexts.length === 0) {
            return { homeFee: null, internationalFee: null };
        }

        const entriesByKey = new Map<DegreeKey, FeeEntry>();
        let internationalUnavailable = false;

        for (const text of focusTexts) {
            if (/not available to (?:international|overseas)|not open to international/i.test(text)) {
                internationalUnavailable = true;
            }

            for (const entry of this.parseFeeEntries(text)) {
                const existing = entriesByKey.get(entry.key);
                if (!existing) {
                    entriesByKey.set(entry.key, entry);
                    continue;
                }

                entriesByKey.set(entry.key, {
                    key: existing.key,
                    label: existing.label || entry.label,
                    homeFee: existing.homeFee ?? entry.homeFee,
                    internationalFee: existing.internationalFee ?? entry.internationalFee
                });
            }
        }

        const entries = [...entriesByKey.values()];
        if (entries.length === 0) {
            return { homeFee: null, internationalFee: null };
        }

        const selected = this.selectFeeEntry(entries, context);
        if (!selected) {
            return { homeFee: null, internationalFee: null };
        }

        const homeFee = selected.homeFee;
        let internationalFee = selected.internationalFee;

        if (internationalUnavailable) {
            internationalFee = null;
        } else if (internationalFee === null && homeFee !== null) {
            // Some online courses publish one fee that applies to all.
            internationalFee = homeFee;
        }

        return { homeFee, internationalFee };
    }

    private extractFeeFocusTexts($: cheerio.CheerioAPI): string[] {
        const sources: string[] = [];
        const seen = new Set<string>();

        const bodyText = $('body').text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const summary = this.extractSummaryFeeWindow(bodyText);
        if (summary && !seen.has(summary)) {
            seen.add(summary);
            sources.push(summary);
        }

        const anchor = $('#fees').first();
        if (anchor.length > 0) {
            const container = anchor.closest('section,article,div');
            const text = container.text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            if (text && !seen.has(text)) {
                seen.add(text);
                sources.push(text);
            }
        }

        $('h2,h3').each((_idx: number, heading: Element) => {
            const headingText = $(heading).text().replace(/\s+/g, ' ').trim().toLowerCase();
            if (!(headingText.includes('fees and funding') || headingText === 'fees')) return;

            const container = $(heading).closest('section,article,div');
            const text = container.text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            if (text && !seen.has(text)) {
                seen.add(text);
                sources.push(text);
            }
        });

        return sources;
    }

    private extractSummaryFeeWindow(bodyText: string): string {
        const normalized = bodyText.replace(/\s+/g, ' ').trim();
        if (!normalized) return '';

        const lower = normalized.toLowerCase();
        let start = lower.indexOf('fees and funding');
        if (start === -1) {
            start = lower.indexOf(' fees ');
        }
        if (start === -1) return '';

        let end = Math.min(normalized.length, start + 2600);
        for (const marker of [
            'why study this course?',
            'highlights',
            'entry requirements',
            'modules',
            'teaching',
            'assessment',
            'careers',
            'start your journey'
        ]) {
            const idx = lower.indexOf(marker, start + 30);
            if (idx !== -1 && idx < end) {
                end = idx;
            }
        }

        return normalized.slice(start, end).trim();
    }

    private parseFeeEntries(text: string): FeeEntry[] {
        const entries: FeeEntry[] = [];
        const compact = text.replace(/\s+/g, ' ').trim();
        if (!compact) return entries;

        const dualLabelRegex = /(MSc|MLitt|MA|MFA|PGDip|PGCert|LLM|MRes|MPhil|Single module(?:\s*\([^)]*\))?)\s*:\s*(?:Home|UK)\s*:?\s*£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*,?\s*(?:Overseas|International|Rest of the world|EU and overseas)\s*:?\s*£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/gi;
        let dualMatch: RegExpExecArray | null = null;
        while ((dualMatch = dualLabelRegex.exec(compact)) !== null) {
            const label = dualMatch[1] || '';
            entries.push({
                key: this.labelToDegreeKey(label),
                label,
                homeFee: this.toAmount(dualMatch[2]),
                internationalFee: this.toAmount(dualMatch[3])
            });
        }

        const genericDualRegex = /(?:^|\bFees\b[^£]{0,60})(?:UK|Home)\s*£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})[^£]{0,100}(?:Rest of the world|Overseas|International|EU and overseas)\s*£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/i;
        const genericDualMatch = genericDualRegex.exec(compact);
        if (genericDualMatch?.[1] && genericDualMatch[2]) {
            entries.push({
                key: 'default',
                label: 'default',
                homeFee: this.toAmount(genericDualMatch[1]),
                internationalFee: this.toAmount(genericDualMatch[2])
            });
        }

        const singleLabelRegex = /(MSc|MLitt|MA|MFA|PGDip|PGCert|LLM|MRes|MPhil|Single module(?:\s*\([^)]*\))?)\s*:\s*£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/gi;
        let singleMatch: RegExpExecArray | null = null;
        while ((singleMatch = singleLabelRegex.exec(compact)) !== null) {
            const label = singleMatch[1] || '';
            const amount = this.toAmount(singleMatch[2]);
            entries.push({
                key: this.labelToDegreeKey(label),
                label,
                homeFee: amount,
                internationalFee: amount
            });
        }

        const estimatedTotalRegex = /estimated total fee of\s*£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/i;
        const estimatedMatch = estimatedTotalRegex.exec(compact);
        if (estimatedMatch?.[1]) {
            const amount = this.toAmount(estimatedMatch[1]);
            entries.push({
                key: 'default',
                label: 'default',
                homeFee: amount,
                internationalFee: amount
            });
        }

        if (entries.length === 0) {
            const fallbackSingleRegex = /\bFees\b[^£]{0,50}£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/i;
            const fallbackSingleMatch = fallbackSingleRegex.exec(compact);
            if (fallbackSingleMatch?.[1]) {
                const amount = this.toAmount(fallbackSingleMatch[1]);
                entries.push({
                    key: 'default',
                    label: 'default',
                    homeFee: amount,
                    internationalFee: amount
                });
            }
        }

        return this.uniqueEntries(entries);
    }

    private uniqueEntries(entries: FeeEntry[]): FeeEntry[] {
        const deduped: FeeEntry[] = [];
        const seen = new Set<string>();
        for (const entry of entries) {
            const key = `${entry.key}:${entry.homeFee}:${entry.internationalFee}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(entry);
        }
        return deduped;
    }

    private selectFeeEntry(entries: FeeEntry[], context: ScrapeContext): FeeEntry | null {
        if (entries.length === 0) return null;
        if (entries.length === 1) return entries[0] || null;

        const combined = `${context.courseTitle} ${context.duration || ''} ${context.studyMode || ''}`.toLowerCase();
        const courseTitle = (context.courseTitle || '').toLowerCase();
        const outcomeQualification = (context.outcomeQualification || '').toLowerCase();
        const duration = (context.duration || '').toLowerCase();
        const studyMode = (context.studyMode || '').toLowerCase();

        const findByKey = (key: DegreeKey): FeeEntry | null => entries.find(entry => entry.key === key) || null;

        const explicitOutcomeKeys = this.extractExplicitDegreeKeys(outcomeQualification);
        if (explicitOutcomeKeys.length === 1) {
            const direct = findByKey(explicitOutcomeKeys[0] || 'other');
            if (direct) return direct;
        }

        const explicitKeys = [
            ...new Set([
                ...explicitOutcomeKeys,
                ...this.extractExplicitDegreeKeys(courseTitle)
            ])
        ];

        if (explicitKeys.length === 1) {
            const direct = findByKey(explicitKeys[0] || 'other');
            if (direct) return direct;
        }

        if (/single module|15\s*week/.test(combined)) {
            const single = findByKey('single_module');
            if (single) return single;
        }

        if (/(nine|9)\s*months?/.test(duration)) {
            const pgdip = findByKey('pgdip');
            if (pgdip) return pgdip;
        }
        if (/(six|6)\s*months?/.test(duration)) {
            const pgcert = findByKey('pgcert');
            if (pgcert) return pgcert;
        }
        if (/(two|2)\s*years?/.test(duration)) {
            const pgdip = findByKey('pgdip');
            if (pgdip) return pgdip;
        }
        if (/(three|3|four|4|five|5)\s*years?/.test(duration)) {
            for (const key of ['msc', 'mlitt', 'ma', 'mfa', 'llm', 'mres', 'mphil'] as DegreeKey[]) {
                const match = findByKey(key);
                if (match) return match;
            }
        }
        if (/(one|1)\s*year/.test(duration)) {
            if (studyMode.includes('part')) {
                const pgcert = findByKey('pgcert');
                if (pgcert) return pgcert;
            }
            for (const key of ['msc', 'mlitt', 'ma', 'mfa', 'llm', 'mres', 'mphil'] as DegreeKey[]) {
                const match = findByKey(key);
                if (match) return match;
            }
        }

        for (const key of ['msc', 'mlitt', 'ma', 'mfa', 'llm', 'mres', 'mphil', 'pgdip', 'pgcert', 'single_module', 'default'] as DegreeKey[]) {
            const match = findByKey(key);
            if (match) return match;
        }

        return entries[0] || null;
    }

    private extractExplicitDegreeKeys(text: string): DegreeKey[] {
        const value = String(text || '').toLowerCase();
        const keys: DegreeKey[] = [];
        if (/\bpgdip\b/.test(value)) keys.push('pgdip');
        if (/\bpgcert\b/.test(value)) keys.push('pgcert');
        if (/\bmlitt\b/.test(value)) keys.push('mlitt');
        if (/\bmsc\b/.test(value)) keys.push('msc');
        if (/\bmfa\b/.test(value)) keys.push('mfa');
        if (/\bllm\b/.test(value)) keys.push('llm');
        if (/\bmres\b/.test(value)) keys.push('mres');
        if (/\bmphil\b/.test(value)) keys.push('mphil');
        if (/\bma\b/.test(value)) keys.push('ma');
        if (/single module/.test(value)) keys.push('single_module');

        return [...new Set(keys)];
    }

    private labelToDegreeKey(label: string): DegreeKey {
        const lower = label.toLowerCase();
        if (lower.includes('single module')) return 'single_module';
        if (lower.includes('pgcert')) return 'pgcert';
        if (lower.includes('pgdip')) return 'pgdip';
        if (lower.includes('mlitt')) return 'mlitt';
        if (lower.includes('msc')) return 'msc';
        if (/\bma\b/.test(lower)) return 'ma';
        if (lower.includes('mfa')) return 'mfa';
        if (lower.includes('llm')) return 'llm';
        if (lower.includes('mres')) return 'mres';
        if (lower.includes('mphil')) return 'mphil';
        return 'other';
    }

    private toAmount(raw: string | undefined): number | null {
        if (!raw) return null;
        const value = parseInt(raw.replace(/,/g, ''), 10);
        if (Number.isNaN(value) || value < 1000 || value > 100000) return null;
        return value;
    }

    private normalizeTitle(value: string): string {
        return value
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\b(msc|mlitt|ma|mfa|pgdip|pgcert|llm|mres|mphil|online|subjects)\b/g, ' ')
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
