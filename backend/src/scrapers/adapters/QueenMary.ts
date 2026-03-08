// src/scrapers/adapters/QueenMary.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import * as stringSimilarity from 'string-similarity';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';

const DEBUG = true;
const FETCH_TIMEOUT_MS = 15000;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

const SEARCH_ENDPOINT = 'https://searchcloud-1-eu-west-2.searchstax.com/29847/qmu-1736/emselect';
const SEARCH_TOKEN = 'bc0d2578c3f22cca23fdb327f7490ddb56098759';

interface SearchDoc {
    id?: string;
    url?: string[] | string;
    coursename_t?: string;
}

interface PgFeeBlock {
    mode: 'full' | 'part' | 'unknown';
    homeFee: number | null;
    internationalFee: number | null;
}

interface UgFeeSection extends ScrapedFees {
    title: string;
}

function debug(msg: string): void {
    if (DEBUG) console.log(`[DEBUG] QueenMary: ${msg}`);
}

export class QueenMaryAdapter extends GenericHtmlAdapter {
    private courseFinderCache = new Map<string, string | null>();

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const resolvedUrl = await this.resolveCourseUrl(courseUrl, contexts);
        return super.scrapeCourse(resolvedUrl, contexts);
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (isPdf) {
            return super.parseHtml(html, context, isPdf);
        }

        const $ = cheerio.load(html);
        const isUndergraduateLayout = $('section.study-option').length > 0 || /undergraduate\/coursefinder\/courses\//i.test($.html());

        let qmulFees: ScrapedFees;
        if (isUndergraduateLayout) {
            qmulFees = this.extractUndergraduateFees($, context);
        } else {
            qmulFees = this.extractPostgraduateFees($, context);
        }

