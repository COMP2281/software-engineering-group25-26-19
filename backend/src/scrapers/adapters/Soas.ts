import axios from 'axios';
import * as stringSimilarity from 'string-similarity';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

const DEBUG = true;
const FETCH_TIMEOUT_MS = 15000;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9'
};

function debug(msg: string): void {
    if (DEBUG) Logger.debug(`[DEBUG] SOAS: ${msg}`);
}

export class SoasAdapter extends GenericHtmlAdapter {
    private sitemapUrlsPromise: Promise<string[]> | null = null;
    private titleResolutionCache = new Map<string, string | null>();

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const resolvedUrl = await this.resolveCourseUrl(courseUrl, contexts);
        return super.scrapeCourse(resolvedUrl, contexts);
    }

    protected override sanitizeForStudyMode(html: string, _studyMode: string): string {
        return html;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (isPdf) {
            return super.parseHtml(html, context, isPdf);
        }

        const soasFees = this.extractSoasFees(html);
        const genericFees = await super.parseHtml(html, context, false);

        const result: ScrapedFees = {
            homeFee: soasFees.homeFee ?? genericFees.homeFee,
            internationalFee: soasFees.internationalFee ?? genericFees.internationalFee
        };

        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }

        return result;
    }

    private async resolveCourseUrl(initialUrl: string, contexts: ScrapeContext[]): Promise<string> {
        const normalized = this.normalizeIncomingUrl(initialUrl);
        const title = contexts[0]?.courseTitle || '';
        const qualification = contexts[0]?.outcomeQualification || '';

        if (!normalized) {
            const resolved = await this.resolveByTitle(title, qualification);
            return resolved || normalized;
        }

        const redirected = await this.followRedirect(normalized);
        const candidate = redirected || normalized;

        if (this.isCanonicalSoasCourseUrl(candidate)) {
            return candidate;
        }

        const resolved = await this.resolveByTitle(title, qualification);
        if (resolved) return resolved;
        return candidate;
    }

    private normalizeIncomingUrl(url: string): string {
        const trimmed = String(url || '').trim();
        if (!trimmed) return '';

        try {
            const parsed = new URL(trimmed);
            parsed.hash = '';
            if (parsed.protocol === 'http:') parsed.protocol = 'https:';
            return parsed.toString();
        } catch {
            return trimmed;
        }
    }

    private isCanonicalSoasCourseUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            if (!/soas\.ac\.uk$/i.test(parsed.hostname)) return false;
            return /\/study\/find-course\/[^/]+\/?$/i.test(parsed.pathname);
        } catch {
            return false;
        }
    }

    private async followRedirect(url: string): Promise<string | null> {
        try {
            const response = await axios.get(url, {
                headers: HEADERS_BROWSER,
                timeout: FETCH_TIMEOUT_MS,
                maxRedirects: 5,
                validateStatus: status => status < 500
            });

            const finalUrl = String(response?.request?.res?.responseUrl || '').trim();
            if (!finalUrl) return null;
            if (response.status >= 400) return null;
            return finalUrl;
        } catch {
            return null;
        }
    }

    private async resolveByTitle(courseTitle: string, outcomeQualification: string): Promise<string | null> {
        const key = `${this.normalizeTitle(courseTitle)}|${this.normalizeQualification(outcomeQualification)}`;
        if (this.titleResolutionCache.has(key)) {
            return this.titleResolutionCache.get(key) || null;
        }

        const urls = await this.getCourseUrlsFromSitemap();
        if (urls.length === 0) {
            this.titleResolutionCache.set(key, null);
            return null;
        }

        const target = this.normalizeTitle(courseTitle);
        if (!target) {
            this.titleResolutionCache.set(key, null);
            return null;
        }

        const qualification = this.normalizeQualification(outcomeQualification);
        const filtered = this.filterByQualification(urls, qualification);
        const candidates = filtered.length > 0 ? filtered : urls;

        let bestUrl: string | null = null;
        let bestScore = -1;

        for (const url of candidates) {
            const slug = this.urlSlug(url);
            if (!slug) continue;

            const candidateTitle = this.normalizeTitle(slug);
            if (!candidateTitle) continue;

            let score = stringSimilarity.compareTwoStrings(target, candidateTitle);
            score += this.tokenOverlapScore(target, candidateTitle) / 200;

            if (candidateTitle === target) score += 1;
            if (candidateTitle.includes(target) || target.includes(candidateTitle)) score += 0.2;

            if (qualification && slug.includes(qualification)) score += 0.15;

            if (score > bestScore) {
                bestScore = score;
                bestUrl = url;
            }
        }

        const accepted = bestScore >= 0.3 ? bestUrl : null;
        if (accepted) {
            debug(`Resolved URL by title "${courseTitle}" -> ${accepted}`);
        }

        this.titleResolutionCache.set(key, accepted);
        return accepted;
    }

    private async getCourseUrlsFromSitemap(): Promise<string[]> {
        if (!this.sitemapUrlsPromise) {
            this.sitemapUrlsPromise = this.loadCourseUrlsFromSitemap();
        }
        return this.sitemapUrlsPromise;
    }

    private async loadCourseUrlsFromSitemap(): Promise<string[]> {
        const urls: string[] = [];
        const seen = new Set<string>();

        try {
            const indexResponse = await axios.get('https://www.soas.ac.uk/sitemap.xml', {
                headers: HEADERS_BROWSER,
                timeout: FETCH_TIMEOUT_MS,
                validateStatus: status => status < 500
            });

            const indexXml = String(indexResponse.data || '');
            const childSitemaps = this.extractXmlLocs(indexXml);

            for (const child of childSitemaps) {
                try {
                    const pageResponse = await axios.get(child, {
                        headers: HEADERS_BROWSER,
                        timeout: FETCH_TIMEOUT_MS,
                        validateStatus: status => status < 500
                    });

                    const pageXml = String(pageResponse.data || '');
                    for (const loc of this.extractXmlLocs(pageXml)) {
                        if (!/\/study\/find-course\/[^/]+\/?$/i.test(loc)) continue;
                        if (seen.has(loc)) continue;
                        seen.add(loc);
                        urls.push(loc);
                    }
                } catch {
                    continue;
                }
            }
        } catch {
            return [];
        }

        debug(`Loaded ${urls.length} canonical find-course URLs from SOAS sitemap.`);
        return urls;
    }

    private extractXmlLocs(xml: string): string[] {
        const locs: string[] = [];
        const regex = /<loc>([^<]+)<\/loc>/gi;
        let match: RegExpExecArray | null = null;

        while ((match = regex.exec(xml)) !== null) {
            const value = String(match[1] || '').trim();
            if (value) locs.push(value);
        }
        return locs;
    }

    private filterByQualification(urls: string[], qualification: string): string[] {
        if (!qualification) return urls;

        const out: string[] = [];
        for (const url of urls) {
            const slug = this.urlSlug(url);
            if (!slug) continue;

            if (
                qualification === 'ma' ||
                qualification === 'msc' ||
                qualification === 'mres' ||
                qualification === 'pgdip' ||
                qualification === 'pgcert'
            ) {
                if (slug.startsWith(`${qualification}-`) || slug.includes(`-${qualification}-`) || slug.endsWith(`-${qualification}`)) {
                    out.push(url);
                }
                continue;
            }

            if (qualification.includes('mphil') || qualification.includes('phd')) {
                if (slug.includes('mphil') || slug.includes('phd') || slug.includes('research-degrees')) {
                    out.push(url);
                }
                continue;
            }
        }

        return out;
    }

    private extractSoasFees(html: string): ScrapedFees {
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        const directPair = text.match(
            /home\s*:?\s*(?:tuition\s*fees[^£]{0,40})?£\s*([0-9]{1,3}(?:,[0-9]{3})*)\s*international\s*:?\s*(?:tuition\s*fees[^£]{0,40})?£\s*([0-9]{1,3}(?:,[0-9]{3})*)/i
        );
        if (directPair?.[1] && directPair?.[2]) {
            return {
                homeFee: this.toAmount(directPair[1]),
                internationalFee: this.toAmount(directPair[2])
            };
        }

        const ukOverseasPair = text.match(
            /(?:uk|home)[^£]{0,80}£\s*([0-9]{1,3}(?:,[0-9]{3})*)[^£]{0,180}(?:overseas|international)[^£]{0,80}£\s*([0-9]{1,3}(?:,[0-9]{3})*)/i
        );
        if (ukOverseasPair?.[1] && ukOverseasPair?.[2]) {
            return {
                homeFee: this.toAmount(ukOverseasPair[1]),
                internationalFee: this.toAmount(ukOverseasPair[2])
            };
        }

        return { homeFee: null, internationalFee: null };
    }

    private toAmount(raw: string | undefined): number | null {
        if (!raw) return null;
        const parsed = parseInt(raw.replace(/,/g, ''), 10);
        if (Number.isNaN(parsed) || parsed < 1000 || parsed > 120000) return null;
        return parsed;
    }

    private normalizeQualification(value: string): string {
        const normalized = String(value || '').toLowerCase();
        if (normalized.includes('msc')) return 'msc';
        if (normalized.includes('ma')) return 'ma';
        if (normalized.includes('mres')) return 'mres';
        if (normalized.includes('pgdip')) return 'pgdip';
        if (normalized.includes('pgcert') || normalized.includes('pg cert')) return 'pgcert';
        if (normalized.includes('mphil') || normalized.includes('phd')) return 'mphil-phd';
        return normalized.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    private urlSlug(url: string): string {
        try {
            const path = new URL(url).pathname.replace(/\/+$/, '');
            const slug = path.split('/').pop() || '';
            return slug.toLowerCase();
        } catch {
            return '';
        }
    }

    private normalizeTitle(value: string): string {
        return String(value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\b(with|the|of|for|in|at|a|an|and|or|programme|programmes|degree|course|msc|ma|mres|pgdip|pgcert)\b/g, ' ')
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
}
