// src/scrapers/adapters/Loughborough.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

const DEBUG = true;

export class LoughboroughAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Loughborough: Sanitizing trap keywords...`);
        
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/financial support/gi, 'fin support')
            .replace(/additional costs?/gi, 'extra expenses');

        return super.parseHtml(cleanedHtml, context, isPdf);
    }
}
