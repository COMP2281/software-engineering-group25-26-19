// src/scrapers/adapters/Glasgow.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

interface GlasgowUgBands {
    ruk: number | null;
    intlArts: number | null;
    intlScience: number | null;
    intlClinical: number | null;
}

export class GlasgowAdapter extends GenericHtmlAdapter {
    private urls: { ugRuk?: string, ugIntl?: string };
    private ugBands: GlasgowUgBands | null = null;

    constructor(centralFeeUrls: { ugRuk?: string, ugIntl?: string }) {
        super();
        if (!centralFeeUrls || !centralFeeUrls.ugRuk || !centralFeeUrls.ugIntl) {
            throw new Error("GlasgowAdapter requires ugRuk and ugIntl URLs in config.ts");
        }
        this.urls = centralFeeUrls;
    }

    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        // 1. Route Postgraduate courses to the Generic Scraper
        // The GenericHtmlAdapter handles contexts natively, so we just pass it through.
        if (courseUrl.toLowerCase().includes('/postgraduate/')) {
            if (DEBUG) Logger.debug(`[DEBUG] Glasgow: Routing PG course to GenericHtmlAdapter.`);
            // Note: We use our custom handlePostgraduate for specific regex fixes, 
            // but we need to map it to the array format.
            const pgFees = await this.handlePostgraduate(courseUrl);
            
            return contexts.map(ctx => ({
                optionId: ctx.optionId,
                ...pgFees
            }));
        }

        // 2. Route Undergraduate courses to Custom Banding Logic
        if (courseUrl.toLowerCase().includes('/undergraduate/')) {
            const courseTitle = contexts[0]?.courseTitle || '';
            const ugFees = await this.handleUndergraduate(courseUrl, courseTitle);
            
            return contexts.map(ctx => ({
                optionId: ctx.optionId,
                ...ugFees
            }));
        }

        return [];
    }

    // ==========================================
    // POSTGRADUATE LOGIC (Directional Regex)
    // ==========================================
    private async handlePostgraduate(courseUrl: string): Promise<ScrapedFees> {
        try {
            const response = await axios.get(courseUrl, { headers: HEADERS_BROWSER, timeout: 10000 });
            const $ = cheerio.load(response.data);
            const text = $('body').text().replace(/\s+/g, ' ');

            const homeFee = this.extractPriceAfterKeyword(text, 'UK', 4500);
            const intlFee = this.extractPriceAfterKeyword(text, 'International', 10000);

            if (DEBUG) Logger.debug(`[DEBUG] Glasgow PG: Home £${homeFee}, Intl £${intlFee}`);

            return { homeFee, internationalFee: intlFee };

        } catch (error) {
            if (DEBUG) Logger.debug(`[DEBUG] Glasgow PG Fetch Failed: ${error}`);
            return { homeFee: null, internationalFee: null };
        }
    }

    // ==========================================
    // UNDERGRADUATE LOGIC (Banding)
    // ==========================================
    private async handleUndergraduate(courseUrl: string, dbCourseTitle: string): Promise<ScrapedFees> {
        if (!this.ugBands) {
            await this.loadUgCentralFees();
        }

        if (!this.ugBands) return { homeFee: null, internationalFee: null };

        let pageText = "";
        try {
            const response = await axios.get(courseUrl, { headers: HEADERS_BROWSER, timeout: 10000 });
            const $ = cheerio.load(response.data);
            pageText = $('body').text().toLowerCase().replace(/\s+/g, ' ');
        } catch (e) {
            if (DEBUG) Logger.debug(`[DEBUG] Glasgow: Failed to fetch UG course page for context.`);
        }

        const title = dbCourseTitle.toLowerCase();
        const context = `${title} ${pageText.substring(0, 2000)}`;

        let intlFee = this.ugBands.intlArts;

        if (/(medicine|dentistry|dental|veterinary|clinical)/.test(title)) {
            intlFee = this.ugBands.intlClinical || intlFee;
        } 
        else if (/(science|engineering|physics|chemistry|biology|computing|software|mathematics|anatomy|nursing|aeronautical|aerospace|civil|mechanical)/.test(context)) {
            intlFee = this.ugBands.intlScience || intlFee;
        } 

        return {
            homeFee: this.ugBands.ruk,
            internationalFee: intlFee
        };
    }

    private async loadUgCentralFees() {
        if (DEBUG) Logger.debug(`[DEBUG] Glasgow: Lazy-loading UG central fees...`);
        this.ugBands = { ruk: null, intlArts: null, intlScience: null, intlClinical: null };

        try {
            const rukResponse = await axios.get(this.urls.ugRuk!, { headers: HEADERS_BROWSER });
            const rukText = cheerio.load(rukResponse.data)('body').text().replace(/\s+/g, ' ');
            this.ugBands.ruk = this.extractPriceAfterKeyword(rukText, 'standard', 9000);

            const intlResponse = await axios.get(this.urls.ugIntl!, { headers: HEADERS_BROWSER });
            const intlText = cheerio.load(intlResponse.data)('body').text().replace(/\s+/g, ' ');

            this.ugBands.intlArts = this.extractPriceAfterKeyword(intlText, 'arts', 15000);
            this.ugBands.intlScience = this.extractPriceAfterKeyword(intlText, 'science', 20000);
            this.ugBands.intlClinical = this.extractPriceAfterKeyword(intlText, 'clinical', 40000);

        } catch (error) {
            if (DEBUG) Logger.debug(`[DEBUG] Glasgow: Failed to load central UG fees. ${error}`);
        }
    }

    private extractPriceAfterKeyword(text: string, keyword: string, minExpected: number): number | null {
        const regex = new RegExp(`${keyword}[^£]{0,300}£\\s?([0-9]{1,3}(,[0-9]{3})*)`, 'i');
        const match = text.match(regex);
        if (match && match[1]) {
            const price = parseInt(match[1].replace(/,/g, ''), 10);
            if (price >= minExpected && price < 80000) return price;
        }
        return null;
    }
}