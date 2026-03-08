// src/scrapers/adapters/Edinburgh.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext } from '../interfaces';
import { Logger } from '../logger';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const DEBUG = true;
const TIMEOUT = 30000;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

export class EdinburghAdapter extends GenericHtmlAdapter {
    
    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        let modeMap = new Map<string, string>();
        let defaultUrl: string | null = null;

        // 1. Intercept PG courses to find the internal fee links
        if (courseUrl.includes('postgraduate-taught') || courseUrl.includes('postgraduate-research')) {
            if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Intercepting PG course to find fee links...`);
            
            try {
                const response = await axios.get(courseUrl, { headers: HEADERS_BROWSER, timeout: 10000 });
                const $ = cheerio.load(response.data);
                
                // Scan all links for 'programme_code='
                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    const text = $(el).text().toLowerCase();
                    
                    if (href && href.includes('programme_code=')) {
                        const absUrl = new URL(href, courseUrl).toString();
                        
                        // Heuristic: Map link text to study mode
                        if (text.includes('part-time') || text.includes('part time')) {
                            modeMap.set('part-time', absUrl);
                        } else if (text.includes('full-time') || text.includes('full time') || text.includes('1 year')) {
                            modeMap.set('full-time', absUrl);
                        }
                        
                        // Keep the first one found as a default fallback
                        if (!defaultUrl) defaultUrl = absUrl;
                    }
                });

                if (modeMap.size > 0) {
                    if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Found fee links: ${Array.from(modeMap.keys()).join(', ')}`);
                } else if (defaultUrl) {
                    if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Found single default fee link.`);
                } else {
                    if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: No programme_code links found. Falling back to generic.`);
                    return super.scrapeCourse(courseUrl, contexts);
                }

            } catch (error) {
                if (DEBUG) Logger.debug(`[DEBUG] Edinburgh: Failed to intercept main page. ${error}`);
                return super.scrapeCourse(courseUrl, contexts);
            }
        } else {
            // UG or other: Fallback to generic
            return super.scrapeCourse(courseUrl, contexts);
        }

        // 2. Process Contexts using the discovered URLs
        const results: OptionScrapeResult[] = [];
        
        // Cache rendered HTML to avoid re-fetching the same fee page multiple times
        const htmlCache = new Map<string, string | null>();

        for (const context of contexts) {
            const mode = (context.studyMode || '').toLowerCase();
            let targetUrl: string | null = defaultUrl;

            // Try to find a specific URL for this mode
            if (mode.includes('part') && modeMap.has('part-time')) {
                targetUrl = modeMap.get('part-time') || null;
            } else if (mode.includes('full') && modeMap.has('full-time')) {
                targetUrl = modeMap.get('full-time') || null;
            }

            if (!targetUrl) {
                results.push({ optionId: context.optionId, homeFee: null, internationalFee: null });
                continue;
            }

            // 3. Fetch with Puppeteer (Explicitly!)
            // We skip Axios because we KNOW Edinburgh fee pages are SPAs that require JS.
            let html = htmlCache.get(targetUrl);
            if (!html) {
                html = await this.fetchWithPuppeteer(targetUrl);
                if (html) htmlCache.set(targetUrl, html);
            }

            if (!html) {
                results.push({ optionId: context.optionId, homeFee: null, internationalFee: null });
                continue;
            }

            // 4. Parse using the Generic logic (which handles sanitization and table extraction)
            // We call the protected parseHtml method directly
            const fees = await super.parseHtml(html, context, false);
            
            results.push({
                optionId: context.optionId,
                ...fees
            });
        }

        return results;
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
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            // Wait specifically for the fee table to appear
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