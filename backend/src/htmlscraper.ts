// src/htmlscraper.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import prisma from './db';

// Dynamic import for Puppeteer to avoid hard crash if not installed
let puppeteer: any;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    console.warn("Puppeteer not found. Install it with `npm install puppeteer` to enable advanced scraping.");
}

// Fix for TS2349: pdf-parse often has issues with default imports in strict TS
const pdfParse = require('pdf-parse');

// Configuration
const TIMEOUT = 30000; // Increased for browser rendering
const DEBUG = true;

// Headers to mimic a real browser for Axios
const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1'
};

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
        // Step 1: Try Main Page
        let data = await scrapeWithFallback(course.courseUrl);

        // Step 2: Waterfall to Sub-pages if needed
        if (!hasData(data)) {
            console.log(`   > Fees not found. Scanning for sub-pages...`);
            const subPageUrl = await findFeeSubPage(course.courseUrl, data.lastHtml);
            
            if (subPageUrl) {
                console.log(`   > Found sub-page: ${subPageUrl}`);
                const subData = await scrapeWithFallback(subPageUrl);
                data = mergeData(data, subData);
            }
        }

        if (hasData(data)) {
            console.log(`   > SUCCESS: Home (RUK): £${data.homeFee}, Intl: £${data.internationalFee} ${data.scotlandFee ? `(Scot: £${data.scotlandFee})` : ''}`);
            
            for (const option of course.options) {
                const updateData: any = {};
                // Only update if DB is empty to avoid overwriting good data
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
        lastHtml: (newDat as any).lastHtml // Preserve HTML for debugging
    };
}

/**
 * Orchestrates the scrape: Axios first -> Puppeteer fallback
 */
