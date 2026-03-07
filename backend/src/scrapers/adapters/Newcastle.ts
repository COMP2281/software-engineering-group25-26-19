// src/scrapers/adapters/Newcastle.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees } from '../interfaces';
import * as cheerio from 'cheerio';

const DEBUG = true;

export class NewcastleAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string): Promise<ScrapedFees> {
        if (DEBUG) console.log(`[DEBUG] Newcastle: Sanitizing trap keywords and edge-case fees from HTML...`);
        
        let cleanedHtml = html
            // 1. Mangle trap keywords so the generic scraper doesn't delete the fee containers
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/additional costs?/gi, 'extra expenses')
            
            // 2. Erase part-time and placement fees
            .replace(/part-?time[^£]{0,80}£\s?[0-9,]+/gi, '')
            .replace(/placement[^£]{0,80}£\s?[0-9,]+/gi, '')
            .replace(/study abroad[^£]{0,80}£\s?[0-9,]+/gi, '');

        // --- 3. CUSTOM DIRECTIONAL REGEX EXTRACTION ---
        const $ = cheerio.load(cleanedHtml);
        const text = $('body').text().replace(/\s+/g, ' ');

        let homeFee: number | null = null;
        let intlFee: number | null = null;

        // Look forward from UK/Home up to 150 characters
        const homeMatch = text.match(/(?:uk|home)[^£]{0,150}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (homeMatch && homeMatch[1]) {
            const val = parseInt(homeMatch[1].replace(/,/g, ''), 10);
            if (val > 1000 && val < 80000) homeFee = val;
        }

        // Look forward from International/Overseas/EU up to 150 characters
        const intlMatch = text.match(/(?:international|overseas|eu)[^£]{0,150}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (intlMatch && intlMatch[1]) {
            const val = parseInt(intlMatch[1].replace(/,/g, ''), 10);
            if (val > 4500 && val < 80000) intlFee = val;
        }

        // If we successfully found both fees, return them immediately
        if (homeFee && intlFee) {
            if (DEBUG) console.log(`[DEBUG] Newcastle: Extracted via directional regex -> Home: £${homeFee}, Intl: £${intlFee}`);
            return { homeFee, internationalFee: intlFee };
        }

        // --- 4. FALLBACK TO GENERIC PARSER ---
        if (DEBUG) console.log(`[DEBUG] Newcastle: Missing fees, falling back to generic parser.`);
        const genericResult = await super.parseHtml(cleanedHtml);
        
        return {
            homeFee: homeFee || genericResult.homeFee,
            internationalFee: intlFee || genericResult.internationalFee
        };
    }
}