// src/scrapers/adapters/Loughborough.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees } from '../interfaces';

const DEBUG = true;

export class LoughboroughAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) console.log(`[DEBUG] Loughborough: Sanitizing trap keywords...`);
        
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/financial support/gi, 'fin support')
            .replace(/additional costs?/gi, 'extra expenses');

        return super.parseHtml(cleanedHtml, isPdf);
    }
}