async function scrapeWithFallback(url: string): Promise<ScrapedData & { lastHtml?: string }> {
    let result: ScrapedData & { lastHtml?: string } = { 
        homeFee: null, 
        internationalFee: null, 
        scotlandFee: null 
    };

    // 1. Try Axios (Fast)
    try {
        debug(`Attempting Axios fetch: ${url}`);
        const response = await axios.get(url, {
            headers: HEADERS_BROWSER,
            timeout: 10000,
            responseType: 'arraybuffer',
            validateStatus: s => s < 500
        });

        // If 403 Forbidden (Cardiff), throw immediately to trigger Puppeteer
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

    // 2. Try Puppeteer (Slow, but handles JS/WAF)
    if (puppeteer) {
        debug("Falling back to Puppeteer (Headless Browser)...");
        try {
            const browser = await puppeteer.launch({ 
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            
            // Set User Agent to avoid detection
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            // Wait for common fee indicators to render
            try {
                // FIXED: Pass function as a string to avoid TS2584 (Cannot find name 'document')
                // This string is evaluated inside the browser context
                await page.waitForFunction(
                    'document.body.innerText.includes("£") || document.querySelector("table")',
                    { timeout: 5000 }
                );
            } catch (e) { /* ignore timeout, proceed with what we have */ }

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
    // PDF Handling
    if (url.toLowerCase().endsWith('.pdf') || contentType.includes('application/pdf')) {
        debug("Detected PDF content.");
        const buffer = Buffer.from(data);
        const pdfData = await pdfParse(buffer);
        const textContent = pdfData.text.replace(/\s+/g, ' ');
        
        const fees = parseTextForFees(textContent);
        return { ...fees, lastHtml: "PDF_CONTENT" };
    }

    // HTML Handling
    const html = data.toString('utf-8');
    const result = await parseHtml(html);
    return { ...result, lastHtml: html };
}

async function parseHtml(html: string): Promise<ScrapedData> {
    const $ = cheerio.load(html);
    
    // Save dump for debugging
    if (DEBUG) fs.writeFileSync(path.resolve('debug_last_scrape.html'), html);

    // Cleanup
    $('script, style, nav, footer, header').remove();
    
    // Remove scholarship traps
    $('*').each((_, el) => {
        const text = $(el).text().toLowerCase();
        const attrStr = ($(el).attr('class') || '') + ($(el).attr('id') || '');
        if (/scholarship|bursary|funding|award/i.test(attrStr)) {
            if (text.length < 500 && (text.includes('value') || text.includes('award'))) {
                $(el).remove();
            }
        }
    });

    const feeContext: FeeContext = { home: [], intl: [], scotland: [] };

    // Strategy A: Tables
    parseTables($, feeContext);

    // Strategy B: Div Grids (Edinburgh)
    parseDivGrids($, feeContext);

    // Strategy C: Label/Value
    parseLabelValuePairs($, feeContext);

    // Strategy D: Text Scan
    const bodyText = $('body').text().replace(/\s+/g, ' ');
    const textFees = parseTextForFees(bodyText);
    
    if (textFees.homeFee) feeContext.home.push(textFees.homeFee);
    if (textFees.internationalFee) feeContext.intl.push(textFees.internationalFee);
    if (textFees.scotlandFee) feeContext.scotland.push(textFees.scotlandFee);

    debug(`Candidates -> Home: [${feeContext.home.join(', ')}], Intl: [${feeContext.intl.join(', ')}], Scot: [${feeContext.scotland.join(', ')}]`);

    return {
        homeFee: selectBestFee(feeContext.home),
        internationalFee: selectBestFee(feeContext.intl),
        scotlandFee: selectBestFee(feeContext.scotland)
    };
}

function parseTextForFees(text: string): ScrapedData {
    return {
        homeFee: extractFeeFromText(text, ['home', 'uk', 'domestic', 'england', 'rest of uk', 'ruk']),
        internationalFee: extractFeeFromText(text, ['international', 'overseas', 'eu/international']),
        scotlandFee: extractFeeFromText(text, ['scotland', 'scottish'])
    };
}

function parseDivGrids($: cheerio.CheerioAPI, context: FeeContext) {
    // Look for div structures common in responsive tables
    $('div, p').each((_, el) => {
        const text = $(el).text().toLowerCase().trim();
        // Strict length check to avoid huge containers
        if (text.length > 20 && text.length < 300 && text.includes('£')) {
            const price = extractPriceFromSimpleString(text);
            if (price) {
                // Check siblings or parent for labels if the label isn't inside
                const labelText = text + " " + $(el).prev().text().toLowerCase() + " " + $(el).parent().prev().text().toLowerCase();
                
                if (/(scotland|scottish)/.test(labelText)) context.scotland.push(price);
                else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(labelText) && !/(international|overseas)/.test(labelText)) context.home.push(price);
                else if (/(international|overseas|eu)/.test(labelText)) context.intl.push(price);
            }
        }
    });
}

function parseTables($: cheerio.CheerioAPI, context: FeeContext) {
    $('table').each((_, table) => {
        const $table = $(table);
        let headers: string[] = [];
        
        $table.find('th').each((_, th) => { headers.push($(th).text().toLowerCase().trim()); });
        if (headers.length === 0) {
            $table.find('tr').first().find('td').each((_, td) => { headers.push($(td).text().toLowerCase().trim()); });
        }

        const rows = $table.find('tr');
        const scotIndices = getIndices(headers, /(scotland|scottish)/);
        const homeIndices = getIndices(headers, /(home|uk|domestic|england|wales|rest of uk|ruk)/, /(scotland|scottish|international|overseas)/);
        const intlIndices = getIndices(headers, /(international|overseas|eu)/);

        if (homeIndices.length > 0 || intlIndices.length > 0 || scotIndices.length > 0) {
            rows.each((_, tr) => {
                const cells = $(tr).find('td');
                if (cells.length === 0) return;
                extractAndPush(cells, homeIndices, context.home);
                extractAndPush(cells, intlIndices, context.intl);
                extractAndPush(cells, scotIndices, context.scotland);
            });
        } else {
            // Row based fallback
             rows.each((_, tr) => {
                const rowText = $(tr).text().toLowerCase();
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

function parseLabelValuePairs($: cheerio.CheerioAPI, context: FeeContext) {
    const classifyAndPush = (label: string, valueStr: string) => {
        const price = extractPriceFromSimpleString(valueStr);
        if (!price) return;
        const combined = (label + " " + valueStr).toLowerCase();
        if (combined.includes('deposit') || combined.includes('scholarship')) return;

        if (/(international|overseas)/.test(combined)) context.intl.push(price);
        else if (/(scotland|scottish)/.test(combined)) context.scotland.push(price);
        else if (/(home|uk|domestic|england|rest of uk|ruk)/.test(combined)) context.home.push(price);
    };

    $('dt').each((_, dt) => {
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

function extractAndPush(cells: cheerio.Cheerio<any>, indices: number[], targetArray: number[]) {
    indices.forEach(index => {
        if (index < cells.length) {
            const val = extractPriceFromSimpleString(cells.eq(index).text());
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
        if (val > 1000 && val < 70000) return val;
    }
    return null;
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

        if (price < 1000 || price > 70000) continue; 
        
        const context = text.substring(Math.max(0, priceIndex - 50), Math.min(text.length, priceIndex + 50)).toLowerCase();
        if (context.includes('accommodation') || context.includes('living') || context.includes('deposit') || context.includes('scholarship')) continue;

        let minDistance = Infinity;
        for (const kwIdx of keywordIndices) {
            const dist = Math.abs(priceIndex - kwIdx);
            if (dist < minDistance) minDistance = dist;
        }

        if (minDistance < 250) {
            candidates.push({ value: price, distance: minDistance });
        }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    return candidates.length > 0 && candidates[0] ? candidates[0].value : null;
}

function selectBestFee(candidates: number[]): number | null {
    if (candidates.length === 0) return null;
    const valid = candidates.filter(c => c > 1000 && c < 70000);
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => Math.max(a, b), 0);
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