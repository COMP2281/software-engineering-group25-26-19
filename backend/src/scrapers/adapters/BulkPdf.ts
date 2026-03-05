// src/scrapers/adapters/BulkPdf.ts

import axios from 'axios';
import * as stringSimilarity from 'string-similarity';
import prisma from '../../db';
import { PDFParse } from 'pdf-parse';
import { IScraperAdapter } from '../interfaces';

const DEBUG = true;

interface ExtractedRow {
    rawName: string;
    homeFee: number | null;
    intlFee: number | null;
}

function debug(msg: string) {
    if (DEBUG) console.log(`[DEBUG] ${msg}`);
}

export class BulkPdfAdapter implements IScraperAdapter {
    
    async scrapeBulk(universityName: string, bulkUrl: string): Promise<void> {
        console.log(`\n=== Running Bulk PDF Adapter for: ${universityName} ===`);
        console.log(`PDF URL: ${bulkUrl}`);

        try {
            debug("Downloading PDF...");
            const response = await axios.get(bulkUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);
            
            debug("Extracting text from PDF...");
            const text = await this.extractPdfText(buffer);

            debug("Parsing tabular data...");
            const extractedRows = this.extractTableData(text);
            console.log(`Extracted ${extractedRows.length} potential course rows from the PDF.`);

            if (extractedRows.length === 0) {
                console.log("No data extracted. The PDF might not be formatted as a standard text table.");
                return;
            }

            debug("Fetching courses from database...");
            const university = await prisma.university.findFirst({
                where: { name: { contains: universityName, mode: 'insensitive' } },
                include: { courses: { include: { options: true } } }
            });

            if (!university || university.courses.length === 0) {
                console.error(`No courses found in the database for university: ${universityName}`);
                return;
            }

            debug("Starting fuzzy matching and database updates...");
            await this.matchAndUpdateCourses(university.courses, extractedRows);

            console.log("=== Bulk PDF Adapter Finished Successfully ===\n");

        } catch (error) {
            console.error("!!! Bulk PDF Adapter Failed !!!");
            console.error(error instanceof Error ? error.message : error);
        }
    }

    private async extractPdfText(buffer: Buffer): Promise<string> {
        const parser = new PDFParse({ data: buffer });
        try {
            const result = await parser.getText();
            return result.text;
        } finally {
            await parser.destroy();
        }
    }

    private extractTableData(pdfText: string): ExtractedRow[] {
        if (!pdfText) return [];

        const rows: ExtractedRow[] =[];
        const lines = pdfText.split('\n');
        const feeRegex = /£?\s?([1-9]\d{0,2}(?:,\d{3})+|\d{4,5})/g;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]?.trim();
            if (!line) continue;

            const matches =[...line.matchAll(feeRegex)];

            if (matches.length >= 2) {
                const fees: number[] =[];
                matches.forEach(match => {
                    if (match[1]) {
                        const num = parseInt(match[1].replace(/,/g, ''), 10);
                        if (num > 1000 && num < 80000 && num !== 2026 && num !== 2027) {
                            fees.push(num);
                        }
                    }
                });

                if (fees.length >= 2) {
                    const firstMatchIndex = matches[0]?.index || 0;
                    let rawName = line.substring(0, firstMatchIndex).trim();
                    rawName = rawName.replace(/\[\d+\]/g, '').trim(); 
                    
                    const intlFee = Math.max(...fees);
                    const homeCandidates = fees.filter(f => f >= 4500 && f < intlFee);
                    const homeFee = homeCandidates.length > 0 ? Math.min(...homeCandidates) : null;

                    if (rawName && intlFee) {
                        rows.push({ rawName, homeFee, intlFee });
                    }
                }
            }
        }
        return rows;
    }

    private normalizeForMatch(name: string): string {
        let n = name.toLowerCase();
        n = n.replace(/\s+(arts & social sciences|arts and social sciences|sciences|engineering|medicine & dentistry|medicine and dentistry|divinity & theology|divinity and theology|education|law|music|medicine)$/i, '');
        n = n.replace(/\b(ba|bsc|ma|msc|meng|beng|llb|hons|bachelor|master|ug|pg|degree)\b/gi, '');
        n = n.replace(/[(),\-&]/g, ' ');
        n = n.replace(/\s+/g, ' ').trim();
        return n;
    }

    private async matchAndUpdateCourses(dbCourses: any[], extractedRows: ExtractedRow[]) {
        let matchCount = 0;
        
        const normalizedDbCourses = dbCourses.map(c => ({
            original: c,
            normalized: this.normalizeForMatch(c.title)
        }));
        
        const dbCourseNames = normalizedDbCourses.map(c => c.normalized);

        for (const row of extractedRows) {
            const normalizedRawName = this.normalizeForMatch(row.rawName);
            if (!normalizedRawName) continue;

            const matchResult = stringSimilarity.findBestMatch(normalizedRawName, dbCourseNames);
            const bestMatch = matchResult.bestMatch;

            if (bestMatch.rating > 0.55) {
                const target = normalizedDbCourses.find(c => c.normalized === bestMatch.target);
                
                if (target && target.original) {
                    const dbCourse = target.original;
                    debug(`Matched:[PDF] "${row.rawName}" -> [DB] "${dbCourse.title}" (Score: ${bestMatch.rating.toFixed(2)})`);
                    
                    for (const option of dbCourse.options) {
                        await prisma.courseOption.update({
                            where: { id: option.id },
                            data: {
                                homeFee: row.homeFee || option.homeFee,
                                internationalFee: row.intlFee || option.internationalFee
                            }
                        });
                    }
                    matchCount++;
                }
            }
        }
        console.log(`Successfully mapped and updated ${matchCount} courses in the database.`);
    }
}