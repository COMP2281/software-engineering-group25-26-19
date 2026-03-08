// src/scrapers/adapters/Bristol.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { IScraperAdapter, OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const TIMEOUT = 30000;
// const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

export class BristolAdapter implements IScraperAdapter {
    
    async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const html = await this.fetchHtml(courseUrl);
        if (!html) return [];

        const $ = cheerio.load(html);
        const pageText = $('body').text().replace(/\s+/g, ' ');
        
        const results: OptionScrapeResult[] = [];

        for (const context of contexts) {
            const mode = (context.studyMode || 'full-time').toLowerCase();
            const isPartTime = mode.includes('part');

            // Define Regex based on Study Mode
            // PG Example: "Home: full-time £19,500" vs "Home: part-time £9,750"
            const modeString = isPartTime ? 'part-?time' : 'full-?time';
            
            // PG Regexes
            const pgHomeRegex = new RegExp(`home:\\s*${modeString}[^£]{0,40}£\\s?([0-9]{1,3}(,[0-9]{3})*)`, 'i');
            const pgIntlRegex = new RegExp(`overseas:\\s*${modeString}[^£]{0,40}£\\s?([0-9]{1,3}(,[0-9]{3})*)`, 'i');

            // UG Regexes (Usually just one list, but we check anyway)
            // "£9,535 per year, home students"
            const ugHomeRegex = /£\s?([0-9]{1,3}(,[0-9]{3})*)[^£]{0,40}home/i;
            const ugIntlRegex = /£\s?([0-9]{1,3}(,[0-9]{3})*)[^£]{0,40}international/i;

            let fees: ScrapedFees = { homeFee: null, internationalFee: null };

            // Try PG Patterns first (Specific mode)
            const pgHomeMatch = pageText.match(pgHomeRegex);
            const pgIntlMatch = pageText.match(pgIntlRegex);

            if (pgHomeMatch || pgIntlMatch) {
                if (pgHomeMatch && pgHomeMatch[1]) fees.homeFee = parseInt(pgHomeMatch[1].replace(/,/g, ''), 10);
                if (pgIntlMatch && pgIntlMatch[1]) fees.internationalFee = parseInt(pgIntlMatch[1].replace(/,/g, ''), 10);
            } else {
                // Try UG Patterns (Generic)
                const ugHomeMatch = pageText.match(ugHomeRegex);
                const ugIntlMatch = pageText.match(ugIntlRegex);
                if (ugHomeMatch && ugHomeMatch[1]) fees.homeFee = parseInt(ugHomeMatch[1].replace(/,/g, ''), 10);
                if (ugIntlMatch && ugIntlMatch[1]) fees.internationalFee = parseInt(ugIntlMatch[1].replace(/,/g, ''), 10);
            }

            results.push({
                optionId: context.optionId,
                ...fees
            });
        }

        return results;
    }

    private async fetchHtml(url: string): Promise<string | null> {
        try {
            const response = await axios.get(url, { headers: HEADERS_BROWSER, timeout: 10000 });
            if (response.status < 400) return response.data;
        } catch (e) {}

        if (puppeteer) {
            let browser: any = null;
            try {
                browser = await puppeteer.launch({ headless: "new", args:['--no-sandbox'] });
                const page = await browser.newPage();
                await page.setUserAgent(HEADERS_BROWSER['User-Agent']);
                await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
                return await page.content();
            } catch (e) {
            } finally {
                if (browser) await browser.close();
            }
        }
        return null;
    }
}