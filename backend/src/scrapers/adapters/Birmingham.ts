// src/scrapers/adapters/Birmingham.ts

import { IScraperAdapter, ScrapedFees } from '../interfaces';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const TIMEOUT = 30000;
const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

export class BirminghamAdapter implements IScraperAdapter {
    
    async scrapeCourse(courseUrl: string, _courseTitle?: string): Promise<ScrapedFees> {
        let result: ScrapedFees = { homeFee: null, internationalFee: null };

        if (!puppeteer) {
            console.error("[ERROR] Puppeteer is required for the BirminghamAdapter.");
            return result;
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
            
            // Load the page
            await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            // Execute interaction logic inside the browser context
            result = await page.evaluate(async () => {
                // Helper to extract all valid fees currently visible on the page
                const extractPrices = () => {
                    const bodytext = document?.body?.innerText;
                    if (!bodytext) return [];
                    const text = bodytext.replace(/\s+/g, ' ');
                    const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
                    const prices: number[] =[];
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        if (match[1]) {
                            const val = parseInt(match[1].replace(/,/g, ''), 10);
                            if (val > 4500 && val < 80000) prices.push(val);
                        }
                    }
                    return prices;
                };

                // 1. Get the default state (Usually Home Fee)
                const initialPrices = extractPrices();
                const homeFee = initialPrices.length > 0 ? Math.min(...initialPrices) : null;
                let intlFee = initialPrices.length > 1 ? Math.max(...initialPrices) : null;

                // 2. Find the country dropdown
                const selects = Array.from(document.querySelectorAll('select'));
                const countrySelect = selects.find(s => s.innerText.includes('China') || s.innerText.includes('India'));

                if (countrySelect) {
                    // Find an international option
                    const options = Array.from(countrySelect.options);
                    const intlOption = options.find(o => o.text.includes('China') || o.text.includes('India'));
                    
                    if (intlOption) {
                        // 3. Change the dropdown value to the international country
                        countrySelect.value = intlOption.value;
                        countrySelect.dispatchEvent(new Event('change', { bubbles: true }));
                        
                        // 4. Wait for the JavaScript to fetch and render the new price (1.5 seconds)
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        
                        // 5. Extract prices again. The new highest price is the International Fee.
                        const newPrices = extractPrices();
                        if (newPrices.length > 0) {
                            const newMax = Math.max(...newPrices);
                            // Only update if the new price is actually higher than the home fee
                            if (homeFee && newMax > homeFee) {
                                intlFee = newMax;
                            }
                        }
                    }
                }

                return { homeFee, internationalFee: intlFee };
            });

            if (DEBUG) console.log(`[DEBUG] Puppeteer extracted -> Home: £${result.homeFee}, Intl: £${result.internationalFee}`);

        } catch (error) {
            if (DEBUG) console.log(`[DEBUG] BirminghamAdapter failed: ${error instanceof Error ? error.message : error}`);
        } finally {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
        }

        return result;
    }
}