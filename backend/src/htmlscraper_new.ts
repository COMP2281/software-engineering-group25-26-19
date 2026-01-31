// src/htmlscraper_new.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import * as fs from 'fs';
import * as path from 'path';
import prisma from './db';

// Dynamic import for Puppeteer
let puppeteer: any;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    console.warn("Puppeteer not found. Install it with `npm install puppeteer` to enable advanced scraping.");
}

const pdfParse = require('pdf-parse');

// Configuration
const TIMEOUT = 30000;
const DEBUG = true;
const MIN_FEE = 9000;
const MAX_FEE = 80000;

// Expanded list of keywords to avoid
const TRAP_KEYWORDS = [
    'scholarship', 'bursary', 'funding', 'award', 'loan', 'grant', 'stipend', 
    'accommodation', 'living', 'housing', 'residence', 'placement', 
    'bench fee', 'additional cost', 'maintenance', 'contribution', 'discount',
    'advance'
];

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1'
};

type FeeType = 'home' | 'intl' | 'scotland';

interface ScrapedData {
    homeFee: number | null;
    internationalFee: number | null;
    scotlandFee: number | null;
}

interface FeeContext {
    home: number[];
    intl: number[];
    scotland: number[];
}

type CheerioAny = Cheerio<AnyNode>;

interface FeeSection {
    label: FeeType;
    root: CheerioAny;
    headingText: string;
}

function debug(msg: string) {
    if (DEBUG) console.log(`[DEBUG] ${msg}`);
}

export async function enrichCourseData(courseId: string) {
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: { university: true, options: true }
    });

    if (!course || !course.courseUrl) {
        console.log(`Skipping ${courseId}: No URL found.`);
        return;
    }

    console.log(`\n=== Scraping ${course.title} ===`);
    console.log(`URL: ${course.courseUrl}`);

    try {
        let data = await scrapeWithFallback(course.courseUrl);

        if (!hasData(data)) {
            console.log(`   > Fees not found. Scanning for sub-pages...`);
            const subPageUrl = await findFeeSubPage(course.courseUrl, data.lastHtml);
            
            if (subPageUrl) {
                console.log(`   > Found sub-page: ${subPageUrl}`);
                const subData = await scrapeWithFallback(subPageUrl);
                data = mergeData(data, subData);
            }
        }

        // --- Post-Processing Sanity Checks ---
        if (data.homeFee && data.internationalFee && data.homeFee >= data.internationalFee) {
            debug(`Sanity Check Failed: Home (£${data.homeFee}) >= Intl (£${data.internationalFee}). Discarding Home Fee.`);
            data.homeFee = null;
        }

        if (hasData(data)) {
            console.log(`   > SUCCESS: Home (RUK): £${data.homeFee}, Intl: £${data.internationalFee} ${data.scotlandFee ? `(Scot: £${data.scotlandFee})` : ''}`);
            
            for (const option of course.options) {
                const updateData: any = {};
                if (!option.homeFee && data.homeFee) updateData.homeFee = data.homeFee;
                if (!option.internationalFee && data.internationalFee) updateData.internationalFee = data.internationalFee;

                if (Object.keys(updateData).length > 0) {
                    await prisma.courseOption.update({
                        where: { id: option.id },
                        data: updateData
                    });
                }
            }
            console.log(`   > Updated options in DB.`);
        } else {
            console.log(`   > FAILURE: Could not extract fees.`);
        }

    } catch (error) {
        console.error(`   > Error scraping ${course.title}:`, error instanceof Error ? error.message : error);
    }
}

function hasData(data: ScrapedData): boolean {
    return !!(data.homeFee || data.internationalFee);
}

function mergeData(base: ScrapedData, newDat: ScrapedData): ScrapedData & { lastHtml?: string } {
    return {
        homeFee: newDat.homeFee || base.homeFee,
        internationalFee: newDat.internationalFee || base.internationalFee,
        scotlandFee: newDat.scotlandFee || base.scotlandFee,
        lastHtml: (newDat as any).lastHtml
    };
}

