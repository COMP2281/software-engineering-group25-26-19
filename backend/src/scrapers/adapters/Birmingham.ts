// src/scrapers/adapters/Birmingham.ts

import { IScraperAdapter, OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const TIMEOUT = 30000;
const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

export class BirminghamAdapter implements IScraperAdapter {
    
    async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        let fees: ScrapedFees = { homeFee: null, internationalFee: null };

        if (!puppeteer) {
            console.error("[ERROR] Puppeteer is required for the BirminghamAdapter.");
            return [];
        }

        if (DEBUG) console.log(`[DEBUG] Launching Puppeteer for Birmingham: ${courseUrl}`);
        let browser: any = null;

        try {
            browser = await puppeteer.launch({ 
                headless: "new", 
                args:['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            fees = await page.evaluate(async () => {
                const extractPrices = () => {
                    const text = document.body.innerText.replace(/\s+/g, ' ');
                    const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
                    const prices: number[] =[];
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const val = parseInt(match[1]?.replace(/,/g, '') || '0', 10);
                        if (val > 4500 && val < 80000) prices.push(val);
                    }
                    return prices;
                };

                const initialPrices = extractPrices();
                const homeFee = initialPrices.length > 0 ? Math.min(...initialPrices) : null;
                let intlFee = initialPrices.length > 1 ? Math.max(...initialPrices) : null;

                const selects = Array.from(document.querySelectorAll('select'));
                const countrySelect = selects.find(s => s.innerText.includes('China') || s.innerText.includes('India'));

                if (countrySelect) {
                    const options = Array.from(countrySelect.options);
                    const intlOption = options.find(o => o.text.includes('China') || o.text.includes('India'));
                    
                    if (intlOption) {
                        countrySelect.value = intlOption.value;
                        countrySelect.dispatchEvent(new Event('change', { bubbles: true }));
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        
                        const newPrices = extractPrices();
                        if (newPrices.length > 0) {
                            const newMax = Math.max(...newPrices);
                            if (homeFee && newMax > homeFee) {
                                intlFee = newMax;
                            }
                        }
                    }
                }
                return { homeFee, internationalFee: intlFee };
            });

            if (DEBUG) console.log(`[DEBUG] Birmingham Puppeteer extracted -> Home: £${fees.homeFee}, Intl: £${fees.internationalFee}`);

        } catch (error) {
            if (DEBUG) console.log(`[DEBUG] BirminghamAdapter failed: ${error instanceof Error ? error.message : error}`);
        } finally {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
        }

        // Map the single result to all options
        return contexts.map(ctx => ({
            optionId: ctx.optionId,
            ...fees
        }));
    }
}