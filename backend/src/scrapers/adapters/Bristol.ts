// src/scrapers/adapters/Bristol.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { IScraperAdapter, ScrapedFees } from '../interfaces';

let puppeteer: any;
try { puppeteer = require('puppeteer'); } catch (e) {}

const TIMEOUT = 30000;
const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

export class BristolAdapter implements IScraperAdapter {
    
    async scrapeCourse(courseUrl: string, _courseTitle?: string): Promise<ScrapedFees> {
        let result: ScrapedFees = { homeFee: null, internationalFee: null };

        const html = await this.fetchHtml(courseUrl);
        if (!html) return result;

        const $ = cheerio.load(html);
        // Normalize whitespace to make regex matching predictable
        const pageText = $('body').text().replace(/\s+/g, ' ');

        // 1. Try Postgraduate Format
        // Looks for: "Home: full-time £19,500" or "Overseas: full-time £39,000"
        const pgHomeRegex = /home:\s*full-?time[^£]{0,20}£\s?([0-9]{1,3}(,[0-9]{3})*)/i;
        const pgIntlRegex = /overseas:\s*full-?time[^£]{0,20}£\s?([0-9]{1,3}(,[0-9]{3})*)/i;

        const pgHomeMatch = pageText.match(pgHomeRegex);
        const pgIntlMatch = pageText.match(pgIntlRegex);

        if (pgHomeMatch || pgIntlMatch) {
            if (DEBUG) console.log(`[DEBUG] Bristol: Detected Postgraduate format.`);
            if (pgHomeMatch && pgHomeMatch[1]) result.homeFee = parseInt(pgHomeMatch[1].replace(/,/g, ''), 10);
            if (pgIntlMatch && pgIntlMatch[1]) result.internationalFee = parseInt(pgIntlMatch[1].replace(/,/g, ''), 10);
            return result;
        }

        // 2. Try Undergraduate Format 
        // Looks for: "£9,535 per year, home students" and "£28,200 per year, international students"
        const ugHomeRegex = /£\s?([0-9]{1,3}(,[0-9]{3})*)[^£]{0,40}home/i;
        const ugIntlRegex = /£\s?([0-9]{1,3}(,[0-9]{3})*)[^£]{0,40}international/i;

        const ugHomeMatch = pageText.match(ugHomeRegex);
        const ugIntlMatch = pageText.match(ugIntlRegex);

        if (ugHomeMatch || ugIntlMatch) {
            if (DEBUG) console.log(`[DEBUG] Bristol: Detected Undergraduate format.`);
            if (ugHomeMatch && ugHomeMatch[1]) result.homeFee = parseInt(ugHomeMatch[1].replace(/,/g, ''), 10);
            if (ugIntlMatch && ugIntlMatch[1]) result.internationalFee = parseInt(ugIntlMatch[1].replace(/,/g, ''), 10);
            return result;
        }

        if (DEBUG) console.log(`[DEBUG] Bristol: Could not match UG or PG fee patterns.`);
        return result;
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