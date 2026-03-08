// src/scrapers/adapters/Liverpool.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapeContext, ScrapedFees } from '../interfaces';
import { Logger } from '../logger';

const DEBUG = true;

export class LiverpoolAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Liverpool: Sanitizing trap keywords...`);
        
        // Only sanitize traps. Study mode conflicts are handled by GenericHtmlAdapter before this is called.
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries');

        return super.parseHtml(cleanedHtml, context, isPdf);
    }
}
