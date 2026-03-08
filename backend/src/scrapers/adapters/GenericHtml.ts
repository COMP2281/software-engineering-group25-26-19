// src/scrapers/adapters/GenericHtml.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { IScraperAdapter, OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

let puppeteer: any;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    console.warn("Puppeteer not found. Install it with `npm install puppeteer` to enable advanced scraping.");
}

const pdfParse = require('pdf-parse');

const TIMEOUT = 30000;
// const DEBUG = true;
const MIN_FEE = 4500;
const MAX_FEE = 80000;

const TRAP_KEYWORDS = [
    'scholarship', 'bursary', 'funding', 'award', 'loan', 'grant', 'stipend', 
    'accommodation', 'living', 'housing', 'residence', 'bench fee', 
    'additional cost', 'maintenance', 'contribution', 'discount', 'advance'
];

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1'
};

type FeeType = 'home' | 'intl' | 'scotland';
type CheerioAny = Cheerio<AnyNode>;

interface FeeContext {
    home: number[];
    intl: number[];
    scotland: number[];
}

// function debug(msg: string) {
//     if (DEBUG) console.log(`[DEBUG] ${msg}`);
// }

export class GenericHtmlAdapter implements IScraperAdapter {
    
    async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        let rawHtml: string | null = null;
        let isPdf = false;

        // 1. Fetch Content
        try {
            Logger.debug(`Attempting Axios fetch: ${courseUrl}`);
            const response = await axios.get(courseUrl, {
                headers: HEADERS_BROWSER,
                timeout: 10000,
                responseType: 'arraybuffer',
                validateStatus: s => s < 500
            });

            if (response.status === 403 || response.status === 401) {
                throw new Error(`Axios blocked with status ${response.status}`);
            }

            const contentType = response.headers['content-type'] || '';
            
            if (courseUrl.toLowerCase().endsWith('.pdf') || contentType.includes('application/pdf')) {
                const buffer = Buffer.from(response.data);
                const pdfData = await pdfParse(buffer);
                rawHtml = pdfData.text.replace(/\s+/g, ' ');
                isPdf = true;
            } else {
                rawHtml = response.data.toString('utf-8');
                const $ = cheerio.load(rawHtml!);
                const bodyText = $('body').text().trim();
                if (bodyText.length < 500 && !rawHtml!.includes('£')) {
                    rawHtml = null;
                    Logger.debug("Axios returned empty shell. Switching to Puppeteer...");
                }
            }

        } catch (error) {
            Logger.debug(`Axios failed: ${error instanceof Error ? error.message : error}`);
        }

        // Puppeteer Fallback
        if (!rawHtml && !isPdf && puppeteer) {
            Logger.debug("Falling back to Puppeteer (Headless Browser)...");
            let browser: any = null;
            try {
                browser = await puppeteer.launch({ 
                    headless: "new",
                    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
                });
                const page = await browser.newPage();
                await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
                
                await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: TIMEOUT });

                try {
                    await page.waitForFunction(
                        'document.body.innerText.includes("£") || document.querySelector("table")',
                        { timeout: 5000 }
                    );
                } catch (e) { /* ignore timeout */ }

