// src/scrapers/adapters/Imperial.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapeContext, ScrapedFees } from '../interfaces';
import * as cheerio from 'cheerio';
import { Logger } from '../logger';

const DEBUG = true;

export class ImperialAdapter extends GenericHtmlAdapter {
    
    // 1. Disable the generic regex sanitization so we can handle it via DOM pruning
    protected override sanitizeForStudyMode(html: string, _studyMode: string): string {
        return html;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Imperial: Pre-processing DOM for Mode pruning...`);

        // 2. Basic Trap Sanitization
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/additional costs?/gi, 'extra expenses');

        const $ = cheerio.load(cleanedHtml);

        // 3. Study Mode Pruning (Remove HTML elements for the WRONG study mode)
        const mode = (context.studyMode || '').toLowerCase();
        const isPT = mode.includes('part');
        const isFT = mode.includes('full') || !isPT; // Default to FT if not specified

        // We target elements that typically contain a single fee line (rows, lists, paragraphs, small divs)
        $('tr, li, p, div').each((_, el) => {
            const elText = $(el).text().toLowerCase();
            const mentionsPT = elText.includes('part-time') || elText.includes('part time');
            const mentionsFT = elText.includes('full-time') || elText.includes('full time');

            // Guardrail: Only prune if the element is reasonably small. 
            // We don't want to accidentally delete the entire page body!
            if (elText.length < 500) {
                // If we want PT, and this element ONLY mentions FT, delete it.
                if (isPT && mentionsFT && !mentionsPT) {
                    $(el).remove();
                } 
                // If we want FT, and this element ONLY mentions PT, delete it.
                else if (isFT && mentionsPT && !mentionsFT) {
                    $(el).remove();
                }
            }
        });

        // Get the pruned HTML
        const prunedHtml = $.html();

        // 4. Pass to Generic Parser
        // The generic parser will now only see the fees relevant to our specific option,
        // so Math.min and Math.max will work perfectly.
        let result = await super.parseHtml(prunedHtml, context, isPdf);

        // 5. Fallback: Strict Forward Regex
        // If the generic parser still missed it, we use strict forward lookahead.
        if (!result.homeFee || !result.internationalFee) {
            const text = cheerio.load(prunedHtml)('body').text().replace(/\s+/g, ' ').toLowerCase();
            
            if (!result.homeFee) {
                const homeMatch = text.match(/(?:uk|home)[^£]{0,100}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
                if (homeMatch && homeMatch[1]) {
                    const val = parseInt(homeMatch[1].replace(/,/g, ''), 10);
                    if (val > 1000 && val < 80000) result.homeFee = val;
                }
            }

            if (!result.internationalFee) {
                const intlMatch = text.match(/(?:international|overseas|eu)[^£]{0,100}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
                if (intlMatch && intlMatch[1]) {
                    const val = parseInt(intlMatch[1].replace(/,/g, ''), 10);
                    if (val > 4500 && val < 80000) result.internationalFee = val;
                }
            }
        }

        if (DEBUG) Logger.debug(`[DEBUG] Imperial Extracted -> Home: £${result.homeFee}, Intl: £${result.internationalFee}`);
        return result;
    }
}