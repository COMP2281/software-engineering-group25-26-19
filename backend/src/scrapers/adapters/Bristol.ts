// src/scrapers/adapters/Bristol.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees, ScrapeContext } from '../interfaces';
import * as cheerio from 'cheerio';
import { Logger } from '../logger';

const DEBUG = true;

export class BristolAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Bristol: Custom parsing and sanitizing...`);
        
        // 1. Sanitize Trap Keywords
        // Bristol uses "Fees and funding", so we mangle "funding" to prevent DOM deletion.
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries');

        // 2. Custom Extraction Logic
        // Note: The HTML has ALREADY been sanitized for study mode by GenericHtmlAdapter.
        // Conflicting part-time/full-time fees have been erased from the text.
        const $ = cheerio.load(cleanedHtml);
        const text = $('body').text().replace(/\s+/g, ' ');
        
        let homeFee: number | null = null;
        let intlFee: number | null = null;

        // Forward-looking regexes (Label -> Price)
        const homeFwd = text.match(/(?:home|uk)[^£]{0,60}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        const intlFwd = text.match(/(?:international|overseas)[^£]{0,60}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);

        // Backward-looking regexes (Price -> Label) (For UG format: "£28,200 per year, international students")
        const homeBwd = text.match(/£\s?([0-9]{1,3}(,[0-9]{3})*)[^£]{0,60}(?:home|uk)/i);
        const intlBwd = text.match(/£\s?([0-9]{1,3}(,[0-9]{3})*)[^£]{0,60}(?:international|overseas)/i);

        // Assign Home Fee
        if (homeFwd && homeFwd[1]) homeFee = parseInt(homeFwd[1].replace(/,/g, ''), 10);
        else if (homeBwd && homeBwd[1]) homeFee = parseInt(homeBwd[1].replace(/,/g, ''), 10);

        // Assign Intl Fee
        if (intlFwd && intlFwd[1]) intlFee = parseInt(intlFwd[1].replace(/,/g, ''), 10);
        else if (intlBwd && intlBwd[1]) intlFee = parseInt(intlBwd[1].replace(/,/g, ''), 10);

        // Filter out invalid numbers
        if (homeFee && (homeFee < 1000 || homeFee > 80000)) homeFee = null;
        if (intlFee && (intlFee < 4500 || intlFee > 80000)) intlFee = null;

        if (homeFee && intlFee) {
            if (DEBUG) Logger.debug(`[DEBUG] Bristol: Extracted via custom regex -> Home: £${homeFee}, Intl: £${intlFee}`);
            return { homeFee, internationalFee: intlFee };
        }

        // 3. Ultimate Fallback to Generic Parser
        if (DEBUG) Logger.debug(`[DEBUG] Bristol: Missing some fees, falling back to generic parser.`);
        const genericResult = await super.parseHtml(cleanedHtml, context, isPdf);
        
        return {
            homeFee: homeFee || genericResult.homeFee,
            internationalFee: intlFee || genericResult.internationalFee
        };
    }
}