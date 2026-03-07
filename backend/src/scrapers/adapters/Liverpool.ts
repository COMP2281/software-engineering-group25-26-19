// src/scrapers/adapters/Liverpool.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees } from '../interfaces';

const DEBUG = true;

export class LiverpoolAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string): Promise<ScrapedFees> {
        if (DEBUG) console.log(`[DEBUG] Liverpool: Sanitizing trap keywords and part-time fees from HTML...`);
        
        let cleanedHtml = html
            // 1. Mangle trap keywords so the generic scraper doesn't delete the fee containers
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            
            // 2. Erase part-time and year-in-industry fees so the generic scraper's Math.min doesn't grab them
            // This matches "Part-time place, per year - £7,000" and completely removes it
            .replace(/part-?time[^£]{0,80}£\s?[0-9,]+/gi, '')
            .replace(/year in industry[^£]{0,80}£\s?[0-9,]+/gi, '');

        // Pass the sanitized HTML back to the Generic parser
        return super.parseHtml(cleanedHtml);
    }
}