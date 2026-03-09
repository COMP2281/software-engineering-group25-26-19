// src/scrapers/adapters/Exeter.ts

import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapeContext, ScrapedFees } from '../interfaces';
import * as cheerio from 'cheerio';
import { Logger } from '../logger';

const DEBUG = true;

interface PriceCandidate {
    val: number;
    homeDist: number;
    intlDist: number;
    hasPT: boolean;
    hasFT: boolean;
    index: number;
}

export class ExeterAdapter extends GenericHtmlAdapter {
    
    // 1. Disable the generic study mode sanitization so we can handle PT/FT explicitly
    protected override sanitizeForStudyMode(html: string, _studyMode: string): string {
        return html;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, _isPdf: boolean): Promise<ScrapedFees> {
        if (DEBUG) Logger.debug(`[DEBUG] Exeter: Merged Strict PT/FT Boundaries with Residency Scoring...`);

        // 2. Basic Trap Sanitization
        let cleanedHtml = html
            .replace(/funding/gi, 'fnding')
            .replace(/scholarships?/gi, 'scholrships')
            .replace(/bursar(y|ies)/gi, 'brsaries')
            .replace(/additional costs?/gi, 'extra expenses');

        const $ = cheerio.load(cleanedHtml);

        // 3. Qualification Pruning (Fixes edge cases with multiple diplomas on one page)
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

        const text = $('body').text().replace(/\s+/g, ' ').toLowerCase();
        const isPT = (context.studyMode || '').toLowerCase().includes('part');

        const regex = /£\s?([0-9]{1,3}(,[0-9]{3})*)/g;
        let match;
        const candidates: PriceCandidate[] =[];

        // 4. Extract Candidates with Strict Boundaries
        while ((match = regex.exec(text)) !== null) {
            if (!match[1]) continue;
            const val = parseInt(match[1].replace(/,/g, ''), 10);
            if (val < 1000 || val > 80000) continue;

            const index = match.index;
            
            // A. Strict PT/FT checking using bounded text (max 40 chars)
            // Split by £, ;, |, \n, and . to prevent boundary bleed between adjacent fees
            const before40 = text.substring(Math.max(0, index - 40), index);
            const after40 = text.substring(index + match[0].length, Math.min(text.length, index + match[0].length + 40));
            
            const boundedBefore = before40.split(/[£;|\n.]/).pop() || '';
            const boundedAfter = after40.split(/[£;|\n.]/)[0] || '';

            const hasPT = /part-?time|pt\b/.test(boundedBefore) || /part-?time|pt\b/.test(boundedAfter);
            const hasFT = /full-?time|ft\b/.test(boundedBefore) || /full-?time|ft\b/.test(boundedAfter);

            // Discard explicitly wrong modes immediately (Only if UNAMBIGUOUS)
            if (isPT && hasFT && !hasPT) continue;
            if (!isPT && hasPT && !hasFT) continue;

            // B. Trap check (placement, deposit)
            const after60 = text.substring(index, Math.min(text.length, index + 60));
            const before200 = text.substring(Math.max(0, index - 200), index);
            if (/(placement|sandwich|industry|abroad|deposit)/.test(after60) || 
                /(placement|sandwich|industry|abroad|deposit)/.test(before200.slice(-50))) {
                continue;
            }

            // C. Residency Scoring (Look backwards for keywords up to 200 chars)
            const getClosestDist = (reg: RegExp) => {
                let m;
                let closest = -1;
                reg.lastIndex = 0;
                while ((m = reg.exec(before200)) !== null) {
                    closest = m.index;
                }
                return closest === -1 ? 9999 : (before200.length - closest);
            };

            const homeDist = getClosestDist(/\b(uk|home)\b/gi);
            const intlDist = getClosestDist(/\b(international|overseas|eu)\b/gi);

            candidates.push({ val, homeDist, intlDist, hasPT, hasFT, index });
        }

        // 5. Group and Select Fees
        let homeFee: number | null = null;
        let intlFee: number | null = null;

        // Group by residency distance
        const homeCands = candidates.filter(c => c.homeDist < c.intlDist || (c.homeDist === 9999 && c.intlDist === 9999));
        const intlCands = candidates.filter(c => c.intlDist < c.homeDist || (c.homeDist === 9999 && c.intlDist === 9999));

        const selectBest = (cands: PriceCandidate[], wantPT: boolean) => {
            if (cands.length === 0) return null;
            
            // If any candidate explicitly and UNAMBIGUOUSLY matches the requested mode, use it
            const explicitMatches = cands.filter(c => wantPT ? (c.hasPT && !c.hasFT) : (c.hasFT && !c.hasPT));
            if (explicitMatches.length > 0) {
                // If multiple explicit matches, use the earliest one
                const sorted = explicitMatches.sort((a, b) => a.index - b.index);
                return sorted[0]?.val ?? null;
            }

            // Fallback: Min/Max logic
            const vals = cands.map(c => c.val);
            return wantPT ? Math.min(...vals) : Math.max(...vals);
        };

        homeFee = selectBest(homeCands, isPT);
        intlFee = selectBest(intlCands, isPT);

        // 6. Unified Fee Fallback (Online Courses)
        if (!homeFee && !intlFee) {
            const unifiedMatch = text.match(/(?:fee|tuition|cost)[^£]{0,60}£\s?([0-9]{1,3}(,[0-9]{3})*)/i);
            if (unifiedMatch && unifiedMatch[1]) {
                const val = parseInt(unifiedMatch[1].replace(/,/g, ''), 10);
                if (val > 1000 && val < 80000) {
                    homeFee = val;
                    intlFee = val;
                }
            }
        }

        if (DEBUG) Logger.debug(`[DEBUG] Exeter Extracted -> Home: £${homeFee}, Intl: £${intlFee}`);
        return { homeFee, internationalFee: intlFee };
    }
}