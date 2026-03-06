// src/scrapers/adapters/Cambridge.ts

import { ScrapedFees } from '../interfaces';
import { GenericHtmlAdapter } from './GenericHtml';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const TIMEOUT = 30000;
const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

export class CambridgeAdapter extends GenericHtmlAdapter {
    
    override async scrapeCourse(courseUrl: string, courseTitle?: string): Promise<ScrapedFees> {
        let targetUrl = courseUrl;

        // Intercept Postgraduate URLs
        if (targetUrl.includes('postgraduate.study.cam.ac.uk/courses/directory/')) {
            
            // Force the URL to the /finance tab
            targetUrl = targetUrl.replace(/\/$/, '');
            if (!targetUrl.endsWith('/finance')) {
                targetUrl += '/finance';
            }
            
            if (DEBUG) console.log(`[DEBUG] Cambridge: Rewrote PG URL to target finance tab -> ${targetUrl}`);
            
            // Use custom Puppeteer logic to interact with the Home/Overseas toggle buttons
            return await this.scrapePostgraduateWithPuppeteer(targetUrl);
        }

        // If it's not a PG directory link, fallback to the standard GenericHtmlAdapter logic
        return super.scrapeCourse(targetUrl, courseTitle);
    }

    private async scrapePostgraduateWithPuppeteer(url: string): Promise<ScrapedFees> {
        let result: ScrapedFees = { homeFee: null, internationalFee: null };

        if (!puppeteer) {
            console.error("[ERROR] Puppeteer is required for Cambridge PG scraping.");
            return result;
        }

        let browser: any = null;

        try {
            browser = await puppeteer.launch({ 
                headless: "new", 
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            // Execute interaction logic inside the browser context
            result = await page.evaluate(async () => {
                
                // Helper to find the "University Composition Fee" row and extract the price
                const getFee = () => {
                    const cells = Array.from(document.querySelectorAll('td, th, div, span'));
                    const ucfCell = cells.find(el => el.textContent && el.textContent.includes('University Composition Fee'));
                    
                    if (ucfCell) {
                        // The fee is usually in the next sibling cell, or within the parent row
                        const parentRow = ucfCell.closest('tr') || ucfCell.parentElement;
                        if (parentRow) {
                            const text = parentRow.innerText.replace(/\s+/g, ' ');
                            const match = text.match(/£\s?([0-9]{1,3}(,[0-9]{3})*)/);
                            if (match && match[1]) return parseInt(match[1].replace(/,/g, ''), 10);
                        }
                    }
                    return null;
                };

                // 1. Get default fee (Home)
                const homeFee = getFee();

                // 2. Find and click the "Overseas" option
                const labels = Array.from(document.querySelectorAll('label'));
                const overseasLabel = labels.find(l => l.innerText.trim() === 'Overseas' || l.innerText.includes('Overseas'));
                
                let intlFee = null;

                if (overseasLabel) {
                    overseasLabel.click();
                    
                    // Wait for DOM update (1.5 seconds)
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    
                    // 3. Extract the updated fee
                    intlFee = getFee();
                } else {
                    // Fallback: Try finding a radio input directly if the label isn't clickable
                    const inputs = Array.from(document.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
                    const overseasInput = inputs.find(i => i.value.toLowerCase().includes('overseas') || i.id.toLowerCase().includes('overseas'));
                    if (overseasInput) {
                        overseasInput.click();
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        intlFee = getFee();
                    }
                }

                return { homeFee, internationalFee: intlFee };
            });

            if (DEBUG) console.log(`[DEBUG] Cambridge PG Puppeteer extracted -> Home: £${result.homeFee}, Intl: £${result.internationalFee}`);

        } catch (error) {
            if (DEBUG) console.log(`[DEBUG] Cambridge PG Puppeteer failed: ${error instanceof Error ? error.message : error}`);
        } finally {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
        }

        return result;
    }
}