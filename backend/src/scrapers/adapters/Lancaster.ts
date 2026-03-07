// src/scrapers/adapters/Lancaster.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees } from '../interfaces';
import * as cheerio from 'cheerio';

const DEBUG = true;

export class LancasterAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string): Promise<ScrapedFees> {
        if (DEBUG) console.log(`[DEBUG] Lancaster: Custom parsing and sanitizing...`);
        
        const $ = cheerio.load(html);
        const text = $('body').text().replace(/\s+/g, ' ');
        
        let homeFee: number | null = null;
        let intlFee: number | null = null;

        // --- 1. CUSTOM REGEX EXTRACTION ---
        // We first try to extract the fees ourselves using highly targeted rules.
        
        // Create a temporary text block with part-time fees removed to avoid false positives
        const ftText = text.replace(/part-?time[^£]{0,80}£\s?[0-9,]+/gi, '');

        // Look for International / Overseas
        const intlMatch = ftText.match(/(?:international|overseas)[^£]{0,80}£\s?([0-9]{2,3}(,[0-9]{3})*)/i);
        if (intlMatch && intlMatch[1]) {
            const val = parseInt(intlMatch[1].replace(/,/g, ''), 10);
            if (val > 4500 && val < 80000) intlFee = val;
        }

        // Look for Home / UK
        const homeMatch = ftText.match(/(?:home|uk)[^£]{0,80}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (homeMatch && homeMatch[1]) {
            const val = parseInt(homeMatch[1].replace(/,/g, ''), 10);
            if (val > 1000 && val < 80000) homeFee = val;
        }

        // EDGE CASE: PhDs often reference the UKRI rate for Home students instead of saying "Home"
        if (!homeFee) {
            const ukriMatch = text.match(/UKRI[^£]{0,80}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
            if (ukriMatch && ukriMatch[1]) {
                const val = parseInt(ukriMatch[1].replace(/,/g, ''), 10);
                if (val > 1000 && val < 80000) {
                    homeFee = val;
                    if (DEBUG) console.log(`[DEBUG] Lancaster: Found UKRI rate for Home fee (£${homeFee}).`);
                }
            }
        }

        // If we found both fees using our custom logic, we can skip the generic parser entirely!
        if (homeFee && intlFee) {
            if (DEBUG) console.log(`[DEBUG] Lancaster: Successfully extracted both fees via custom regex.`);
            return { homeFee, internationalFee: intlFee };
        }

        // --- 2. FALLBACK TO GENERIC PARSER ---
        if (DEBUG) console.log(`[DEBUG] Lancaster: Missing some fees. Falling back to sanitized generic parser.`);
        
        let cleanedHtml = html
            // Mangle trap keywords so the generic scraper doesn't delete the fee containers
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/additional costs?/gi, 'extra expenses')
            // CRITICAL: Erase part-time fees from the HTML so the generic scraper's Math.min doesn't grab them
            .replace(/part-?time[^£]{0,80}£\s?[0-9,]+/gi, '');

        // Pass the sanitized HTML to the generic parser
        const genericResult = await super.parseHtml(cleanedHtml);
        
        // Merge our custom findings with whatever the generic parser managed to find
        return {
            homeFee: homeFee || genericResult.homeFee,
            internationalFee: intlFee || genericResult.internationalFee
        };
    }
}