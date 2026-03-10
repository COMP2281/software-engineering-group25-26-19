// src/scrapers/adapters/Lancaster.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapeContext, ScrapedFees } from '../interfaces';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { Logger } from '../logger';

const DEBUG = true;

export class LancasterAdapter extends GenericHtmlAdapter {
    
    // 1. Disable the generic study mode sanitization so we can handle PT/FT explicitly via DOM pruning
    protected override sanitizeForStudyMode(html: string, _studyMode: string): string {
        return html;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Lancaster: Custom DOM pruning and sanitizing...`);

        // 2. Basic Trap Sanitization
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/additional costs?/gi, 'extra expenses');

        // If the course IS a placement course, mangle 'placement' so it doesn't trigger the generic trap filters
        if ((context.courseTitle || '').toLowerCase().includes('placement')) {
            cleanedHtml = cleanedHtml.replace(/placement/gi, 'plcement');
        }

        const $ = cheerio.load(cleanedHtml);

        const mode = (context.studyMode || '').toLowerCase();
        const isPT = mode.includes('part');
        const isFT = mode.includes('full') || !isPT;

        // 3. Table Normalization (CRITICAL FIX)
        // Lancaster often uses <th> for row headers in the <tbody>. 
        // This misaligns the index for the GenericHtmlAdapter. We convert them to <td>.
        $('tbody tr').each((_, tr) => {
            $(tr).find('th').each((_, th) => {
                th.tagName = 'td';
            });
        });

        // 4. Dual-Strategy Table Pruning (Column vs Row)
        $('table').each((_, table) => {
            const $table = $(table);
            let ftColIdx = -1;
            let ptColIdx = -1;

            // Check if FT and PT are Column Headers (i.e., they exist in the SAME row)
            $table.find('tr').each((_, tr) => {
                let tempFt = -1;
                let tempPt = -1;
                $(tr).find('th, td').each((i, el) => {
                    const text = $(el).text().toLowerCase();
                    if (text.includes('full time') || text.includes('full-time')) tempFt = i;
                    if (text.includes('part time') || text.includes('part-time')) tempPt = i;
                });
                
                if (tempFt !== -1 && tempPt !== -1 && tempFt !== tempPt) {
                    ftColIdx = tempFt;
                    ptColIdx = tempPt;
                    return false; // Break loop, we found column headers
                }
                return true;
            });

            if (ftColIdx !== -1 && ptColIdx !== -1) {
                // STRATEGY A: Column Pruning
                $table.find('tr').each((_, tr) => {
                    const cells = $(tr).find('th, td');
                    const cellsToRemove: Element[] = []; 
                    
                    if (isPT && cells[ftColIdx]) cellsToRemove.push(cells[ftColIdx] as Element);
                    if (isFT && cells[ptColIdx]) cellsToRemove.push(cells[ptColIdx] as Element);
                    
                    if (cellsToRemove.length > 0) $(cellsToRemove).remove();
                });
            } else {
                // STRATEGY B: Row Pruning
                $table.find('tr').each((_, tr) => {
                    const rowText = $(tr).text().toLowerCase();
                    const mentionsPT = rowText.includes('part-time') || rowText.includes('part time');
                    const mentionsFT = rowText.includes('full-time') || rowText.includes('full time');
                    
                    // Delete the row if it explicitly mentions the wrong mode
                    if (isPT && mentionsFT && !mentionsPT) $(tr).remove();
                    if (isFT && mentionsPT && !mentionsFT) $(tr).remove();
                });
            }
        });

        // 5. List/Paragraph Pruning
        $('li, p').each((_, el) => {
            const elText = $(el).text().toLowerCase();
            const mentionsPT = elText.includes('part-time') || elText.includes('part time');
            const mentionsFT = elText.includes('full-time') || elText.includes('full time');
            
            if (isPT && mentionsFT && !mentionsPT) $(el).remove();
            if (isFT && mentionsPT && !mentionsFT) $(el).remove();
        });

        // 6. Qualification Pruning (Fixes edge cases with multiple diplomas on one page)
        const title = (context.courseTitle || '').toLowerCase();
        const quals =[
            { id: 'msc', regex: /\bmsc\b/i },
            { id: 'ma', regex: /\bma\b/i },
            { id: 'pgcert', regex: /\b(pgcert|pg cert|certificate)\b/i },
            { id: 'pgdip', regex: /\b(pgdip|pg dip|diploma)\b/i },
            { id: 'mphil', regex: /\bmphil\b/i },
            { id: 'phd', regex: /\bphd\b/i }
        ];
        const reqQual = quals.find(q => q.regex.test(title));

        if (reqQual) {
            $('tr, li, p').each((_, el) => {
                const elText = $(el).text().toLowerCase();
                let hasOtherQual = false;
                let hasReqQual = reqQual.regex.test(elText);

                for (const q of quals) {
                    if (q.id !== reqQual.id && q.regex.test(elText)) {
                        hasOtherQual = true;
                        break;
                    }
                }

                // If this element mentions a different qualification, but NOT ours, delete it.
                if (hasOtherQual && !hasReqQual) {
                    $(el).remove();
                }
            });
        }

        // 7. Handle UKRI Edge Case
        // Replace "UK Research Councils" or "UKRI" with "UK" so the generic parser catches it as a Home fee
        let processedHtml = $.html();
        processedHtml = processedHtml.replace(/\b(uk research councils|ukri)\b/gi, 'UK');

        // 8. Pass the perfectly pruned and normalized HTML to the Generic Parser
        return super.parseHtml(processedHtml, context, isPdf);
    }
}