        const genericFees = await super.parseHtml(html, context, false);
        const result: ScrapedFees = {
            homeFee: qmulFees.homeFee ?? genericFees.homeFee,
            internationalFee: qmulFees.internationalFee ?? genericFees.internationalFee
        };
        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }
        return result;
    }

    private async resolveCourseUrl(initialUrl: string, contexts: ScrapeContext[]): Promise<string> {
        const normalized = this.stripTrackingParams(initialUrl);
        const primaryTitle = contexts[0]?.courseTitle || '';

        if (!normalized && primaryTitle) {
            const resolvedFromTitle = await this.resolvePostgraduateCourseByTitle(primaryTitle);
            if (resolvedFromTitle) {
                debug(`Resolved missing DB URL by title "${primaryTitle}" -> ${resolvedFromTitle}`);
                return resolvedFromTitle;
            }
            debug(`Could not resolve missing DB URL by title "${primaryTitle}"`);
            return normalized;
        }

        if (this.looksLikeGenericPostgraduateFinder(normalized) && primaryTitle) {
            const resolved = await this.resolvePostgraduateCourseByTitle(primaryTitle);
            if (resolved) return resolved;
        }

        return normalized;
    }

    private stripTrackingParams(url: string): string {
        const trimmed = (url || '').trim();
        if (!trimmed) return '';

        try {
            const parsed = new URL(trimmed);
            parsed.search = '';
            parsed.hash = '';
            const clean = parsed.toString();
            if (clean !== trimmed) {
                debug(`Removed query params -> ${clean}`);
            }
            return clean;
        } catch {
            return trimmed;
        }
    }

    private looksLikeGenericPostgraduateFinder(url: string): boolean {
        try {
            const parsed = new URL(url);
            const path = parsed.pathname.replace(/\/+$/, '');
            return path === '/postgraduate/coursefinder' || path === '/postgraduate/taught/coursefinder';
        } catch {
            return false;
        }
    }

    private async resolvePostgraduateCourseByTitle(courseTitle: string): Promise<string | null> {
        const cacheKey = this.normalizeTitle(courseTitle);
        if (this.courseFinderCache.has(cacheKey)) {
            return this.courseFinderCache.get(cacheKey) || null;
        }

        try {
            const response = await axios.get(SEARCH_ENDPOINT, {
                headers: {
                    ...HEADERS_BROWSER,
                    'Accept': 'application/json',
                    'Authorization': `Token ${SEARCH_TOKEN}`
                },
                params: {
                    q: courseTitle,
                    rows: 15,
                    wt: 'json',
                    fl: 'url,coursename_t,id',
                    model: 'coursefinder-pg',
                    language: 'en'
                },
                timeout: FETCH_TIMEOUT_MS
            });

            const docs: SearchDoc[] = response.data?.response?.docs || [];
            if (docs.length === 0) {
                this.courseFinderCache.set(cacheKey, null);
                return null;
            }

            const target = this.selectBestSearchDoc(docs, courseTitle);
            const pickedUrl = this.extractDocUrl(target);
            this.courseFinderCache.set(cacheKey, pickedUrl);

            if (pickedUrl) {
                debug(`Resolved generic PG coursefinder URL by title "${courseTitle}" -> ${pickedUrl}`);
            }
            return pickedUrl;
        } catch (error) {
            debug(`Failed to resolve generic PG URL for "${courseTitle}": ${error instanceof Error ? error.message : String(error)}`);
            this.courseFinderCache.set(cacheKey, null);
            return null;
        }
    }

    private selectBestSearchDoc(docs: SearchDoc[], courseTitle: string): SearchDoc | null {
        const normalizedTarget = this.normalizeTitle(courseTitle);
        const candidates = docs.map(doc => {
            const candidateTitle = this.normalizeTitle(doc.coursename_t || '');
            return {
                doc,
                score: stringSimilarity.compareTwoStrings(normalizedTarget, candidateTitle)
            };
        });

        candidates.sort((a, b) => b.score - a.score);
        return candidates[0]?.doc || null;
    }

    private extractDocUrl(doc: SearchDoc | null): string | null {
        if (!doc) return null;

        const urlField = doc.url;
        if (Array.isArray(urlField) && urlField[0]) {
            return this.stripTrackingParams(urlField[0]);
        }
        if (typeof urlField === 'string' && urlField) {
            return this.stripTrackingParams(urlField);
        }
        if (doc.id) {
            return this.stripTrackingParams(doc.id);
        }
        return null;
    }

    private extractPostgraduateFees($: cheerio.CheerioAPI, context: ScrapeContext): ScrapedFees {
        const wantedPartTime = (context.studyMode || '').toLowerCase().includes('part');
        const blocks = this.extractPostgraduateFeeBlocks($);
        const selected = this.selectPostgraduateBlock(blocks, wantedPartTime);

        if (selected) {
            return {
                homeFee: selected.homeFee,
                internationalFee: selected.internationalFee
            };
        }

        // Fallback: inspect the whole page text for direct "Home: £... Overseas: £..." pairs.
        const bodyText = $('body').text().replace(/\s+/g, ' ');
        return this.extractHomeOverseasPair(bodyText);
    }

    private extractPostgraduateFeeBlocks($: cheerio.CheerioAPI): PgFeeBlock[] {
        const blocks: PgFeeBlock[] = [];

        $('#course-funding .fees__option--fixed').each((_idx: number, el: Element) => {
            const modeText = this.normalizeText($(el).find('h3').first().text());
            const blockText = $(el).text().replace(/\s+/g, ' ');
            const pair = this.extractHomeOverseasPair(blockText);

            if (pair.homeFee !== null || pair.internationalFee !== null) {
                blocks.push({
                    mode: modeText.includes('part-time') ? 'part' : (modeText.includes('full-time') ? 'full' : 'unknown'),
                    homeFee: pair.homeFee,
                    internationalFee: pair.internationalFee
                });
            }
        });

        // Secondary source on the same pages.
        $('.info-panel__items dd').each((_idx: number, el: Element) => {
            const text = $(el).text().replace(/\s+/g, ' ');
            if (!/home\s*:/i.test(text) || !/(overseas|international)\s*:/i.test(text)) return;

            const pair = this.extractHomeOverseasPair(text);
            if (pair.homeFee !== null || pair.internationalFee !== null) {
                blocks.push({
                    mode: text.toLowerCase().includes('part-time') ? 'part' : (text.toLowerCase().includes('full-time') ? 'full' : 'unknown'),
                    homeFee: pair.homeFee,
                    internationalFee: pair.internationalFee
                });
            }
        });

        return blocks;
    }

    private selectPostgraduateBlock(blocks: PgFeeBlock[], wantPartTime: boolean): PgFeeBlock | null {
        if (blocks.length === 0) return null;

        if (wantPartTime) {
            const part = blocks.find(b => b.mode === 'part');
            if (part) return part;
        } else {
            const full = blocks.find(b => b.mode === 'full');
            if (full) return full;
        }

        const unknown = blocks.find(b => b.mode === 'unknown');
        if (unknown) return unknown;
        return blocks[0] || null;
    }

    private extractUndergraduateFees($: cheerio.CheerioAPI, context: ScrapeContext): ScrapedFees {
        const sections: UgFeeSection[] = [];

        $('section.study-option').each((_idx: number, section: Element) => {
            const title = $(section).find('h3').first().text().replace(/\s+/g, ' ').trim();
            const html = $(section).html() || '';
            const pair = this.extractHomeOverseasPair(html);
            sections.push({
                title,
                homeFee: pair.homeFee,
                internationalFee: pair.internationalFee
            });
        });

        if (sections.length > 0) {
            const chosen = this.selectBestUndergraduateSection(sections, context.courseTitle);
            if (chosen) {
                return {
                    homeFee: chosen.homeFee,
                    internationalFee: chosen.internationalFee
                };
            }
        }

        // Fallback to first pair found in page.
        const bodyHtml = $.html();
        return this.extractHomeOverseasPair(bodyHtml);
    }

    private selectBestUndergraduateSection(sections: UgFeeSection[], courseTitle: string): UgFeeSection | null {
        const target = this.normalizeTitle(courseTitle);
        const sectionTitles = sections.map(s => this.normalizeTitle(s.title));
        const bestMatch = stringSimilarity.findBestMatch(target, sectionTitles).bestMatch;

        const idx = sectionTitles.findIndex(t => t === bestMatch.target);
        if (idx >= 0 && sections[idx]) return sections[idx];
        return sections[0] || null;
    }

    private extractHomeOverseasPair(text: string): ScrapedFees {
        const compact = text.replace(/\s+/g, ' ');

        const homeMatch = compact.match(/home[^£&]{0,60}(?:£|&pound;)\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        const overseasMatch = compact.match(/(?:overseas|international)[^£&]{0,80}(?:£|&pound;)\s?([0-9]{1,3}(,[0-9]{3})*)/i);

        return {
            homeFee: this.toAmount(homeMatch?.[1]),
            internationalFee: this.toAmount(overseasMatch?.[1])
        };
    }

    private toAmount(raw: string | undefined): number | null {
        if (!raw) return null;
        const value = parseInt(raw.replace(/,/g, ''), 10);
        if (Number.isNaN(value) || value < 1000 || value > 100000) return null;
        return value;
    }

    private normalizeText(value: string): string {
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    private normalizeTitle(value: string): string {
        return value
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\b(msc|ma|mba|mres|mphil|llm|pgdip|pgcert|beng|meng|hons)\b/g, ' ')
            .replace(/[^a-z0-9 ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
