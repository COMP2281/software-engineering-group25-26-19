// src/htmlscraper.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
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

// Expanded list of keywords to avoid
const TRAP_KEYWORDS =[
    'scholarship', 'bursary', 'funding', 'award', 'loan', 'grant', 'stipend', 
    'deposit', 'accommodation', 'living', 'housing', 'residence', 'placement', 
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
                args:['--no-sandbox', '--disable-setuid-sandbox'] 
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
    $('*').each((_, el) => {
        const text = $(el).text().toLowerCase();
        const attrStr = ($(el).attr('class') || '') + ($(el).attr('id') || '');
        if (TRAP_KEYWORDS.some(k => attrStr.includes(k))) {
             $(el).remove();
        } else if (text.length < 300 && TRAP_KEYWORDS.some(k => text.includes(k))) {
             if (text.includes('value') || text.includes('award') || text.includes('up to')) {
                 $(el).remove();
             }
        }
    });

    const feeContext: FeeContext = { home: [], intl: [], scotland:[] };

    parseTables($, feeContext);
    parseDivGrids($, feeContext);
    parseLabelValuePairs($, feeContext);

    // Text Scan (Fallback)
    const bodyText = $('body').text().replace(/\s+/g, ' ');
    const textFees = parseTextForFees(bodyText);
    
    if (textFees.homeFee) feeContext.home.push(textFees.homeFee);
    if (textFees.internationalFee) feeContext.intl.push(textFees.internationalFee);
    if (textFees.scotlandFee) feeContext.scotland.push(textFees.scotlandFee);

    debug(`Candidates -> Home:[${feeContext.home.join(', ')}], Intl:[${feeContext.intl.join(', ')}], Scot:[${feeContext.scotland.join(', ')}]`);

    return {
        homeFee: selectBestFee(feeContext.home, 'home'),
        internationalFee: selectBestFee(feeContext.intl, 'intl'),
        scotlandFee: selectBestFee(feeContext.scotland, 'scotland')
    };
}

function parseTextForFees(text: string): ScrapedData {
    return {
        homeFee: extractFeeFromText(text,['home', 'uk', 'domestic', 'england', 'rest of uk', 'ruk']),
        internationalFee: extractFeeFromText(text,['international', 'overseas', 'eu/international']),
        scotlandFee: extractFeeFromText(text, ['scotland', 'scottish'])
    };
}

// --- HYBRID LOGIC INTEGRATION ---

/**
 * Looks up the DOM tree from a given element to find a heading (h1-h6)
 * that indicates the student type (e.g., "International Students").
 * FIXED: Removed 4-level limit to handle heavily nested tables (e.g. Cardiff).
 */
