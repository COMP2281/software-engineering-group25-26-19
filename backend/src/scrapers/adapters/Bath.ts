// src/scrapers/adapters/Bath.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import * as stringSimilarity from 'string-similarity';
import { IScraperAdapter, OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const TIMEOUT = 30000;
const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

type BathBand = 'band1' | 'band2' | 'band3';
type StudyLevel = 'ug' | 'pg';

interface UgBandState {
    home: number | null;
    band1: number | null;
    band2: number | null;
    band3: number | null;
}

interface PgCourseFee {
    rawName: string;
    homeFee: number | null;
    intlFee: number | null;
}

export class BathAdapter implements IScraperAdapter {
    private urls: { ug?: string, pg?: string[] };
    
    private ugBands: UgBandState | null = null;
    private pgCache: PgCourseFee[] | null = null;

    constructor(centralFeeUrls: { ug?: string, pg?: string[] }) {
        if (!centralFeeUrls) throw new Error("BathAdapter requires centralFeeUrls in config.ts");
        this.urls = centralFeeUrls;
    }

    async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const level: StudyLevel = courseUrl.toLowerCase().includes('postgraduate') ? 'pg' : 'ug';
        const results: OptionScrapeResult[] = [];

        // We only need to fetch the page/bands ONCE per course, not per option.
        // We use the title from the first context to determine the band/match.
        const courseTitle = contexts[0]?.courseTitle || '';

        let fees: ScrapedFees = { homeFee: null, internationalFee: null };

        if (level === 'ug') {
            // Fetch page content for UG banding logic
            const html = await this.fetchHtml(courseUrl);
            if (html) {
                const $ = cheerio.load(html);
                const pageText = $('body').text().toLowerCase().replace(/\s+/g, ' ');
                const h1Text = $('h1').first().text().toLowerCase().trim();
                fees = await this.handleUndergraduate(courseTitle, pageText, h1Text);
            }
        } else {
            // PG logic uses cached dictionary, no page fetch needed usually
            fees = await this.handlePostgraduate(courseTitle);
        }

        // Map the found fees to ALL options provided in the context
        for (const context of contexts) {
            results.push({
                optionId: context.optionId,
                homeFee: fees.homeFee,
                internationalFee: fees.internationalFee
            });
        }

        return results;
    }

    // ==========================================
    // UNDERGRADUATE LOGIC (Banding)
    // ==========================================
    private async handleUndergraduate(dbCourseTitle: string, pageText: string, h1Text: string): Promise<ScrapedFees> {
        if (!this.ugBands) await this.loadUgCentralFees();
        if (!this.ugBands) return { homeFee: null, internationalFee: null };

        let targetBand: BathBand | null = null;
        const title = dbCourseTitle.toLowerCase();
        
        const context = `${title} ${h1Text} ${pageText.substring(0, 2000)}`;

        // Band 2: Management & Economics
        if (/(management|business|accounting|finance|economics)/.test(title) || /(school of management|department of economics)/.test(context)) {
            targetBand = 'band2';
        } 
        // Band 3: Science, Engineering, Health, Psychology
        else if (/(science|engineering|health|psychology|bioscience|chemistry|physics|mathematics|computer|architecture|pharmacy|pharmacology|aerospace|civil|mechanical|electrical)/.test(title) || /(faculty of science|faculty of engineering|department for health|department of psychology)/.test(context)) {
            targetBand = 'band3';
        } 
        // Band 1: Humanities & Social Sciences
        else if (/(humanities|social science|language|politics|education|sociology|criminology|sport|policy|history|french|spanish|german)/.test(title) || /(faculty of humanities)/.test(context)) {
            targetBand = 'band1';
        }

        if (DEBUG) console.log(`[DEBUG] UG Mapped DB Title "${dbCourseTitle}" (H1: "${h1Text}") to ${targetBand ? targetBand.toUpperCase() : 'UNKNOWN'}`);

        return {
            homeFee: this.ugBands.home,
            internationalFee: targetBand ? this.ugBands[targetBand] : null
        };
    }

    private async loadUgCentralFees() {
        if (!this.urls.ug) return;
        if (DEBUG) console.log(`[DEBUG] Lazy-loading UG central fees...`);
        
        const html = await this.fetchHtml(this.urls.ug);
        if (!html) return;

        const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ');

        this.ugBands = {
            home: this.extractPriceAfterKeyword(text, 'full-time campus-based', 9000) || 
                  this.extractPriceAfterKeyword(text, 'home students', 9000),
            band1: this.extractPriceAfterKeyword(text, 'band 1', 15000),
            band2: this.extractPriceAfterKeyword(text, 'band 2', 15000),
            band3: this.extractPriceAfterKeyword(text, 'band 3', 15000)
        };
    }

    // ==========================================
    // POSTGRADUATE LOGIC (Bulk HTML Tables)
    // ==========================================
    private async handlePostgraduate(dbCourseTitle: string): Promise<ScrapedFees> {
        if (!this.pgCache) await this.loadPgCentralFees();
        if (!this.pgCache || this.pgCache.length === 0) return { homeFee: null, internationalFee: null };

        const normalizedTitle = dbCourseTitle.toLowerCase().replace(/\b(msc|ma|mba|mres|pgdip|pgcert)\b/gi, '').replace(/[(),\-&]/g, ' ').replace(/\s+/g, ' ').trim();

        const cacheNames = this.pgCache.map(c => c.rawName);
        const matchResult = stringSimilarity.findBestMatch(normalizedTitle, cacheNames);
        const bestMatch = matchResult.bestMatch;

        if (bestMatch.rating > 0.55) {
            const target = this.pgCache.find(c => c.rawName === bestMatch.target);
            if (target) {
                if (DEBUG) console.log(`[DEBUG] PG Fuzzy Matched: "${dbCourseTitle}" -> "${target.rawName}" (Score: ${bestMatch.rating.toFixed(2)})`);
                return {
                    homeFee: target.homeFee,
                    internationalFee: target.intlFee
                };
            }
        }

        if (DEBUG) console.log(`[DEBUG] PG Match Failed for "${dbCourseTitle}". Best guess: "${bestMatch.target}" (Score: ${bestMatch.rating.toFixed(2)})`);
        return { homeFee: null, internationalFee: null };
    }

    private async loadPgCentralFees() {
        if (!this.urls.pg || this.urls.pg.length === 0) return;
        if (DEBUG) console.log(`[DEBUG] Lazy-loading PG central fees from ${this.urls.pg.length} pages...`);
        
        this.pgCache = [];

        for (const url of this.urls.pg) {
            const html = await this.fetchHtml(url);
            if (!html) continue;

            const $ = cheerio.load(html);
            
            $('table').each((_, table) => {
                $(table).find('tr').each((_, tr) => {
                    const cells = $(tr).find('td');
                    if (cells.length >= 2) {
                        const rawName = $(cells[0]).text().toLowerCase().replace(/\b(msc|ma|mba|mres|pgdip|pgcert)\b/gi, '').replace(/[(),\-&]/g, ' ').replace(/\s+/g, ' ').trim();
                        
                        const fees: number[] = [];
                        cells.each((i, td) => {
                            if (i === 0) return; 
                            const price = this.extractPriceFromSimpleString($(td).text());
                            if (price) fees.push(price);
                        });

                        if (rawName && fees.length > 0) {
                            const intlFee = Math.max(...fees);
                            const homeCandidates = fees.filter(f => f < intlFee);
                            const homeFee = homeCandidates.length > 0 ? Math.min(...homeCandidates) : (fees.length === 1 ? intlFee : null);

                            this.pgCache!.push({ rawName, homeFee, intlFee });
                        }
                    }
                });
            });
        }
        if (DEBUG) console.log(`[DEBUG] Successfully cached ${this.pgCache.length} PG courses into memory.`);
    }

    // ==========================================
    // UTILS
    // ==========================================
    private extractPriceAfterKeyword(text: string, keyword: string, minExpected: number): number | null {
        const regex = new RegExp(`${keyword}[^£]{0,800}£\\s?([0-9]{1,3}(,[0-9]{3})*)`, 'i');
        const match = text.match(regex);
        if (match && match[1]) {
            const price = parseInt(match[1].replace(/,/g, ''), 10);
            if (price >= minExpected && price < 80000) return price;
        }
        return null;
    }

    private extractPriceFromSimpleString(text: string): number | null {
        const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/;
        const match = regex.exec(text);
        if (match && match[1]) {
            const val = parseInt(match[1].replace(/,/g, ''), 10);
            if (val > 1000 && val < 80000) return val;
        }
        return null;
    }

    private async fetchHtml(url: string): Promise<string | null> {
        try {
            const response = await axios.get(url, { headers: HEADERS_BROWSER, timeout: 10000 });
            if (response.status < 400) return response.data;
        } catch (e) {}

        if (puppeteer) {
            let browser: any = null;
            try {
                browser = await puppeteer.launch({ headless: "new", args:['--no-sandbox'] });
                const page = await browser.newPage();
                await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
                await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
                return await page.content();
            } catch (e) {
            } finally {
                if (browser) await browser.close();
            }
        }
        return null;
    }
}