// src/scrapers/adapters/Cambridge.ts

import { OptionScrapeResult, ScrapeContext } from '../interfaces';
import { GenericHtmlAdapter } from './GenericHtml';
import { Logger } from '../logger';

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

        // Intercept Postgraduate URLs (handles both graduate.study and postgraduate.study)
        if (/(post)?graduate\.study\.cam\.ac\.uk\/courses\/directory\//i.test(targetUrl)) {
            
            // Force the URL to the /finance tab
            targetUrl = targetUrl.replace(/\/$/, '');
            if (!targetUrl.endsWith('/finance')) {
                targetUrl += '/finance';
            }
            
            if (DEBUG) Logger.debug(`[DEBUG] Cambridge: Rewrote PG URL to target finance tab -> ${targetUrl}`);
            
            // Use custom Puppeteer logic to interact with the Home/Overseas and FT/PT buttons
            return await this.scrapePostgraduateWithPuppeteer(targetUrl, contexts);
        }

        // If it's not a PG directory link, fallback to the standard GenericHtmlAdapter logic
        return super.scrapeCourse(targetUrl, contexts);
    }

    private async scrapePostgraduateWithPuppeteer(url: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        if (!puppeteer) {
            Logger.error("[ERROR] Puppeteer is required for Cambridge PG scraping.");
            return[];
        }

        let browser: any = null;
        let extractedFees = { homeFt: null as number|null, intlFt: null as number|null, homePt: null as number|null, intlPt: null as number|null };

        try {
            browser = await puppeteer.launch({ 
                headless: "new", 
                args:['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

            // Execute interaction logic inside the browser context
            extractedFees = await page.evaluate(async () => {
                
                // Helper to find the fee value
                const getFee = () => {
                    const cells = Array.from(document.querySelectorAll('td, th, div, span'));
                    // Look for common Cambridge fee labels
                    const feeCell = cells.find(el => {
                        const t = (el.textContent || '').toLowerCase();
                        return t.includes('university composition fee') || t.includes('course fee') || t === 'fee payable';
                    });
                    
                    if (feeCell) {
                        const parentRow = feeCell.closest('tr') || feeCell.parentElement;
                        if (parentRow) {
                            const text = parentRow.innerText.replace(/\s+/g, ' ');
                            // Find the first valid price
                            const match = text.match(/£\s?([0-9]{1,3}(,[0-9]{3})*)/);
                            if (match?.[1]) {
                                const val = parseInt(match[1].replace(/,/g, ''), 10);
                                if (val > 1000 && val < 100000) return val;
                            }
                        }
                    }
                    
                    // Fallback: Just grab the largest prominent £ figure in the main content area
                    const mainContent = document.querySelector('main') || document.body;
                    const text = mainContent.innerText.replace(/\s+/g, ' ');
                    const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
                    const prices =[];
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        if (match[1]) {
                            const val = parseInt(match[1].replace(/,/g, ''), 10);
                            if (val > 1000 && val < 100000) prices.push(val);
                        }
                    }
                    return prices.length > 0 ? Math.max(...prices) : null;
                };

                // Helper to click UI elements (Tabs, Radio buttons, Selects)
                const clickOption = async (searchText: string) => {
                    const searchLower = searchText.toLowerCase();
                    
                    // 1. Try labels
                    const labels = Array.from(document.querySelectorAll('label'));
                    const targetLabel = labels.find(l => l.innerText.toLowerCase().includes(searchLower));
                    if (targetLabel) {
                        targetLabel.click();
                        await new Promise(r => setTimeout(r, 1500));
                        return true;
                    }
                    
                    // 2. Try buttons/tabs
                    const buttons = Array.from(document.querySelectorAll('button, a.nav-link, a.tab'));
                    const targetBtn = buttons.find(b => (b as HTMLElement).innerText.toLowerCase().includes(searchLower));
                    if (targetBtn) {
                        (targetBtn as HTMLElement).click();
                        await new Promise(r => setTimeout(r, 1500));
                        return true;
                    }

                    // 3. Try inputs
                    const inputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')) as HTMLInputElement[];
                    const targetInput = inputs.find(i => (i.value && i.value.toLowerCase().includes(searchLower)) || (i.id && i.id.toLowerCase().includes(searchLower)));
                    if (targetInput) {
                        targetInput.click();
                        await new Promise(r => setTimeout(r, 1500));
                        return true;
                    }

                    // 4. Try selects
                    const selects = Array.from(document.querySelectorAll('select'));
                    for (const s of selects) {
                        const opt = Array.from(s.options).find(o => o.text.toLowerCase().includes(searchLower));
                        if (opt && s.value !== opt.value) {
                            s.value = opt.value;
                            s.dispatchEvent(new Event('change', { bubbles: true }));
                            await new Promise(r => setTimeout(r, 1500));
                            return true;
                        }
                    }
                    return false;
                };

                const res = { homeFt: null as number|null, intlFt: null as number|null, homePt: null as number|null, intlPt: null as number|null };

                // Ensure we are on Home + Full-time first
                await clickOption('home');
                await clickOption('full-time');
                res.homeFt = getFee();

                // Switch to Overseas
                const clickedOverseas = await clickOption('overseas') || await clickOption('international');
                if (clickedOverseas) {
                    res.intlFt = getFee();
                } else {
                    res.intlFt = getFee(); // Might be same if UI is different, handled in Node sanity check
                }

                // Now try Part-time
                await clickOption('home'); // Reset to home
                const hasPt = await clickOption('part-time');
                if (hasPt) {
                    res.homePt = getFee();
                    await clickOption('overseas') || await clickOption('international');
                    res.intlPt = getFee();
                }

                return res;
            });

            if (DEBUG) Logger.debug(`[DEBUG] Cambridge PG Puppeteer extracted -> FT:[Home: £${extractedFees.homeFt}, Intl: £${extractedFees.intlFt}] | PT:[Home: £${extractedFees.homePt}, Intl: £${extractedFees.intlPt}]`);

        } catch (error) {
            if (DEBUG) Logger.debug(`[DEBUG] Cambridge PG Puppeteer failed: ${error instanceof Error ? error.message : error}`);
        } finally {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
        }

        // Map the extracted states to the requested contexts
        const results: OptionScrapeResult[] =[];

        for (const ctx of contexts) {
            const isPartTime = (ctx.studyMode || '').toLowerCase().includes('part');
            
            let hFee = isPartTime ? extractedFees.homePt : extractedFees.homeFt;
            let iFee = isPartTime ? extractedFees.intlPt : extractedFees.intlFt;

            // Sanity check: if Home >= Intl, something went wrong with the toggle (e.g. it grabbed Home twice)
            if (hFee && iFee && hFee >= iFee) {
                if (DEBUG) Logger.debug(`[DEBUG] Cambridge: Sanity check failed for option [${ctx.optionId}]. Home (£${hFee}) >= Intl (£${iFee}). Discarding Home.`);
                hFee = null;
            }

            results.push({
                optionId: ctx.optionId,
                homeFee: hFee,
                internationalFee: iFee
            });
        }

        return results;
    }
}