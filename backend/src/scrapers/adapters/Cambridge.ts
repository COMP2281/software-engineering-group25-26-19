// src/scrapers/adapters/Cambridge.ts

import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
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
    
    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        let targetUrl = courseUrl;

        // Intercept Postgraduate URLs
        if (targetUrl.includes('postgraduate.study.cam.ac.uk/courses/directory/')) {
            targetUrl = targetUrl.replace(/\/$/, '');
            if (!targetUrl.endsWith('/finance')) {
                targetUrl += '/finance';
            }
            
            if (DEBUG) console.log(`[DEBUG] Cambridge: Rewrote PG URL -> ${targetUrl}`);
            
            // Run Puppeteer interaction ONCE
            const fees = await this.scrapePostgraduateWithPuppeteer(targetUrl);
            
            // Map to all contexts
            return contexts.map(ctx => ({
                optionId: ctx.optionId,
                ...fees
            }));
        }

        // Fallback to Generic for UG (or non-directory PG links)
        return super.scrapeCourse(targetUrl, contexts);
    }

    private async scrapePostgraduateWithPuppeteer(url: string): Promise<ScrapedFees> {
        let result: ScrapedFees = { homeFee: null, internationalFee: null };

        if (!puppeteer) return result;

        let browser: any = null;
        try {
            browser = await puppeteer.launch({ 
                headless: "new", 
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            result = await page.evaluate(async () => {
                const getFee = () => {
                    const cells = Array.from(document.querySelectorAll('td, th, div, span'));
                    const ucfCell = cells.find(el => el.textContent && el.textContent.includes('University Composition Fee'));
                    if (ucfCell) {
                        const parentRow = ucfCell.closest('tr') || ucfCell.parentElement;
                        if (parentRow) {
                            const text = parentRow.innerText.replace(/\s+/g, ' ');
                            const match = text.match(/£\s?([0-9]{1,3}(,[0-9]{3})*)/);
                            if (match && match[1]) return parseInt(match[1].replace(/,/g, ''), 10);
                        }
                    }
                    return null;
                };

                const homeFee = getFee();
                let intlFee = null;

                const labels = Array.from(document.querySelectorAll('label'));
                const overseasLabel = labels.find(l => l.innerText.trim() === 'Overseas' || l.innerText.includes('Overseas'));
                
                if (overseasLabel) {
                    overseasLabel.click();
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    intlFee = getFee();
                } else {
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

        } catch (error) {
            if (DEBUG) console.log(`[DEBUG] Cambridge PG Puppeteer failed: ${error}`);
        } finally {
            if (browser) try { await browser.close(); } catch (e) {}
        }

        return result;
    }
}