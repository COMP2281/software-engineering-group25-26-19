// src/scrapers/adapters/Birmingham.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext } from '../interfaces';
import * as cheerio from 'cheerio';
import { Logger } from '../logger';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const TIMEOUT = 30000;
const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

const TRAP_KEYWORDS =[
    'scholarship', 'bursary', 'funding', 'award', 'loan', 'grant', 'stipend', 
    'accommodation', 'living', 'housing', 'residence', 'bench fee', 
    'additional cost', 'maintenance', 'contribution', 'discount', 'advance'
];

export class BirminghamAdapter extends GenericHtmlAdapter {
    
    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        if (!puppeteer) {
            Logger.error("[ERROR] Puppeteer is required for the BirminghamAdapter.");
            return[];
        }

        if (DEBUG) Logger.debug(`[DEBUG] Launching Puppeteer for Birmingham: ${courseUrl}`);
        let browser: any = null;
        let homeHtml = '';
        let intlHtml = '';
        let dropdownChanged = false;

        try {
            browser = await puppeteer.launch({ 
                headless: "new", 
                args:['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            // 1. Capture the default state (Home)
            homeHtml = await page.content();

            // 2. Interact with the dropdown to reveal International fees
            dropdownChanged = await page.evaluate(() => {
                const selects = Array.from(document.querySelectorAll('select'));
                
                const targetSelect = selects.find(s => {
                    const text = s.innerText.toLowerCase();
                    return text.includes('international') || text.includes('overseas') || text.includes('china') || text.includes('india');
                });

                if (targetSelect) {
                    const options = Array.from(targetSelect.options);
                    const intlOption = options.find(o => {
                        const text = o.text.toLowerCase();
                        return text.includes('international') || text.includes('overseas') || text.includes('china') || text.includes('india');
                    });
                    
                    if (intlOption && targetSelect.value !== intlOption.value) {
                        targetSelect.value = intlOption.value;
                        targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
                return false;
            });

            if (dropdownChanged) {
                if (DEBUG) Logger.debug(`[DEBUG] Birmingham: Dropdown changed. Waiting for DOM update...`);
                await new Promise(resolve => setTimeout(resolve, 1500));
                intlHtml = await page.content();
            }

        } catch (error) {
            if (DEBUG) Logger.debug(`[DEBUG] BirminghamAdapter Puppeteer failed: ${error instanceof Error ? error.message : error}`);
        } finally {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
        }

        if (!homeHtml) return [];

        const results: OptionScrapeResult[] =[];

        // 3. Process each context (Study Mode) individually
        for (const ctx of contexts) {
            const isPartTime = (ctx.studyMode || '').toLowerCase().includes('part');
            
            // Sanitize the HTML using the new bidirectional regex
            const cleanHomeHtml = this.sanitizeForStudyMode(homeHtml, ctx.studyMode || '');
            
            let homeFee: number | null = null;
            let intlFee: number | null = null;

            if (dropdownChanged && intlHtml) {
                const cleanIntlHtml = this.sanitizeForStudyMode(intlHtml, ctx.studyMode || '');
                
                const homePrices = this.extractPricesSafely(cleanHomeHtml);
                const intlPrices = this.extractPricesSafely(cleanIntlHtml);

                // CONTEXT-AWARE SELECTION:
                // If Part-time, we want the lowest extracted fee. If Full-time, we want the highest.
                if (homePrices.length > 0) {
                    homeFee = isPartTime ? Math.min(...homePrices) : Math.max(...homePrices);
                }
                if (intlPrices.length > 0) {
                    intlFee = isPartTime ? Math.min(...intlPrices) : Math.max(...intlPrices);
                }

                // Sanity check
                if (homeFee && intlFee && homeFee >= intlFee) {
                    homeFee = null;
                }
            } else {
                if (DEBUG) Logger.debug(`[DEBUG] Birmingham: No dropdown found. Falling back to generic parser for option [${ctx.optionId}].`);
                const genericRes = await super.parseHtml(cleanHomeHtml, ctx, false);
                homeFee = genericRes.homeFee;
                intlFee = genericRes.internationalFee;
            }

            results.push({
                optionId: ctx.optionId,
                homeFee,
                internationalFee: intlFee
            });
        }

        return results;
    }

    private extractPricesSafely(html: string): number[] {
        const $ = cheerio.load(html);
        $('script, style, nav, footer, header').remove();
        
        $('*').each((_idx, el) => {
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

        const text = $('body').text().replace(/\s+/g, ' ');
        const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
        const prices: number[] =[];
        let match;
        
        while ((match = regex.exec(text)) !== null) {
            const val = parseInt(match[1]?.replace(/,/g, '') || '0', 10);
            if (val > 1000 && val < 80000) prices.push(val);
        }
        
        return prices;
    }
}