                rawHtml = await page.content();
                Logger.debug("Puppeteer render complete.");

            } catch (error) {
                Logger.debug(`Puppeteer failed: ${error instanceof Error ? error.message : error}`);
            } finally {
                if (browser) {
                    try { await browser.close(); } catch (e) {}
                }
            }
        }

        if (!rawHtml) {
            return [];
        }

        // 2. Parse for each Context
        const results: OptionScrapeResult[] = [];

        for (const context of contexts) {
            const modeSanitizedHtml = this.sanitizeForStudyMode(rawHtml, context.studyMode || '');
            
            // UPDATED: Pass context to parseHtml
            const fees = await this.parseHtml(modeSanitizedHtml, context, isPdf);
            
            results.push({
                optionId: context.optionId,
                ...fees
            });
        }

        return results;
    }

    protected sanitizeForStudyMode(html: string, studyMode: string): string {
        let clean = html;
        const mode = studyMode.toLowerCase();

        const partTimeRegex = /part-?time[^£]{0,80}£\s?[0-9,]+/gi;
        const fullTimeRegex = /full-?time[^£]{0,80}£\s?[0-9,]+/gi;
        const placementRegex = /(placement|sandwich|year in industry|study abroad)[^£]{0,80}£\s?[0-9,]+/gi;

        if (mode.includes('sandwich') || mode.includes('placement')) {
            clean = clean.replace(partTimeRegex, '');
        } 
        else if (mode.includes('part')) {
            clean = clean.replace(fullTimeRegex, '').replace(placementRegex, '');
        } 
        else {
            clean = clean.replace(partTimeRegex, '').replace(placementRegex, '');
        }

        return clean;
    }

    // UPDATED SIGNATURE: Added context parameter
    protected async parseHtml(html: string, _context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        let cleanHtml = html;

        if (!isPdf) {
            const $ = cheerio.load(cleanHtml);
            $('script, style, nav, footer, header').remove();
            
            $('*').each((_idx: number, el: AnyNode) => {
                const $el = $(el);
                const text = $el.text().toLowerCase();
                const attrStr = ($el.attr('class') || '') + ($el.attr('id') || '');
                
                if (TRAP_KEYWORDS.some(k => attrStr.includes(k))) {
                     $el.remove();
                } else if (text.length < 300 && TRAP_KEYWORDS.some(k => text.includes(k))) {
                     if (text.includes('value') || text.includes('award') || text.includes('up to')) {
                         $el.remove();
                     }
                }
            });
            cleanHtml = $.html();
        }

        const feeContext: FeeContext = { home: [], intl: [], scotland:[] };
        const $ = cheerio.load(cleanHtml);
        const body = $('body');

        this.parseTables($, body, feeContext);
        this.parseDivGrids($, body, feeContext);
        this.parseLabelValuePairs($, body, feeContext);

        const bodyText = body.text().replace(/\s+/g, ' ');
        const textFees = this.parseTextForFees(bodyText);
        
        if (textFees.homeFee) feeContext.home.push(textFees.homeFee);
        if (textFees.internationalFee) feeContext.intl.push(textFees.internationalFee);
        if (textFees.scotlandFee) feeContext.scotland.push(textFees.scotlandFee);

        return {
            homeFee: this.selectBestFee(feeContext.home, 'home'),
            internationalFee: this.selectBestFee(feeContext.intl, 'intl'),
            scotlandFee: this.selectBestFee(feeContext.scotland, 'scotland')
        };
    }

    // ... (Rest of methods: parseTextForFees, parseTables, parseDivGrids, parseLabelValuePairs, getContextLabel, getIndices, extractAndPush, extractPriceFromSimpleString, extractFeeFromText, selectBestFee - NO CHANGES NEEDED)
    private parseTextForFees(text: string): ScrapedFees {
        return {
            homeFee: this.extractFeeFromText(text,['home', 'uk', 'domestic', 'england', 'rest of uk', 'ruk']),
            internationalFee: this.extractFeeFromText(text, ['international', 'overseas', 'eu/international']),
            scotlandFee: this.extractFeeFromText(text, ['scotland', 'scottish'])
        };
    }

    private parseTables($: CheerioAPI, root: CheerioAny, context: FeeContext) {
        root.find('table').each((_idx: number, table: Element) => {
            const $table = $(table);
            const tableText = $table.text().toLowerCase();
            if (tableText.includes('scholarship') || tableText.includes('bursary')) return;

            let headers: string[] =[];
            $table.find('th').each((_, th) => { headers.push($(th).text().toLowerCase().trim()); });
            if (headers.length === 0) {
                $table.find('tr').first().find('td').each((_, td) => { headers.push($(td).text().toLowerCase().trim()); });
            }

            const rows = $table.find('tr');
            const scotIndices = this.getIndices(headers, /(scotland|scottish)/);
            const homeIndices = this.getIndices(headers, /(home|uk|domestic|england|wales|rest of uk|ruk)/, /(scotland|scottish|international|overseas)/);
            const intlIndices = this.getIndices(headers, /(international|overseas|eu)/);

            if (homeIndices.length > 0 || intlIndices.length > 0 || scotIndices.length > 0) {
                rows.each((_, tr) => {
                    const cells = $(tr).find('td');
                    if (cells.length === 0) return;
                    this.extractAndPush(cells, homeIndices, context.home);
                    this.extractAndPush(cells, intlIndices, context.intl);
                    this.extractAndPush(cells, scotIndices, context.scotland);
                });
            } else {
                const inferredLabel = this.getContextLabel($, table);
                if (inferredLabel) {
                    rows.each((_, tr) => {
                        const rowText = $(tr).text().toLowerCase();
                        if (TRAP_KEYWORDS.some(k => rowText.includes(k))) return;
                        const price = this.extractPriceFromSimpleString(rowText);
                        if (price) {
                            if (inferredLabel === 'home') context.home.push(price);
                            else if (inferredLabel === 'intl') context.intl.push(price);
                            else if (inferredLabel === 'scotland') context.scotland.push(price);
                        }
                    });
                } else {
                    rows.each((_, tr) => {
                        const rowText = $(tr).text().toLowerCase();
                        if (TRAP_KEYWORDS.some(k => rowText.includes(k))) return;
                        const price = this.extractPriceFromSimpleString(rowText);
                        if (price) {
                            if (/(scotland|scottish)/.test(rowText)) context.scotland.push(price);
                            else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(rowText) && !/(international|overseas)/.test(rowText)) context.home.push(price);
                            else if (/(international|overseas|eu)/.test(rowText)) context.intl.push(price);
                        }
                    });
                }
            }
        });
    }

    private parseDivGrids($: CheerioAPI, root: CheerioAny, context: FeeContext) {
        root.find('div, p').each((_idx: number, el: Element) => {
            const text = $(el).text().toLowerCase().trim();
            if (text.length > 20 && text.length < 300 && text.includes('£')) {
                if (TRAP_KEYWORDS.some(k => text.includes(k))) return;
                const price = this.extractPriceFromSimpleString(text);
                if (price) {
                    const labelText = text + " " + $(el).prev().text().toLowerCase();
                    let inferredType: FeeType | null = null;
                    if (/(scotland|scottish)/.test(labelText)) inferredType = 'scotland';
                    else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(labelText) && !/(international|overseas)/.test(labelText)) inferredType = 'home';
                    else if (/(international|overseas|eu)/.test(labelText)) inferredType = 'intl';
                    
                    if (!inferredType) inferredType = this.getContextLabel($, el);

                    if (inferredType === 'scotland') context.scotland.push(price);
                    else if (inferredType === 'home') context.home.push(price);
                    else if (inferredType === 'intl') context.intl.push(price);
                }
            }
        });
    }

    private parseLabelValuePairs($: CheerioAPI, root: CheerioAny, context: FeeContext) {
        const classifyAndPush = (label: string, valueStr: string) => {
            const combined = (label + " " + valueStr).toLowerCase();
            if (TRAP_KEYWORDS.some(k => combined.includes(k))) return;
            const price = this.extractPriceFromSimpleString(valueStr);
            if (!price) return;

            if (/(international|overseas)/.test(combined)) context.intl.push(price);
            else if (/(scotland|scottish)/.test(combined)) context.scotland.push(price);
            else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(combined)) context.home.push(price);
        };

        root.find('dt').each((_idx: number, dt: Element) => {
            classifyAndPush($(dt).text(), $(dt).next('dd').text());
        });
    }

    private getContextLabel($: CheerioAPI, element: any): FeeType | null {
        let current = $(element);
        let depth = 0;
        while (current.length && current.prop('tagName') !== 'BODY' && depth < 15) {
            const prevHeading = current.prevAll('h1,h2,h3,h4,h5,h6').first();
            if (prevHeading.length) {
                const text = prevHeading.text().toLowerCase();
                if (/(international|overseas|eu)/.test(text)) return 'intl';
                if (/(scotland|scottish)/.test(text)) return 'scotland';
                if (/(home|uk|domestic|england|wales|rest of uk|ruk)/.test(text)) return 'home';
            }
            current = current.parent();
            depth++;
        }
        return null;
    }

    private getIndices(headers: string[], matchRegex: RegExp, excludeRegex?: RegExp): number[] {
        return headers.map((h, i) => {
            if (matchRegex.test(h)) {
                if (excludeRegex && excludeRegex.test(h)) return -1;
                return i;
            }
            return -1;
        }).filter(i => i !== -1);
    }

    private extractAndPush(cells: CheerioAny, indices: number[], targetArray: number[]) {
        indices.forEach(index => {
            if (index < cells.length) {
                const text = cells.eq(index).text();
                if (TRAP_KEYWORDS.some(k => text.toLowerCase().includes(k))) return;
                const val = this.extractPriceFromSimpleString(text);
                if (val) targetArray.push(val);
            }
        });
    }

    private extractPriceFromSimpleString(text: string): number | null {
        const cleanText = text.replace(/20\d\d/g, ''); 
        const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/;
        const match = regex.exec(cleanText);
        if (match && match[1]) {
            const val = parseInt(match[1].replace(/,/g, ''), 10);
            if (val > 1000 && val < MAX_FEE) return val;
        }
        return null;
    }

    private extractFeeFromText(text: string, keywords: string[]): number | null {
        const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
        let match;
        const candidates: { value: number, distance: number }[] = [];
        const keywordIndices: number[] =[];

        keywords.forEach(kw => {
            let idx = text.toLowerCase().indexOf(kw);
            while (idx !== -1) {
                keywordIndices.push(idx);
                idx = text.toLowerCase().indexOf(kw, idx + 1);
            }
        });

        if (keywordIndices.length === 0) return null;

        while ((match = regex.exec(text)) !== null) {
            if (!match[1]) continue;
            const priceStr = match[1].replace(/,/g, '');
            const price = parseInt(priceStr, 10);
            const priceIndex = match.index;

            if (price < 1000 || price > MAX_FEE) continue; 
            
            const context = text.substring(Math.max(0, priceIndex - 60), Math.min(text.length, priceIndex + 60)).toLowerCase();
            if (TRAP_KEYWORDS.some(k => context.includes(k))) continue;

            let minDistance = Infinity;
            for (const kwIdx of keywordIndices) {
                const dist = Math.abs(priceIndex - kwIdx);
                if (dist < minDistance) minDistance = dist;
            }

            if (minDistance < 120) {
                candidates.push({ value: price, distance: minDistance });
            }
        }

        candidates.sort((a, b) => a.distance - b.distance);
        return candidates.length > 0 && candidates[0] ? candidates[0].value : null;
    }

    private selectBestFee(candidates: number[], type: FeeType): number | null {
        if (candidates.length === 0) return null;
        const minFee = type === 'scotland' ? 1000 : MIN_FEE;
        const valid = candidates.filter(c => c >= minFee && c < MAX_FEE);
        if (valid.length === 0) return null;
        if (type === 'intl') return Math.max(...valid);
        return Math.min(...valid);
    }
}