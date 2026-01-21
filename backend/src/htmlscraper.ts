// src/htmlscraper.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import prisma from './db';

// Fix for TS2349: pdf-parse often has issues with default imports in strict TS
const pdfParse = require('pdf-parse');

// Configuration
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
const TIMEOUT = 15000;

interface ScrapedData {
    homeFee: number | null;
    internationalFee: number | null;
}

/**
 * Main entry point to enrich a specific course
 */
export async function enrichCourseData(courseId: string) {
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: { 
            university: true, 
            options: true 
        }
    });

    if (!course || !course.courseUrl) {
        console.log(`Skipping ${courseId}: No URL found.`);
        return;
    }

    if (course.options.length === 0) {
        console.log(`Skipping ${course.title}: No options linked in DB.`);
        return;
    }

    console.log(`Scraping ${course.title} (${course.courseUrl})...`);

    try {
        let data = await scrapePage(course.courseUrl);

        if (!data.homeFee && !data.internationalFee) {
            console.log(`   > Fees not found on main page. Looking for sub-pages...`);
            const subPageUrl = await findFeeSubPage(course.courseUrl);
            
            if (subPageUrl) {
                console.log(`   > Found sub-page: ${subPageUrl}`);
                const subData = await scrapePage(subPageUrl);
                data = { ...data, ...subData };
            }
        }

        if (hasData(data)) {
            console.log(`   > Found: Home: £${data.homeFee}, Intl: £${data.internationalFee}`);
            
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
            console.log(`   > Updated ${course.options.length} options.`);
        } else {
            console.log(`   > Failed to extract useful data for ${course.title}`);
        }

    } catch (error) {
        console.error(`   > Error scraping ${course.title}:`, error instanceof Error ? error.message : error);
    }
}

function hasData(data: ScrapedData): boolean {
    return !!(data.homeFee || data.internationalFee);
}

/**
 * Scrapes a URL (HTML or PDF)
 */
async function scrapePage(url: string): Promise<ScrapedData> {
    const result: ScrapedData = { 
        homeFee: null, 
        internationalFee: null,
    };

    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: TIMEOUT,
            responseType: url.toLowerCase().endsWith('.pdf') ? 'arraybuffer' : 'text'
        });

        if (url.toLowerCase().endsWith('.pdf') || response.headers['content-type']?.includes('application/pdf')) {
            const buffer = Buffer.from(response.data);
            const pdfData = await pdfParse(buffer);
            // PDF has no HTML structure, so we must rely on text scanning
            const textContent = pdfData.text.replace(/\s+/g, ' ');
            result.homeFee = extractFeeFromText(textContent, ['home', 'uk', 'domestic', 'england']);
            result.internationalFee = extractFeeFromText(textContent, ['international', 'overseas', 'eu/international']);
        } else {
            const $ = cheerio.load(response.data);
            $('script, style, nav, footer, header').remove();

            // 1. Structured Search (Best for Tables)
            const homeKeywords = ['home', 'uk', 'domestic', 'england'];
            const intlKeywords = ['international', 'overseas', 'eu/international'];

            result.homeFee = scrapeFeesFromContainers($, homeKeywords);
            result.internationalFee = scrapeFeesFromContainers($, intlKeywords);

            // 2. Fallback: Text Scan (If structured search failed)
            const textContent = $('body').text().replace(/\s+/g, ' ');
            
            if (!result.homeFee) {
                result.homeFee = extractFeeFromText(textContent, homeKeywords);
            }
            if (!result.internationalFee) {
                result.internationalFee = extractFeeFromText(textContent, intlKeywords);
            }
        }

    } catch (error) {
        // console.warn(`Could not fetch ${url}`);
    }

    return result;
}

/**
 * NEW: Looks for fees inside structured containers (tr, li, p, div)
 */
function scrapeFeesFromContainers($: cheerio.CheerioAPI, keywords: string[]): number | null {
    const containers = ['tr', 'li', 'p', 'div'];
    
    for (const tag of containers) {
        let foundPrice: number | null = null;

        $(tag).each((_, element) => {
            const text = $(element).text().replace(/\s+/g, ' ').toLowerCase();
            
            // 1. Does this container have the keyword?
            const hasKeyword = keywords.some(kw => text.includes(kw));
            if (!hasKeyword) return true; // Continue loop

            // 2. Does this container have a valid price?
            const price = extractPriceFromSimpleString(text);
            if (price) {
                foundPrice = price;
                return false; // Break loop
            }
            return true; // Continue loop
        });

        if (foundPrice) return foundPrice;
    }
    return null;
}

/**
 * Extracts a price from a short string (like a table row)
 */
function extractPriceFromSimpleString(text: string): number | null {
    const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
        const priceStr = match[1]!.replace(/,/g, '');
        const price = parseInt(priceStr, 10);
        
        // Validation logic
        if (price < 5000 || price > 60000) continue;
        if (text.includes('accommodation') || text.includes('living') || text.includes('deposit')) continue;
        
        return price; // Return first valid price
    }
    return null;
}

async function findFeeSubPage(mainUrl: string): Promise<string | null> {
    try {
        const response = await axios.get(mainUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: TIMEOUT });
        const $ = cheerio.load(response.data);
        let bestLink: string | null = null;

        $('a').each((_, element) => {
            const text = $(element).text().toLowerCase();
            const href = $(element).attr('href');
            if (!href) return true; // Continue loop

            if (text.includes('tuition') || text.includes('fees')) {
                try {
                    bestLink = new URL(href, mainUrl).toString();
                    return false; // Break loop
                } catch (e) {}
            }
            return true; // Continue loop
        });
        return bestLink;
    } catch (error) {
        return null;
    }
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
        const priceStr = match[1]!.replace(/,/g, '');
        const price = parseInt(priceStr, 10);
        const priceIndex = match.index;

        if (price < 5000 || price > 60000) continue; 
        
        const context = text.substring(Math.max(0, priceIndex - 50), Math.min(text.length, priceIndex + 50)).toLowerCase();
        if (context.includes('accommodation') || context.includes('living') || context.includes('deposit')) continue;

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
    
    if (candidates.length > 0 && candidates[0]) {
        return candidates[0].value;
    }
    return null;
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