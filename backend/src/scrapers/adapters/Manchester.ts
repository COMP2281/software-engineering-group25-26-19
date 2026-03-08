// src/scrapers/adapters/Manchester.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees, ScrapeContext } from '../interfaces';
import * as cheerio from 'cheerio';

const DEBUG = true;

export class ManchesterAdapter extends GenericHtmlAdapter {
    
    // UPDATED SIGNATURE: Accepts context
    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) console.log(`[DEBUG] Manchester: Sanitizing trap keywords...`);
        
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/additional costs?/gi, 'extra expenses')
            
            // Remove "Year Abroad" and "Placement" fees (Crucial for Manchester UG)
            .replace(/year abroad[^£]{0,100}£\s?[0-9,]+/gi, '')
            .replace(/placement[^£]{0,100}£\s?[0-9,]+/gi, '')
            .replace(/reduced fee[^£]{0,100}£\s?[0-9,]+/gi, '');

        // --- DYNAMIC SANITIZATION ---
        // Manchester specific: If we want Part-time, remove Full-time block.
        // If we want Full-time, remove Part-time block.
        const mode = (context.studyMode || '').toLowerCase();
        if (mode.includes('part')) {
            // Remove Full-time fees to prevent directional regex from grabbing them
            cleanedHtml = cleanedHtml.replace(/full-?time[^£]{0,200}£\s?[0-9,]+/gi, '');
        } else {
            // Remove Part-time fees
            cleanedHtml = cleanedHtml.replace(/part-?time[^£]{0,200}£\s?[0-9,]+/gi, '');
        }

        // --- CUSTOM DIRECTIONAL REGEX EXTRACTION ---
        const $ = cheerio.load(cleanedHtml);
        const text = $('body').text().replace(/\s+/g, ' ');

        let homeFee: number | null = null;
        let intlFee: number | null = null;

        const homeMatch = text.match(/(?:uk|home)[^£]{0,120}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (homeMatch && homeMatch[1]) {
            const val = parseInt(homeMatch[1].replace(/,/g, ''), 10);
            if (val > 1000 && val < 80000) homeFee = val;
        }

        const intlMatch = text.match(/(?:international|overseas)[^£]{0,120}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (intlMatch && intlMatch[1]) {
            const val = parseInt(intlMatch[1].replace(/,/g, ''), 10);
            if (val > 4500 && val < 80000) intlFee = val;
        }

        if (homeFee && intlFee) {
            return { homeFee, internationalFee: intlFee };
        }

        // Fallback to Generic Parser (which will use the already sanitized HTML)
        const genericResult = await super.parseHtml(cleanedHtml, context, isPdf);
        
        return {
            homeFee: homeFee || genericResult.homeFee,
            internationalFee: intlFee || genericResult.internationalFee
        };
    }
}