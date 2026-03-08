// src/scrapers/adapters/Lancaster.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapeContext, ScrapedFees } from '../interfaces';
import * as cheerio from 'cheerio';
import { Logger } from '../logger';

const DEBUG = true;

export class LancasterAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Lancaster: Custom parsing and sanitizing...`);
        
        // 1. Sanitize Trap Keywords
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/additional costs?/gi, 'extra expenses');

        // 2. Custom Extraction Logic (UKRI check)
        const $ = cheerio.load(cleanedHtml);
        const text = $('body').text().replace(/\s+/g, ' ');
        
        let homeFee: number | null = null;
        let intlFee: number | null = null;

        // Custom Regex (relying on the fact that GenericHtml has already filtered out conflicting study modes)
        const intlMatch = text.match(/(?:international|overseas)[^£]{0,80}£\s?([0-9]{2,3}(,[0-9]{3})*)/i);
        if (intlMatch && intlMatch[1]) {
            const val = parseInt(intlMatch[1].replace(/,/g, ''), 10);
            if (val > 4500 && val < 80000) intlFee = val;
        }

        const homeMatch = text.match(/(?:home|uk)[^£]{0,80}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (homeMatch && homeMatch[1]) {
            const val = parseInt(homeMatch[1].replace(/,/g, ''), 10);
            if (val > 1000 && val < 80000) homeFee = val;
        }

        // UKRI Edge Case for PhDs
        if (!homeFee) {
            const ukriMatch = text.match(/UKRI[^£]{0,80}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
            if (ukriMatch && ukriMatch[1]) {
                const val = parseInt(ukriMatch[1].replace(/,/g, ''), 10);
                if (val > 1000 && val < 80000) homeFee = val;
            }
        }

        if (homeFee && intlFee) {
            return { homeFee, internationalFee: intlFee };
        }

        // 3. Fallback to Generic Parser
        const genericResult = await super.parseHtml(cleanedHtml, context, isPdf);
        
        return {
            homeFee: homeFee || genericResult.homeFee,
            internationalFee: intlFee || genericResult.internationalFee
        };
    }
}
