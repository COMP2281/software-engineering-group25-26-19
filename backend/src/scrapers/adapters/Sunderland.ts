import axios from 'axios';
import * as stringSimilarity from 'string-similarity';
import * as vm from 'node:vm';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';

const DEBUG = true;
const FETCH_TIMEOUT_MS = 15000;
const CONTENSIS_ROOT = 'https://api-uos.cloud.contensis.com';
const CONTENSIS_PROJECT = 'website';
const CONTENSIS_TOKEN = 'e2SBh3m1bqR4km7Q0y6tyA2gKJNLPgbD643i25URcN5Lfq16B';

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

interface SunderlandCourseEntry {
    entryTitle?: string;
    url?: string;
    level?: { entryTitle?: string } | null;
}

interface IntakeLike {
    mode?: string;
    award?: string;
    academicYear?: string;
    fee?: {
        uk?: string;
        international?: string;
    };
}

function debug(msg: string): void {
    if (DEBUG) console.log(`[DEBUG] Sunderland: ${msg}`);
}

export class SunderlandAdapter extends GenericHtmlAdapter {
    private courseIndexPromise: Promise<SunderlandCourseEntry[]> | null = null;
    private titleResolutionCache = new Map<string, string | null>();

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const resolvedUrl = await this.resolveCourseUrl(courseUrl, contexts);
        return super.scrapeCourse(resolvedUrl, contexts);
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (isPdf) {
            return super.parseHtml(html, context, isPdf);
        }

        const reduxFees = this.extractFeesFromRedux(html, context);
        const inlineFees = this.extractFeesFromInlineText(html);
        const genericFees = await super.parseHtml(html, context, false);

