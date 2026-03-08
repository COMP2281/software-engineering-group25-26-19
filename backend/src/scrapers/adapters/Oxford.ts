// src/scrapers/adapters/Oxford.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

const DEBUG = true;
const RESOLUTION_HOPS = 3;
const FETCH_TIMEOUT_MS = 10000;
const MAX_AZ_PAGES = 8;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

function debug(msg: string): void {
    if (DEBUG) Logger.debug(`[DEBUG] Oxford: ${msg}`);
}

export class OxfordAdapter extends GenericHtmlAdapter {
    private azCourseIndexPromise: Promise<Map<string, string[]>> | null = null;

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const resolvedUrl = await this.resolveCourseUrl(courseUrl, contexts);
        const scraped = await super.scrapeCourse(resolvedUrl, contexts);

        const byOptionId = new Map(scraped.map(result => [result.optionId, result]));

        return contexts.map((context) => {
            const existing = byOptionId.get(context.optionId) ?? {
                optionId: context.optionId,
                homeFee: null,
                internationalFee: null
            };

            const bothMissing = existing.homeFee === null && existing.internationalFee === null;
            if (bothMissing && this.isFoundationCourse(context, resolvedUrl)) {
                debug(`Applying foundation zero-fee fallback for option ${context.optionId}`);
                return {
                    ...existing,
                    homeFee: 0,
                    internationalFee: 0
                };
            }

            return existing;
        });
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        const oxfordFees = this.extractOxfordAnnualFeeTable(html);
        const genericFees = await super.parseHtml(html, context, isPdf);
        const result: ScrapedFees = {
            homeFee: oxfordFees.homeFee ?? genericFees.homeFee,
            internationalFee: oxfordFees.internationalFee ?? genericFees.internationalFee
        };
        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }
        return result;
    }

    private async resolveCourseUrl(initialUrl: string, contexts: ScrapeContext[]): Promise<string> {
        let currentUrl = initialUrl;
        const seen = new Set<string>();
        const primaryTitle = contexts[0]?.courseTitle || '';

        // Oxford graduate UCAS listing pages include a `course` query param.
        // Their frontend JS rewrites the "Proceed to course page" link using this param;
        // we replicate that rewrite directly so we don't scrape the generic A-Z listing.
        const directGraduateCourseUrl = this.rewriteUcasListingUrl(currentUrl);
        if (directGraduateCourseUrl) {
            debug(`Resolved ucas-listings URL -> ${directGraduateCourseUrl}`);
            return directGraduateCourseUrl;
        }

        for (let hop = 0; hop < RESOLUTION_HOPS; hop++) {
            if (seen.has(currentUrl)) break;
            seen.add(currentUrl);

            const html = await this.fetchHtml(currentUrl);
            if (!html) break;

            const $ = cheerio.load(html);
            const isGraduateListingPage = this.looksLikeGraduateListingPage($);
            if (!isGraduateListingPage) break;

            const proceedUrl = this.extractProceedUrl($, currentUrl);
            if (!proceedUrl || proceedUrl === currentUrl) break;

            const rewrittenProceedUrl = this.rewriteProceedUrlWithCourseParam(currentUrl, proceedUrl);
            debug(`Resolved graduate listing URL -> ${rewrittenProceedUrl}`);
            currentUrl = rewrittenProceedUrl;
        }

        if (this.isAzListingUrl(currentUrl) && primaryTitle) {
            const mappedUrl = await this.resolveFromAzListingByTitle(currentUrl, primaryTitle, contexts);
            if (mappedUrl) {
                debug(`Resolved A-Z listing by title "${primaryTitle}" -> ${mappedUrl}`);
                return mappedUrl;
            }
        }

        return currentUrl;
    }

    private rewriteUcasListingUrl(url: string): string | null {
        try {
            const parsed = new URL(url);
            const isGraduateUcasListing = /\/admissions\/graduate\/courses\/ucas-listings\/?$/.test(parsed.pathname);
            if (!isGraduateUcasListing) return null;

            const courseParam = this.normalizeCourseToken(parsed.searchParams.get('course'));
            if (!courseParam) return null;

            parsed.pathname = parsed.pathname.replace(/\/ucas-listings\/?$/, `/${courseParam}`);
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        } catch {
            return null;
        }
    }

    private rewriteProceedUrlWithCourseParam(sourceUrl: string, proceedUrl: string): string {
        try {
            const source = new URL(sourceUrl);
            const courseParam = this.normalizeCourseToken(source.searchParams.get('course'));
            if (!courseParam) return proceedUrl;

            const target = new URL(proceedUrl, sourceUrl);
            if (!/\/courses-a-z-listing\/?$/.test(target.pathname)) return target.toString();

            target.pathname = target.pathname.replace(/\/courses-a-z-listing\/?$/, `/${courseParam}`);
            target.search = '';
            target.hash = '';
            return target.toString();
        } catch {
            return proceedUrl;
        }
    }

    private isAzListingUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return /\/admissions\/graduate\/courses\/courses-a-z-listing\/?$/.test(parsed.pathname);
        } catch {
            return false;
        }
    }

    private async resolveFromAzListingByTitle(
        listingUrl: string,
        courseTitle: string,
        contexts: ScrapeContext[]
    ): Promise<string | null> {
        const index = await this.getAzCourseIndex(listingUrl);
        const normalizedTitle = this.normalizeTitle(courseTitle);
        if (!normalizedTitle) return null;

        const candidates = index.get(normalizedTitle);
        if (!candidates || candidates.length === 0) return null;

        if (candidates.length === 1 && candidates[0]) return candidates[0];

        const wantsPartTime = contexts.some(c => /part/i.test(c.studyMode || ''));
        const wantsOnlyPartTime = wantsPartTime && contexts.every(c => /part/i.test(c.studyMode || ''));

        if (wantsOnlyPartTime) {
            const partTimeUrl = candidates.find(c => /(?:-pt|-part-time)\b/i.test(c));
            if (partTimeUrl) return partTimeUrl;
        }

        const nonPartTimeUrl = candidates.find(c => !/(?:-pt|-part-time)\b/i.test(c));
        if (nonPartTimeUrl) return nonPartTimeUrl;

        return candidates[0] || null;
    }

    private async getAzCourseIndex(listingUrl: string): Promise<Map<string, string[]>> {
        if (!this.azCourseIndexPromise) {
            this.azCourseIndexPromise = this.buildAzCourseIndex(listingUrl);
        }
        return this.azCourseIndexPromise;
    }

    private async buildAzCourseIndex(listingUrl: string): Promise<Map<string, string[]>> {
        const index = new Map<string, string[]>();
        const firstHtml = await this.fetchHtml(listingUrl);
        if (!firstHtml) return index;

        const firstPage = new URL(listingUrl);
        firstPage.searchParams.delete('page');
        firstPage.hash = '';

        const pageNumbers = this.extractAzPageNumbers(firstHtml);
        const maxPage = Math.min(MAX_AZ_PAGES, Math.max(0, ...pageNumbers));

        this.addAzEntries(index, firstHtml, firstPage.toString());

        for (let page = 1; page <= maxPage; page++) {
            const pageUrl = new URL(firstPage.toString());
            pageUrl.searchParams.set('page', String(page));
            const html = await this.fetchHtml(pageUrl.toString());
            if (!html) continue;
            this.addAzEntries(index, html, firstPage.toString());
        }

        return index;
    }

    private extractAzPageNumbers(html: string): number[] {
        const pageNumbers = new Set<number>([0]);
        const regex = /courses-a-z-listing\?page=(\d+)/gi;
        let match: RegExpExecArray | null = null;

        while ((match = regex.exec(html)) !== null) {
            const value = parseInt(match[1] || '', 10);
            if (!Number.isNaN(value)) pageNumbers.add(value);
        }

        return [...pageNumbers];
    }

    private addAzEntries(index: Map<string, string[]>, html: string, baseUrl: string): void {
        const $ = cheerio.load(html);
        $('div.course-title a[href]').each((_idx: number, el: Element) => {
            const href = $(el).attr('href');
            if (!href) return;

            const title = this.normalizeTitle($(el).text());
            if (!title) return;

            const url = new URL(href, baseUrl).toString();
            const existing = index.get(title) || [];
            if (!existing.includes(url)) {
                existing.push(url);
                index.set(title, existing);
            }
        });
    }

    private looksLikeGraduateListingPage($: cheerio.CheerioAPI): boolean {
        const combinedText = this.normalizeText(`${$('title').text()} ${$('body').text()}`);
        return (
            combinedText.includes('thank you for your interest in our graduate courses') ||
            combinedText.includes('graduate admissions pages') ||
            combinedText.includes('definitive source of information on graduate study')
        );
    }

    private extractProceedUrl($: cheerio.CheerioAPI, baseUrl: string): string | null {
        let found: string | null = null;

        $('a').each((_idx: number, el: Element) => {
            const href = $(el).attr('href');
            if (!href) return;

            const text = this.normalizeText($(el).text());
            const ariaLabel = this.normalizeText($(el).attr('aria-label') || '');

            const isProceedLink = (
                text.includes('proceed to course page') ||
                ariaLabel.includes('proceed to course page')
            );

            if (isProceedLink) {
                found = new URL(href, baseUrl).toString();
                return false;
            }

            return;
        });

        if (found) return found;

        // Fallback: capture meta refresh redirects if present.
        const refresh = $('meta[http-equiv="refresh"]').attr('content');
        if (refresh) {
            const match = refresh.match(/url\s*=\s*(.+)$/i);
            if (match && match[1]) {
                const cleaned = match[1].trim().replace(/^['"]|['"]$/g, '');
                if (cleaned) return new URL(cleaned, baseUrl).toString();
            }
        }

        return null;
    }

    private async fetchHtml(url: string): Promise<string | null> {
        try {
            const response = await axios.get(url, {
                headers: HEADERS_BROWSER,
                timeout: FETCH_TIMEOUT_MS,
                maxRedirects: 5,
                validateStatus: (status) => status < 500
            });

            if (response.status >= 400) {
                debug(`Failed to fetch ${url} (status ${response.status})`);
                return null;
            }

            return typeof response.data === 'string' ? response.data : response.data.toString('utf-8');
        } catch (error) {
            debug(`Failed to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    private isFoundationCourse(context: ScrapeContext, resolvedUrl: string): boolean {
        const combined = this.normalizeText(
            `${context.courseTitle} ${context.duration || ''} ${context.studyMode || ''} ${resolvedUrl}`
        );

        return (
            combined.includes('foundation year') ||
            combined.includes('year 0') ||
            combined.includes('year zero') ||
            combined.includes('foundation programme')
        );
    }

    private normalizeText(value: string): string {
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    private normalizeCourseToken(value: string | null): string | null {
        if (!value) return null;
        const token = value.trim().replace(/^\/+|\/+$/g, '');
        return token || null;
    }

    private normalizeTitle(value: string): string {
        return value
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^a-z0-9 ]/g, '')
            .trim();
    }

    private extractOxfordAnnualFeeTable(html: string): ScrapedFees {
        const $ = cheerio.load(html);
        const table = $('#feetable').first();
        if (table.length === 0) {
            return { homeFee: null, internationalFee: null };
        }

        let homeFee: number | null = null;
        let internationalFee: number | null = null;

        table.find('tr').each((_idx: number, tr: Element) => {
            const cells = $(tr).find('td');

            // Primary path for Oxford fees table rows:
            // [Fee status label] [Annual Course fees value]
            if (cells.length >= 2) {
                const label = this.normalizeText(cells.eq(0).text());
                const valueText = `${cells.eq(1).text()} ${cells.eq(1).html() || ''}`;
                const price = this.extractMoneyFromText(valueText);
                if (price === null) return;

                if (/\bhome\b|\buk\b/.test(label)) {
                    homeFee = price;
                    return;
                }
                if (/\binternational\b|\boverseas\b/.test(label)) {
                    internationalFee = price;
                    return;
                }
            }

            // Fallback for unexpected row structures
            const rowText = this.normalizeText($(tr).text());
            const price = this.extractMoneyFromText(rowText);
            if (price === null) return;

            if (/\bhome\b|\buk\b/.test(rowText)) {
                homeFee = price;
            } else if (/\binternational\b|\boverseas\b/.test(rowText)) {
                internationalFee = price;
            }
        });

        return { homeFee, internationalFee };
    }

    private extractMoneyFromText(text: string): number | null {
        const match = text.match(/(?:£|&pound;)\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (!match || !match[1]) return null;
        const value = parseInt(match[1].replace(/,/g, ''), 10);
        if (Number.isNaN(value) || value < 1000 || value > 100000) return null;
        return value;
    }
}
