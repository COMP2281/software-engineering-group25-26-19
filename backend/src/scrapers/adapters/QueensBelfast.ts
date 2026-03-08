// src/scrapers/adapters/QueensBelfast.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees, ScrapeContext } from '../interfaces';
import * as cheerio from 'cheerio';
import { Logger } from '../logger';

const DEBUG = true;

export class QueensBelfastAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Queen's Belfast: Custom parsing for GB fees and PGCerts...`);
        
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries');

        const $ = cheerio.load(cleanedHtml);
        const text = $('body').text().replace(/\s+/g, ' ');

        let homeFee: number | null = null;
        let intlFee: number | null = null;

        // 1. Target the GB (Great Britain) fee specifically, ignoring NI/ROI
        const gbMatch = text.match(/(?:England, Scotland or Wales|GB)[^£]{0,100}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (gbMatch && gbMatch[1]) {
            const val = parseInt(gbMatch[1].replace(/,/g, ''), 10);
            if (val > 1000 && val < 80000) homeFee = val;
        }

        // 2. Target the International fee
        const intlMatch = text.match(/(?:international|overseas)[^£]{0,150}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (intlMatch && intlMatch[1]) {
            const val = parseInt(intlMatch[1].replace(/,/g, ''), 10);
            if (val > 2000 && val < 80000) intlFee = val;
        }

        // 3. Fallback to Generic Parser if we missed anything
        if (!homeFee || !intlFee) {
            if (DEBUG) Logger.debug(`[DEBUG] QUB: Missing some fees, falling back to generic parser.`);
            
            // Erase the NI and ROI fees from the HTML so Math.min() doesn't grab them.
            cleanedHtml = cleanedHtml
                .replace(/(Northern Ireland|Republic of Ireland|NI|ROI)[^£]{0,50}£\s?[0-9,]+/gi, '');

            const genericResult = await super.parseHtml(cleanedHtml, context, isPdf);
            
            homeFee = homeFee || genericResult.homeFee;
            intlFee = intlFee || genericResult.internationalFee;
        }

        // --- LOCALIZED SANITY CHECK ---
        // If the fees are identical (or Home is somehow higher), it's highly likely the 
        // scraper grabbed the International fee twice because we erased the NI/ROI fees.
        // We discard the Home fee to be safe.
        if (homeFee && intlFee && homeFee >= intlFee) {
            if (DEBUG) Logger.debug(`[DEBUG] QUB: Sanity Check Failed - Home (£${homeFee}) >= Intl (£${intlFee}). Discarding Home fee.`);
            homeFee = null;
        }

        if (DEBUG) Logger.debug(`[DEBUG] QUB: Final Extracted -> GB Home: £${homeFee}, Intl: £${intlFee}`);
        
        return {
            homeFee: homeFee,
            internationalFee: intlFee
        };
    }
}