        const result: ScrapedFees = {
            homeFee: reduxFees.homeFee ?? inlineFees.homeFee ?? genericFees.homeFee,
            internationalFee: reduxFees.internationalFee ?? inlineFees.internationalFee ?? genericFees.internationalFee
        };

        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }

        return result;
    }

    private async resolveCourseUrl(initialUrl: string, contexts: ScrapeContext[]): Promise<string> {
        const normalized = this.normalizeIncomingUrl(initialUrl);
        const primaryContext = contexts[0];
        const title = primaryContext?.courseTitle || '';

        if (!primaryContext || !title) {
            return normalized;
        }

        if (!normalized || this.isKnownGenericPage(normalized)) {
            const resolved = await this.resolveByTitle(title, primaryContext);
            if (resolved) return resolved;
            return normalized;
        }

        return normalized;
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

            const clean = parsed.toString();
            if (clean !== trimmed) {
                debug(`Normalized course URL -> ${clean}`);
            }
            return clean;
        } catch {
            return trimmed;
        }
    }

    private isKnownGenericPage(url: string): boolean {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname.toLowerCase();
            const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');

            if (!/sunderland\.ac\.uk$/.test(host)) return false;
            if (path === '' || path === '/') return true;
            if (path === '/find-a-course') return true;
            if (path.startsWith('/study/')) return true;

            return false;
        } catch {
            return false;
        }
    }

    private async resolveByTitle(courseTitle: string, context: ScrapeContext): Promise<string | null> {
        const key = `${this.normalizeTitle(courseTitle)}|${this.normalizeQualification(context.outcomeQualification || '')}`;
        if (this.titleResolutionCache.has(key)) {
            return this.titleResolutionCache.get(key) || null;
        }

        const entries = await this.getCourseIndex();
        if (entries.length === 0) {
            this.titleResolutionCache.set(key, null);
            return null;
        }

        const target = this.normalizeTitle(courseTitle);
        let bestUrl: string | null = null;
        let bestScore = -1;

        for (const entry of entries) {
            const rawTitle = String(entry.entryTitle || '').trim();
            const candidateTitle = this.normalizeTitle(rawTitle);
            if (!candidateTitle) continue;

            let score = stringSimilarity.compareTwoStrings(target, candidateTitle);
            score += this.tokenOverlapScore(target, candidateTitle) / 200;

            if (candidateTitle === target) score += 1;
            if (candidateTitle.includes(target) || target.includes(candidateTitle)) score += 0.2;

            const targetQualification = this.normalizeQualification(context.outcomeQualification || '');
            if (targetQualification && candidateTitle.includes(targetQualification)) {
                score += 0.15;
            }

            const resolvedUrl = this.toAbsoluteUrl(String(entry.url || '').trim());
            if (!resolvedUrl) continue;

            if (score > bestScore) {
                bestScore = score;
                bestUrl = resolvedUrl;
            }
        }

        const accepted = bestScore >= 0.35 ? bestUrl : null;
        if (accepted) {
            debug(`Resolved course URL by title "${courseTitle}" -> ${accepted}`);
        }

        this.titleResolutionCache.set(key, accepted);
        return accepted;
    }

    private async getCourseIndex(): Promise<SunderlandCourseEntry[]> {
        if (!this.courseIndexPromise) {
            this.courseIndexPromise = this.fetchCourseIndex();
        }
        return this.courseIndexPromise;
    }

    private async fetchCourseIndex(): Promise<SunderlandCourseEntry[]> {
        const allEntries: SunderlandCourseEntry[] = [];
        const contentTypes = ['searchCourse', 'searchOnlineCourse'];

        for (const contentType of contentTypes) {
            const entries = await this.fetchContentTypeEntries(contentType);
            allEntries.push(...entries);
        }

        const deduped: SunderlandCourseEntry[] = [];
        const seen = new Set<string>();
        for (const entry of allEntries) {
            const title = this.normalizeTitle(String(entry.entryTitle || ''));
            const url = this.toAbsoluteUrl(String(entry.url || '').trim());
            if (!title || !url) continue;
            const key = `${title}|${url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push({
                entryTitle: String(entry.entryTitle || ''),
                url
            });
        }

        debug(`Loaded ${deduped.length} search entries from Sunderland internal API.`);
        return deduped;
    }

    private async fetchContentTypeEntries(contentType: string): Promise<SunderlandCourseEntry[]> {
        const endpoint = `${CONTENSIS_ROOT}/api/delivery/projects/${CONTENSIS_PROJECT}/contentTypes/${contentType}/entries`;
        const entries: SunderlandCourseEntry[] = [];
        let pageIndex = 0;
        const pageSize = 100;

        while (true) {
            try {
                const response = await axios.get(endpoint, {
                    headers: {
                        ...HEADERS_BROWSER,
                        'Accept': 'application/json',
                        'accessToken': CONTENSIS_TOKEN
                    },
                    params: {
                        pageSize,
                        pageIndex,
                        fields: 'entryTitle,url,level,format',
                        language: 'en-GB',
                        versionStatus: 'published'
                    },
                    timeout: FETCH_TIMEOUT_MS,
                    validateStatus: status => status < 500
                });

                if (response.status >= 400) {
                    debug(`Content API ${contentType} failed with status ${response.status}`);
                    break;
                }

                const batch = Array.isArray(response.data?.items)
                    ? response.data.items as SunderlandCourseEntry[]
                    : [];

                entries.push(...batch);
                if (batch.length < pageSize) {
                    break;
                }
                pageIndex += 1;
            } catch (error) {
                debug(`Content API ${contentType} request failed: ${error instanceof Error ? error.message : String(error)}`);
                break;
            }
        }

        return entries;
    }

    private extractFeesFromRedux(html: string, context: ScrapeContext): ScrapedFees {
        const redux = this.extractReduxData(html);
        const intakesRaw = redux?.routing?.mappedEntry?.keyInformation?.intakes;
        const intakes: IntakeLike[] = Array.isArray(intakesRaw) ? intakesRaw : [];

        if (intakes.length === 0) {
            return { homeFee: null, internationalFee: null };
        }

        const scored = intakes
            .map(intake => ({ intake, score: this.scoreIntake(intake, context) }))
            .sort((a, b) => b.score - a.score);

        let homeFee: number | null = null;
        let internationalFee: number | null = null;

        for (const entry of scored) {
            const currentHome = this.toAmount(entry.intake?.fee?.uk);
            const currentIntl = this.toAmount(entry.intake?.fee?.international);

            if (homeFee === null && currentHome !== null) homeFee = currentHome;
            if (internationalFee === null && currentIntl !== null) internationalFee = currentIntl;

            if (homeFee !== null && internationalFee !== null) break;
        }

        return { homeFee, internationalFee };
    }

    private extractFeesFromInlineText(html: string): ScrapedFees {
        const compact = String(html || '').replace(/\s+/g, ' ');
        const homeMatch = compact.match(/fee\s*\(?(?:uk|home)\)?[^£]{0,60}(?:£|&pound;)\s*([0-9]{1,3}(?:,[0-9]{3})*)/i);
        const intlMatch = compact.match(/fee\s*\(?(?:int|international|overseas)\)?[^£]{0,60}(?:£|&pound;)\s*([0-9]{1,3}(?:,[0-9]{3})*)/i);

        return {
            homeFee: this.toAmount(homeMatch?.[1]),
            internationalFee: this.toAmount(intlMatch?.[1])
        };
    }

    private scoreIntake(intake: IntakeLike, context: ScrapeContext): number {
        let score = 0;
        const mode = this.normalizeMode(intake.mode || '');
        const targetMode = this.normalizeMode(context.studyMode || '');
        const year = this.extractYear(intake.academicYear || '');
        const targetYear = Number(context.year);
        const award = this.normalizeQualification(intake.award || '');
        const targetAward = this.normalizeQualification(context.outcomeQualification || '');

        if (targetMode && mode) {
            if (targetMode === mode) score += 5;
            else score -= 3;
        }

        if (year && targetYear) {
            if (year === targetYear) score += 5;
            else score -= Math.min(2, Math.abs(year - targetYear));
        }

        if (targetAward && award) {
            if (targetAward === award) score += 4;
            else if (award.includes(targetAward) || targetAward.includes(award)) score += 2;
        }

        if (this.toAmount(intake?.fee?.uk) !== null) score += 1;
        if (this.toAmount(intake?.fee?.international) !== null) score += 1;
        return score;
    }

    private extractReduxData(html: string): any | null {
        const marker = 'window.REDUX_DATA';
        const idx = html.indexOf(marker);
        if (idx < 0) return null;

        // Sunderland emits REDUX_DATA as JS object literal in a script block.
        // Evaluate the script in a sandbox first (handles non-strict JSON shapes).
        try {
            const scriptStart = html.lastIndexOf('<script', idx);
            const scriptOpen = html.indexOf('>', scriptStart);
            const scriptEnd = html.indexOf('</script>', idx);

            if (scriptStart >= 0 && scriptOpen >= 0 && scriptEnd >= 0) {
                const scriptBody = html.slice(scriptOpen + 1, scriptEnd);
                const context: any = { window: {}, undefined: undefined };
                vm.createContext(context);
                vm.runInContext(scriptBody, context, { timeout: 1200 });
                if (context?.window?.REDUX_DATA) {
                    return context.window.REDUX_DATA;
                }
            }
        } catch {
            // Continue to JSON fallback below.
        }

        const assignIdx = html.indexOf('=', idx);
        if (assignIdx < 0) return null;

        let start = assignIdx + 1;
        while (start < html.length && html[start] !== '{') start += 1;
        if (start >= html.length) return null;

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < html.length; i++) {
            const ch = html[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }

            if (ch === '"') inString = true;
            else if (ch === '{') depth += 1;
            else if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    try {
                        return JSON.parse(html.slice(start, i + 1));
                    } catch {
                        return null;
                    }
                }
            }
        }

        return null;
    }

    private toAbsoluteUrl(url: string): string | null {
        if (!url) return null;
        try {
            return new URL(url, 'https://www.sunderland.ac.uk').toString();
        } catch {
            return null;
        }
    }

    private normalizeMode(mode: string): string {
        const value = mode.toLowerCase();
        if (value.includes('part')) return 'part-time';
        if (value.includes('full')) return 'full-time';
        return value.replace(/\s+/g, ' ').trim();
    }

    private extractYear(value: string): number | null {
        const match = String(value || '').match(/20\d{2}/);
        if (!match) return null;
        const parsed = parseInt(match[0], 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    private normalizeQualification(value: string): string {
        return String(value || '')
            .toLowerCase()
            .replace(/[().,/]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private normalizeTitle(value: string): string {
        return String(value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\b(with|the|of|for|in|at|a|an|top up|top-up)\b/g, ' ')
            .replace(/\b(ba|bsc|beng|llb|llm|ma|msc|mres|mba|mphil|pgdip|pgcert|fdsc|hnd|hons)\b/g, ' ')
            .replace(/[^a-z0-9 ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
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

    private toAmount(raw: string | number | null | undefined): number | null {
        if (raw === null || raw === undefined) return null;

        if (typeof raw === 'number') {
            if (!Number.isFinite(raw)) return null;
            const rounded = Math.round(raw);
            return rounded >= 1000 && rounded <= 100000 ? rounded : null;
        }

        const text = String(raw).trim();
        if (!text) return null;

        const currencyMatch = text.match(/(?:£|&pound;)\s*([0-9]{1,3}(?:,[0-9]{3})*)/i);
        if (currencyMatch?.[1]) {
            const value = parseInt(currencyMatch[1].replace(/,/g, ''), 10);
            if (!Number.isNaN(value) && value >= 1000 && value <= 100000) return value;
        }

        const plainNumberMatch = text.match(/\b([0-9]{4,6}(?:\.[0-9]+)?)\b/);
        if (!plainNumberMatch?.[1]) return null;

        const parsed = Math.round(Number(plainNumberMatch[1].replace(/,/g, '')));
        if (Number.isNaN(parsed) || parsed < 1000 || parsed > 100000) return null;
        return parsed;
    }
}