function getContextLabel($: cheerio.CheerioAPI, element: any): FeeType | null {
    let current = $(element);
    let depth = 0;
    
    // Traverse up until we hit the body tag or go 15 levels deep
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

function parseTables($: cheerio.CheerioAPI, context: FeeContext) {
    $('table').each((_, table) => {
        const $table = $(table);
        const tableText = $table.text().toLowerCase();
        
        // Whole table trap check
        if (tableText.includes('scholarship') || tableText.includes('bursary')) return;

        let headers: string[] =[];
        $table.find('th').each((_, th) => { headers.push($(th).text().toLowerCase().trim()); });
        if (headers.length === 0) {
            $table.find('tr').first().find('td').each((_, td) => { headers.push($(td).text().toLowerCase().trim()); });
        }

        const rows = $table.find('tr');
        const scotIndices = getIndices(headers, /(scotland|scottish)/);
        const homeIndices = getIndices(headers, /(home|uk|domestic|england|wales|rest of uk|ruk)/, /(scotland|scottish|international|overseas)/);
        const intlIndices = getIndices(headers, /(international|overseas|eu)/);

        const hasTypeHeaders = homeIndices.length > 0 || intlIndices.length > 0 || scotIndices.length > 0;

        if (hasTypeHeaders) {
            // EDINBURGH STYLE: Context is explicitly in the column headers
            rows.each((_, tr) => {
                const cells = $(tr).find('td');
                if (cells.length === 0) return;
                extractAndPush(cells, homeIndices, context.home);
                extractAndPush(cells, intlIndices, context.intl);
                extractAndPush(cells, scotIndices, context.scotland);
            });
        } else {
            // CARDIFF STYLE: Try to infer context from surrounding headings
            const inferredLabel = getContextLabel($, table);
            
            if (inferredLabel) {
                rows.each((_, tr) => {
                    const rowText = $(tr).text().toLowerCase();
                    if (TRAP_KEYWORDS.some(k => rowText.includes(k))) return;
                    
                    const price = extractPriceFromSimpleString(rowText);
                    if (price) {
                        if (inferredLabel === 'home') context.home.push(price);
                        else if (inferredLabel === 'intl') context.intl.push(price);
                        else if (inferredLabel === 'scotland') context.scotland.push(price);
                    }
                });
            } else {
                // DURHAM STYLE: Fallback to checking each row for keywords
                rows.each((_, tr) => {
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
        }
    });
}

function parseDivGrids($: cheerio.CheerioAPI, context: FeeContext) {
    $('div, p').each((_, el) => {
        const text = $(el).text().toLowerCase().trim();
        if (text.length > 20 && text.length < 300 && text.includes('£')) {
            // Trap check
            if (TRAP_KEYWORDS.some(k => text.includes(k))) return;

            const price = extractPriceFromSimpleString(text);
            if (price) {
                // Check immediate text context
                const labelText = text + " " + $(el).prev().text().toLowerCase();
                
                let inferredType: FeeType | null = null;
                if (/(scotland|scottish)/.test(labelText)) inferredType = 'scotland';
                else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(labelText) && !/(international|overseas)/.test(labelText)) inferredType = 'home';
                else if (/(international|overseas|eu)/.test(labelText)) inferredType = 'intl';
                
                // If immediate context fails, check DOM tree (Cardiff style)
                if (!inferredType) {
                    inferredType = getContextLabel($, el);
                }

                if (inferredType === 'scotland') context.scotland.push(price);
                else if (inferredType === 'home') context.home.push(price);
                else if (inferredType === 'intl') context.intl.push(price);
            }
        }
    });
}

function parseLabelValuePairs($: cheerio.CheerioAPI, context: FeeContext) {
    const classifyAndPush = (label: string, valueStr: string) => {
        const combined = (label + " " + valueStr).toLowerCase();
        if (TRAP_KEYWORDS.some(k => combined.includes(k))) return;

        const price = extractPriceFromSimpleString(valueStr);
        if (!price) return;

        if (/(international|overseas)/.test(combined)) context.intl.push(price);
        else if (/(scotland|scottish)/.test(combined)) context.scotland.push(price);
        else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(combined)) context.home.push(price);
    };

    $('dt').each((_, dt) => {
        classifyAndPush($(dt).text(), $(dt).next('dd').text());
    });
}

// --- UTILS ---

function getIndices(headers: string[], matchRegex: RegExp, excludeRegex?: RegExp): number[] {
    return headers.map((h, i) => {
        if (matchRegex.test(h)) {
            if (excludeRegex && excludeRegex.test(h)) return -1;
            return i;
        }
        return -1;
    }).filter(i => i !== -1);
}

function extractAndPush(cells: cheerio.Cheerio<any>, indices: number[], targetArray: number[]) {
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

    $('a').each((_, element) => {
        const text = $(element).text().toLowerCase().trim();
        const href = $(element).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto')) return true;

        if (text.includes('tuition fees') || (text.includes('fees') && text.includes('funding'))) {
            try {
                const absUrl = new URL(href, mainUrl).toString();
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
        // Valid range: 4500 to 80000 (1000 for Scotland)
        if (val > 1000 && val < 80000) return val;
    }
    return null;
}

function extractFeeFromText(text: string, keywords: string[]): number | null {
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

        if (price < 1000 || price > 80000) continue; 
        
        const context = text.substring(Math.max(0, priceIndex - 60), Math.min(text.length, priceIndex + 60)).toLowerCase();
        
        // Strict trap check
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
    
    // Filter sensible range (Scotland can be cheap e.g. 1820, Home usually > 4500)
    const minFee = type === 'scotland' ? 1000 : 4500;
    const valid = candidates.filter(c => c >= minFee && c < 80000);
    
    if (valid.length === 0) return null;

    if (type === 'intl') {
        // For International: Pick the HIGHEST valid fee
        return Math.max(...valid);
    } else {
        // For Home/Scotland: Pick the LOWEST valid fee
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