// src/scrapers/adapters/Exeter.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapeContext, ScrapedFees } from '../interfaces';
import * as cheerio from 'cheerio';

const DEBUG = true;

export class ExeterAdapter extends GenericHtmlAdapter {
    
    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) console.log(`[DEBUG] Exeter: Sanitizing trap keywords...`);
        
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/additional costs?/gi, 'extra expenses');

        const $ = cheerio.load(cleanedHtml);
        const text = $('body').text().replace(/\s+/g, ' ');

        let homeFee: number | null = null;
        let intlFee: number | null = null;

        const homeMatch = text.match(/(?:uk|home)[^£]{0,150}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (homeMatch && homeMatch[1]) {
            const val = parseInt(homeMatch[1].replace(/,/g, ''), 10);
            if (val > 1000 && val < 80000) homeFee = val;
        }

        const intlMatch = text.match(/(?:international|overseas|eu)[^£]{0,150}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
        if (intlMatch && intlMatch[1]) {
            const val = parseInt(intlMatch[1].replace(/,/g, ''), 10);
            if (val > 4500 && val < 80000) intlFee = val;
        }

        if (homeFee && intlFee) {
            return { homeFee, internationalFee: intlFee };
        }

        const genericResult = await super.parseHtml(cleanedHtml, context, isPdf);
        
        return {
            homeFee: homeFee || genericResult.homeFee,
            internationalFee: intlFee || genericResult.internationalFee
        };
    }
}