async function scrapeWithFallback(url: string): Promise<ScrapedData & { lastHtml?: string }> {
    let result: ScrapedData & { lastHtml?: string } = { 
        homeFee: null, 
        internationalFee: null, 
        scotlandFee: null 
    };

    // 1. Try Axios
    try {
        debug(`Attempting Axios fetch: ${url}`);
        const response = await axios.get(url, {
            headers: HEADERS_BROWSER,
            timeout: 10000,
            responseType: 'arraybuffer',
            validateStatus: s => s < 500
        });

        if (response.status === 403 || response.status === 401) {
            throw new Error(`Axios blocked with status ${response.status}`);
        }

        result = await processResponseData(url, response.data, response.headers['content-type']);

        if (hasData(result)) {
            return result;
        }
        debug("Axios returned no fee data. Checking for empty shell...");

    } catch (error) {
        debug(`Axios failed: ${error instanceof Error ? error.message : error}`);
    }

    // 2. Try Puppeteer
    if (puppeteer) {
        debug("Falling back to Puppeteer (Headless Browser)...");
        try {
            const browser = await puppeteer.launch({ 
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            try {
                // Wait for text or table
                await page.waitForFunction(
                    'document.body.innerText.includes("£") || document.querySelector("table")',
                    { timeout: 5000 }
                );
            } catch (e) { /* ignore timeout */ }

            const content = await page.content();
            await browser.close();

            debug("Puppeteer render complete.");
            result = await parseHtml(content);
            result.lastHtml = content;

        } catch (error) {
            debug(`Puppeteer failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    return result;
}

async function processResponseData(url: string, data: any, contentType: string = ''): Promise<ScrapedData & { lastHtml?: string }> {
    if (url.toLowerCase().endsWith('.pdf') || contentType.includes('application/pdf')) {
        debug("Detected PDF content.");
        const buffer = Buffer.from(data);
        const pdfData = await pdfParse(buffer);
        const textContent = pdfData.text.replace(/\s+/g, ' ');
        const fees = parseTextForFees(textContent);
        return { ...fees, lastHtml: "PDF_CONTENT" };
    }

    const html = data.toString('utf-8');
    const result = await parseHtml(html);
    return { ...result, lastHtml: html };
}

async function parseHtml(html: string): Promise<ScrapedData> {
    const $ = cheerio.load(html);
    
    if (DEBUG) fs.writeFileSync(path.resolve('debug_last_scrape.html'), html);

    $('script, style, nav, footer, header').remove();
    
    // Remove scholarship traps
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

    const feeContext: FeeContext = { home: [], intl: [], scotland: [] };

    const feeRoot = findFeeRoot($) || ($('body') as CheerioAny);
    const sections = findFeeSections($, feeRoot);

    if (sections.length > 0) {
        for (const section of sections) {
            parseTables($, section.root, feeContext, section.label);
            parseDivGrids($, section.root, feeContext, section.label);
            parseLabelValuePairs($, section.root, feeContext, section.label);

            const sectionText = `${section.headingText} ${section.root.text()}`.replace(/\s+/g, ' ');
            const prices = extractAllPrices(sectionText);
            prices.forEach(val => pushToContext(section.label, val, feeContext));
        }
    } else {
        // Fallback: parse the whole fee root
        parseTables($, feeRoot, feeContext);
        parseDivGrids($, feeRoot, feeContext);
        parseLabelValuePairs($, feeRoot, feeContext);

        const bodyText = feeRoot.text().replace(/\s+/g, ' ');
        const textFees = parseTextForFees(bodyText);
        
        if (textFees.homeFee) feeContext.home.push(textFees.homeFee);
        if (textFees.internationalFee) feeContext.intl.push(textFees.internationalFee);
        if (textFees.scotlandFee) feeContext.scotland.push(textFees.scotlandFee);
    }

    debug(`Candidates -> Home: [${feeContext.home.join(', ')}], Intl: [${feeContext.intl.join(', ')}], Scot: [${feeContext.scotland.join(', ')}]`);

    return {
        homeFee: selectBestFee(feeContext.home, 'home'),
        internationalFee: selectBestFee(feeContext.intl, 'intl'),
        scotlandFee: selectBestFee(feeContext.scotland, 'scotland')
    };
}

function findFeeRoot($: CheerioAPI): CheerioAny | null {
    const heading = findFeeHeading($);
    if (!heading || heading.length === 0) return null;

    const preferred = heading.closest('.content-group, .content-group__content, section, article, main');
    if (preferred.length) return preferred.first() as CheerioAny;

    return heading.parent() as CheerioAny;
}

function findFeeHeading($: CheerioAPI): CheerioAny | null {
    const anchor = $('#fees');
    if (anchor.length) return anchor.first() as CheerioAny;

    let bestEl: Element | null = null;
    let bestScore = -Infinity;

    $('h1,h2,h3,h4').each((_idx: number, el: Element) => {
        const text = $(el).text().toLowerCase().trim();
        if (!text) return;

        let score = 0;
        if (/tuition fee|tuition fees/.test(text)) score += 5;
        else if (/fees for/.test(text)) score += 3;
        else if (/fees/.test(text)) score += 1;

        if (/additional costs|living costs|funding|scholarship|bursary/.test(text)) score -= 3;

        if (score > 0 && score > bestScore) {
            bestScore = score;
            bestEl = el;
        }
    });

    return bestEl ? ($(bestEl) as CheerioAny) : null;
}

function findFeeSections($: CheerioAPI, root: CheerioAny): FeeSection[] {
    const sections: FeeSection[] = [];

    root.find('h1,h2,h3,h4').each((_idx: number, h: Element) => {
        const headingText = $(h).text().toLowerCase().trim();
        if (!headingText) return;
        if (!/fee|tuition/.test(headingText)) return;

        const label = classifyLabel(headingText);
        if (!label) return;

        const sectionEls = collectSectionElements($, h);
        if (sectionEls.length === 0) return;

        sections.push({
            label,
            root: $(sectionEls) as CheerioAny,
            headingText: $(h).text()
        });
    });

    return sections;
}

function collectSectionElements($: CheerioAPI, headingEl: Element): AnyNode[] {
    const elems: AnyNode[] = [];
    const level = headingLevel(headingEl);

    let next = $(headingEl).next();
    while (next.length) {
        const nextEl = next.get(0);
        if (!nextEl) break;
        const tag = (nextEl.tagName || '').toLowerCase();
        if (tag && /^h[1-6]$/.test(tag)) {
            const nextLevel = parseInt(tag.slice(1), 10);
            if (!Number.isNaN(nextLevel) && nextLevel <= level) break;
        }
        elems.push(nextEl);
        next = next.next();
    }

    return elems;
}

function headingLevel(el: any): number {
    const tag = (el.tagName || '').toLowerCase();
    if (!/^h[1-6]$/.test(tag)) return 7;
    const level = parseInt(tag.slice(1), 10);
    return Number.isNaN(level) ? 7 : level;
}

function classifyLabel(text: string): FeeType | null {
    const t = text.toLowerCase();
    if (/(international|overseas|eu)/.test(t)) return 'intl';
    if (/(scotland|scottish)/.test(t)) return 'scotland';
    if (/(home|uk|domestic|england|wales|rest of uk|ruk|island)/.test(t)) return 'home';
    return null;
}

function pushToContext(type: FeeType, value: number, context: FeeContext) {
    if (type === 'home') context.home.push(value);
    else if (type === 'intl') context.intl.push(value);
    else context.scotland.push(value);
}

function parseTextForFees(text: string): ScrapedData {
    return {
        homeFee: extractFeeFromText(text, ['home', 'uk', 'domestic', 'england', 'rest of uk', 'ruk']),
        internationalFee: extractFeeFromText(text, ['international', 'overseas', 'eu/international']),
        scotlandFee: extractFeeFromText(text, ['scotland', 'scottish'])
    };
}

function parseDivGrids($: CheerioAPI, root: CheerioAny, context: FeeContext, forcedLabel?: FeeType) {
    root.find('div, p').each((_idx: number, el: Element) => {
        const text = $(el).text().toLowerCase().trim();
        if (text.length > 20 && text.length < 300 && text.includes('£')) {
            if (TRAP_KEYWORDS.some(k => text.includes(k))) return;

            const price = extractPriceFromSimpleString(text);
            if (price) {
                if (forcedLabel) {
                    pushToContext(forcedLabel, price, context);
                    return;
                }

                const labelText = text + " " + $(el).prev().text().toLowerCase();
                
                if (/(scotland|scottish)/.test(labelText)) context.scotland.push(price);
                else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(labelText) && !/(international|overseas)/.test(labelText)) context.home.push(price);
                else if (/(international|overseas|eu)/.test(labelText)) context.intl.push(price);
            }
        }
    });
}

function parseTables($: CheerioAPI, root: CheerioAny, context: FeeContext, forcedLabel?: FeeType) {
    root.find('table').each((_idx: number, table: Element) => {
        const $table = $(table);
        const tableText = $table.text().toLowerCase();
        
        if (tableText.includes('scholarship') || tableText.includes('bursary')) return;

        let headers: string[] = [];
        $table.find('th').each((_thIdx: number, th: Element) => { headers.push($(th).text().toLowerCase().trim()); });
        if (headers.length === 0) {
            $table.find('tr').first().find('td').each((_tdIdx: number, td: Element) => { headers.push($(td).text().toLowerCase().trim()); });
        }

        const rows = $table.find('tr');
        const scotIndices = getIndices(headers, /(scotland|scottish)/);
        const homeIndices = getIndices(headers, /(home|uk|domestic|england|wales|rest of uk|ruk)/, /(scotland|scottish|international|overseas)/);
        const intlIndices = getIndices(headers, /(international|overseas|eu)/);
        const feeIndices = getIndices(headers, /(tuition fee|tuition|fee)/, /(deposit|scholarship|bursary|funding)/);

        const hasTypeHeaders = homeIndices.length > 0 || intlIndices.length > 0 || scotIndices.length > 0;
        const inferredLabel = forcedLabel || getTableContextLabel($, table);

        if (hasTypeHeaders) {
            rows.each((_rowIdx: number, tr: Element) => {
                const cells = $(tr).find('td');
                if (cells.length === 0) return;
                extractAndPush(cells, homeIndices, context.home);
                extractAndPush(cells, intlIndices, context.intl);
                extractAndPush(cells, scotIndices, context.scotland);
            });
        } else if (inferredLabel) {
            rows.each((_rowIdx: number, tr: Element) => {
                const cells = $(tr).find('td');
                if (cells.length === 0) return;

                if (feeIndices.length > 0) {
                    const target = inferredLabel === 'home' ? context.home : inferredLabel === 'intl' ? context.intl : context.scotland;
                    extractAndPush(cells, feeIndices, target);
                } else {
                    const rowText = $(tr).text().toLowerCase();
                    if (TRAP_KEYWORDS.some(k => rowText.includes(k))) return;
                    if (rowText.includes('deposit')) return;
                    const price = extractPriceFromSimpleString(rowText);
                    if (price) pushToContext(inferredLabel, price, context);
                }
            });
        } else {
             rows.each((_rowIdx: number, tr: Element) => {
                const rowText = $(tr).text().toLowerCase();
                if (TRAP_KEYWORDS.some(k => rowText.includes(k))) return;

                const price = extractPriceFromSimpleString(rowText);
                if (price) {
                    if (/(scotland|scottish)/.test(rowText)) context.scotland.push(price);
                    else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(rowText) && !/(international|overseas)/.test(rowText)) context.home.push(price);
                    else if (/(international|overseas|eu)/.test(rowText)) context.intl.push(price);
                }
            });
        }
    });
}

function getTableContextLabel($: CheerioAPI, table: Element): FeeType | null {
    let current = $(table);
    for (let i = 0; i < 4; i++) {
        const prevHeading = current.prevAll('h1,h2,h3,h4').first();
        if (prevHeading.length) {
            const label = classifyLabel(prevHeading.text());
            if (label) return label;
        }
        const parent = current.parent();
        if (!parent || parent.length === 0) break;
        current = parent;
    }
    return null;
}

function parseLabelValuePairs($: CheerioAPI, root: CheerioAny, context: FeeContext, forcedLabel?: FeeType) {
    const classifyAndPush = (label: string, valueStr: string) => {
        const combined = (label + " " + valueStr).toLowerCase();
        if (TRAP_KEYWORDS.some(k => combined.includes(k))) return;

        const price = extractPriceFromSimpleString(valueStr);
        if (!price) return;

        if (forcedLabel) {
            pushToContext(forcedLabel, price, context);
            return;
        }

        if (/(international|overseas)/.test(combined)) context.intl.push(price);
        else if (/(scotland|scottish)/.test(combined)) context.scotland.push(price);
        else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(combined)) context.home.push(price);
    };

    root.find('dt').each((_idx: number, dt: Element) => {
        classifyAndPush($(dt).text(), $(dt).next('dd').text());
    });
}

function getIndices(headers: string[], matchRegex: RegExp, excludeRegex?: RegExp): number[] {
    return headers.map((h, i) => {
        if (matchRegex.test(h)) {
            if (excludeRegex && excludeRegex.test(h)) return -1;
            return i;
        }
        return -1;
    }).filter(i => i !== -1);
}

function extractAndPush(cells: CheerioAny, indices: number[], targetArray: number[]) {
    indices.forEach(index => {
        if (index < cells.length) {
            const text = cells.eq(index).text();
            if (TRAP_KEYWORDS.some(k => text.toLowerCase().includes(k))) return;
            const val = extractPriceFromSimpleString(text);
            if (val) targetArray.push(val);
        }
    });
}

async function findFeeSubPage(mainUrl: string, htmlContext?: string): Promise<string | null> {
    if (!htmlContext) return null;
    const $ = cheerio.load(htmlContext);
    let bestLink: string | null = null;

    const isPostgrad = /postgraduate/.test(mainUrl.toLowerCase());

    $('a').each((_idx: number, element: Element) => {
        const text = $(element).text().toLowerCase().trim();
        const href = $(element).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto')) return true;

        if (text.includes('tuition fees') || (text.includes('fees') && text.includes('funding'))) {
            try {
                const absUrl = new URL(href, mainUrl).toString();

                if (isPostgrad && /postgraduate/.test(absUrl) && /tuition/.test(absUrl)) {
                    bestLink = absUrl;
                    return false;
                }

                if (text === 'tuition fees') {
                    bestLink = absUrl;
                    return false; 
                }
                if (!bestLink) bestLink = absUrl;
            } catch (e) {}
        }
        return true;
    });
    return bestLink;
}

function extractPriceFromSimpleString(text: string): number | null {
    const cleanText = text.replace(/20\d\d/g, ''); 
    const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/;
    const match = regex.exec(cleanText);
    if (match && match[1]) {
        const val = parseInt(match[1].replace(/,/g, ''), 10);
        if (val >= MIN_FEE && val < MAX_FEE) return val;
    }
    return null;
}

function extractAllPrices(text: string): number[] {
    const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
    const prices: number[] = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (!match[1]) continue;
        const val = parseInt(match[1].replace(/,/g, ''), 10);
        if (val >= MIN_FEE && val < MAX_FEE) prices.push(val);
    }

    return prices;
}

function extractFeeFromText(text: string, keywords: string[]): number | null {
    const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
    let match;
    const candidates: { value: number, distance: number }[] = [];
    const keywordIndices: number[] = [];

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

        if (price < MIN_FEE || price > MAX_FEE) continue; 
        
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

function selectBestFee(candidates: number[], type: FeeType): number | null {
    if (candidates.length === 0) return null;
    
    const minFee = type === 'scotland' ? 1000 : MIN_FEE;
    const valid = candidates.filter(c => c >= minFee && c < MAX_FEE);
    
    if (valid.length === 0) return null;

    if (type === 'intl') {
        return Math.max(...valid);
    } else {
        return Math.min(...valid);
    }
}

if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        if (args.length > 0 && args[0]) {
            await enrichCourseData(args[0]);
        } else {
            console.log("Provide a Course ID to test scraper.");
        }
    })();
}
