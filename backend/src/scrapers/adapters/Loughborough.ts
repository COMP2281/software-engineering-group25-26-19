// src/scrapers/adapters/Loughborough.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees } from '../interfaces';

const DEBUG = true;

export class LoughboroughAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string): Promise<ScrapedFees> {
        if (DEBUG) console.log(`[DEBUG] Loughborough: Sanitizing trap keywords and placement fees from HTML...`);
        
        let cleanedHtml = html
            // 1. Mangle trap keywords so the generic scraper doesn't delete the fee containers
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/financial support/gi, 'fin support')
            .replace(/additional costs?/gi, 'extra expenses')
            
            // 2. Erase part-time, placement, and sandwich year fees so Math.min doesn't grab them
            // Matches e.g., "Placement year: £1,850" or "Part-time fee: £4,625"
            .replace(/part-?time[^£]{0,80}£\s?[0-9,]+/gi, '')
            .replace(/placement year[^£]{0,80}£\s?[0-9,]+/gi, '')
            .replace(/sandwich year[^£]{0,80}£\s?[0-9,]+/gi, '')
            .replace(/placement[^£]{0,80}£\s?[0-9,]+/gi, '');

        // Pass the sanitized HTML back to the Generic parser
        return super.parseHtml(cleanedHtml);
    }
}