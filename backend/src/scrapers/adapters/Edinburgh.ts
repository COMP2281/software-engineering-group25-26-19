// src/scrapers/adapters/Edinburgh.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const DEBUG = true;
const TIMEOUT = 30000;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

interface EdinburghFeeLink {
    url: string;
    text: string;
}

export class EdinburghAdapter extends GenericHtmlAdapter {
    
    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        let feeLinks: EdinburghFeeLink[] =[];

        // 1. Intercept PG courses to find ALL internal fee links
        if (courseUrl.includes('postgraduate-taught') || courseUrl.includes('postgraduate-research')) {
            if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Intercepting PG course to find fee links...`);
            
            try {
                const response = await axios.get(courseUrl, { headers: HEADERS_BROWSER, timeout: 10000 });
                const $ = cheerio.load(response.data);
                
                // Scan all links for 'programme_code='
                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    const text = $(el).text().toLowerCase().replace(/\s+/g, ' ').trim();
                    
                    if (href && href.includes('programme_code=')) {
                        const absUrl = new URL(href, courseUrl).toString();
                        // Avoid adding duplicate links
                        if (!feeLinks.some(l => l.url === absUrl)) {
                            feeLinks.push({ url: absUrl, text });
                        }
                    }
                });

                if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Found ${feeLinks.length} distinct fee links.`);

            } catch (error) {
                if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Failed to intercept main page. ${error}`);
            }
        }

        // If no links found, fallback to generic scraper on the main URL
        if (feeLinks.length === 0) {
            if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: No programme_code links found. Falling back to generic.`);
            return super.scrapeCourse(courseUrl, contexts);
        }

        // 2. Process Contexts using the discovered URLs and Contextual Scoring
        const results: OptionScrapeResult[] =[];
        const htmlCache = new Map<string, string | null>();

        for (const context of contexts) {
            let targetUrl: string | null = feeLinks.length > 0 ? feeLinks[0]!.url : null; // Default to the first link

            // If there are multiple links, we score them to find the best match for this specific option
            if (feeLinks.length > 1) {
                let bestScore = -Infinity;

                for (const link of feeLinks) {
                    let score = 0;

                    // A. Match Duration (e.g., "3 Years", "12 Months")
                    if (context.duration) {
                        const durNumMatch = context.duration.match(/\d+/);
                        if (durNumMatch) {
                            const num = durNumMatch[0];
                            const isYear = context.duration.toLowerCase().includes('year') || context.duration.toLowerCase().includes('yr');
                            const isMonth = context.duration.toLowerCase().includes('month') || context.duration.toLowerCase().includes('mth');
                            
                            const linkHasYear = link.text.includes(`${num} year`) || link.text.includes(`${num} yr`);
                            const linkHasMonth = link.text.includes(`${num} month`) || link.text.includes(`${num} mth`);

                            if ((isYear && linkHasYear) || (isMonth && linkHasMonth)) {
                                score += 10;
                            }
                        }
                    }

                    // B. Match Study Mode (Full-time vs Part-time)
                    if (context.studyMode) {
                        const mode = context.studyMode.toLowerCase();
                        if (mode.includes('part') && (link.text.includes('part-time') || link.text.includes('part time'))) {
                            score += 10;
                        } else if (mode.includes('full') && (link.text.includes('full-time') || link.text.includes('full time'))) {
                            score += 10;
                        }
                    }

                    // C. Match Qualification (MSc, PgCert, PgDip, etc.)
                    const title = context.courseTitle.toLowerCase();
                    const quals =[
                        { id: 'msc', regex: /\bmsc\b/i },
                        { id: 'ma', regex: /\bma\b/i },
                        { id: 'pgcert', regex: /\b(pgcert|pg cert|postgraduate certificate)\b/i },
                        { id: 'pgdip', regex: /\b(pgdip|pg dip|postgraduate diploma)\b/i },
                        { id: 'pgprofdev', regex: /\b(pgprofdev|professional development)\b/i },
                        { id: 'mphil', regex: /\bmphil\b/i },
                        { id: 'phd', regex: /\bphd\b/i }
                    ];

                    for (const qual of quals) {
                        const titleHasQual = qual.regex.test(title);
                        const linkHasQual = qual.regex.test(link.text);
                        
                        if (titleHasQual && linkHasQual) {
                            score += 5;
                        } else if (titleHasQual && !linkHasQual) {
                            score -= 5; // Penalize if the DB title specifies a qual, but the link doesn't match
                        } else if (!titleHasQual && linkHasQual) {
                            score -= 2; // Slight penalty if link specifies a qual, but DB title is generic
                        }
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        targetUrl = link.url;
                    }
                }
                if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Mapped option[${context.optionId}] (Dur: ${context.duration}, Mode: ${context.studyMode}) to link with score ${bestScore}`);
            }

            if (!targetUrl) {
                results.push({ optionId: context.optionId, homeFee: null, internationalFee: null });
                continue;
            }

            // 3. Fetch with Puppeteer (Explicitly!)
            let html = htmlCache.get(targetUrl);
            if (html === undefined) {
                html = await this.fetchWithPuppeteer(targetUrl);
                htmlCache.set(targetUrl, html);
            }

            if (!html) {
                results.push({ optionId: context.optionId, homeFee: null, internationalFee: null });
                continue;
            }

            // 4. Parse using custom Edinburgh logic
            const fees = await this.parseHtml(html, context, false);
            
            results.push({
                optionId: context.optionId,
                ...fees
            });
        }

        return results;
    }

    /**
     * OVERRIDE: Custom HTML parser for Edinburgh's specific table structures.
     * This bypasses the Generic scraper's £4,500 limit to allow for cheaper Part-Time fees,
     * and specifically handles the "Estimated total fee" format for Online courses.
     */
    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Custom parsing for specific table formats...`);
        
        let cleanedHtml = html.replace(/funding/gi, 'fnding').replace(/scholarships?/gi, 'scholrships');
        const $ = cheerio.load(cleanedHtml);
        
        let homeFee: number | null = null;
        let intlFee: number | null = null;
        let scotlandFee: number | null = null;

        $('table').each((_, table) => {
            const headers: string[] =[];
            $(table).find('th').each((_, th) => { headers.push($(th).text().toLowerCase().trim()); });
            
            if (headers.length === 0) {
                $(table).find('tr').first().find('td').each((_, td) => { headers.push($(td).text().toLowerCase().trim()); });
            }

            // A. Check for Online Course format ("Estimated total fee for the award")
            const estimatedTotalIdx = headers.findIndex(h => h.includes('estimated total fee') || h.includes('total fee'));
            
            if (estimatedTotalIdx !== -1) {
                $(table).find('tr').each((_, tr) => {
                    const cells = $(tr).find('td');
                    if (cells.length > estimatedTotalIdx) {
                        const priceText = $(cells[estimatedTotalIdx]).text();
                        const match = priceText.match(/£\s?([0-9]{1,3}(,[0-9]{3})*)/);
                        if (match && match[1]) {
                            const val = parseInt(match[1].replace(/,/g, ''), 10);
                            // Lower threshold to £500 to catch part-time/modular fees
                            if (val > 500 && !homeFee && !intlFee) {
                                homeFee = val;
                                intlFee = val; // Online courses usually charge the same for everyone
                            }
                        }
                    }
                });
            } 
            // B. Standard Edinburgh format ("Scotland", "Rest of UK", "International")
            else {
                const scotIdx = headers.findIndex(h => h.includes('scotland'));
                const rukIdx = headers.findIndex(h => h.includes('rest of uk') || h.includes('home'));
                const intlIdx = headers.findIndex(h => h.includes('international') || h.includes('overseas') || h.includes('eu'));

                $(table).find('tr').each((_, tr) => {
                    const cells = $(tr).find('td');
                    if (cells.length === 0) return;

                    const extractCell = (idx: number) => {
                        if (idx !== -1 && cells.length > idx) {
                            const match = $(cells[idx]).text().match(/£\s?([0-9]{1,3}(,[0-9]{3})*)/);
                            if (match && match[1]) {
                                const val = parseInt(match[1].replace(/,/g, ''), 10);
                                if (val > 500) return val; // Lower threshold
                            }
                        }
                        return null;
                    };

                    const sFee = extractCell(scotIdx);
                    const rFee = extractCell(rukIdx);
                    const iFee = extractCell(intlIdx);

                    // Grab the first valid row (usually the current academic year)
                    if (!scotlandFee && sFee) scotlandFee = sFee;
                    if (!homeFee && rFee) homeFee = rFee;
                    if (!intlFee && iFee) intlFee = iFee;
                });
            }
        });

        // If we successfully found fees via the custom table parser, return them
        if (homeFee || intlFee) {
            if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Extracted via custom table parser -> Home: £${homeFee}, Intl: £${intlFee}`);
            return { homeFee, internationalFee: intlFee, scotlandFee };
        }

        // Otherwise, fallback to the generic parser
        if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Custom table parser failed. Falling back to generic parser.`);
        return super.parseHtml(cleanedHtml, context, isPdf);
    }

    private async fetchWithPuppeteer(url: string): Promise<string | null> {
        if (!puppeteer) {
            Logger.error("Puppeteer is required for Edinburgh scraping.");
            return null;
        }

        let browser: any = null;
        try {
            if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Rendering SPA fee page: ${url}`);
            
            browser = await puppeteer.launch({ 
                headless: "new", 
                args:['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            try {
                await page.waitForFunction(
                    'document.body.innerText.includes("£") || document.querySelector("table")',
                    { timeout: 5000 }
                );
            } catch (e) { /* ignore timeout */ }

            return await page.content();

        } catch (error) {
            if (DEBUG) Logger.debug(`[DEBUG] Edinburgh Puppeteer failed: ${error}`);
            return null;
        } finally {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
        }
    }
}