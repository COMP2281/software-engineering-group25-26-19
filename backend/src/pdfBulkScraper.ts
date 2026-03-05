// src/pdfBulkScraper.ts

import axios from 'axios';
import * as stringSimilarity from 'string-similarity';
import prisma from './db';
import { PDFParse } from 'pdf-parse';

// Configuration
const DEBUG = true;

interface ExtractedRow {
    rawName: string;
    homeFee: number | null;
    intlFee: number | null;
}

function debug(msg: string) {
    if (DEBUG) console.log(`[DEBUG] ${msg}`);
}

/**
 * Extracts text from a PDF buffer using the pdf-parse v2 API.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return result.text;
    } finally {
        await parser.destroy();
    }
}

/**
 * Main entry point for the Bulk PDF Scraper
 */
export async function runBulkPdfScraper(universityName: string, pdfUrl: string) {
    console.log(`\n=== Starting Bulk PDF Scraper for: ${universityName} ===`);
    console.log(`PDF URL: ${pdfUrl}`);

    try {
        debug("Downloading PDF...");
        const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        
        debug("Extracting text from PDF...");
        const text = await extractPdfText(buffer);

        debug("Parsing tabular data...");
        const extractedRows = extractTableData(text);
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
        await matchAndUpdateCourses(university.courses, extractedRows);

        console.log("\n=== Bulk PDF Scraper Finished Successfully ===");

    } catch (error) {
        console.error("\n!!! Bulk PDF Scraper Failed !!!");
        console.error(error instanceof Error ? error.message : error);
    }
}

/**
 * Parses the raw PDF text line-by-line to find table rows
 */
function extractTableData(pdfText: string): ExtractedRow[] {
    if (!pdfText) return[];

    const rows: ExtractedRow[] =[];
    const lines = pdfText.split('\n');

    // Regex to find numbers formatted like fees: 9,790 or £20,800 or 24800
    const feeRegex = /£?\s?([1-9]\d{0,2}(?:,\d{3})+|\d{4,5})/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;

        const matches = [...line.matchAll(feeRegex)];

        if (matches.length >= 2) {
            const fees: number[] =[];
            matches.forEach(match => {
                if (match[1]) {
                    const num = parseInt(match[1].replace(/,/g, ''), 10);
                    // Filter out years (like 2026) and tiny numbers (like Scotland's £1820 if we only want RUK/Intl)
                    // We keep 1000+ so we can see the Scottish fee, but we filter it out of the Home fee below
                    if (num > 1000 && num < 80000 && num !== 2026 && num !== 2027) {
                        fees.push(num);
                    }
                }
            });

            if (fees.length >= 2) {
                const firstMatchIndex = matches[0]?.index || 0;
                let rawName = line.substring(0, firstMatchIndex).trim();

                // Clean up common PDF artifacts
                rawName = rawName.replace(/\[\d+\]/g, '').trim(); 
                
                // Determine Home and Intl fees
                // Intl is usually the highest. Home is usually the lowest > 4500 (to ignore Scotland £1820)
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

/**
 * Normalizes course names by stripping faculties, degree prefixes, and punctuation.
 * This ensures "ACCOUNTANCY ARTS & SOCIAL SCIENCES" matches "MA (Hons) Accountancy".
 */
function normalizeForMatch(name: string): string {
    let n = name.toLowerCase();
    
    // 1. Strip Aberdeen's "Area of Study" column if it got merged at the end of the string
    n = n.replace(/\s+(arts & social sciences|arts and social sciences|sciences|engineering|medicine & dentistry|medicine and dentistry|divinity & theology|divinity and theology|education|law|music|medicine)$/i, '');
    
    // 2. Strip common UCAS degree prefixes/suffixes (standalone words only)
    n = n.replace(/\b(ba|bsc|ma|msc|meng|beng|llb|hons|bachelor|master|ug|pg|degree)\b/gi, '');
    
    // 3. Remove punctuation and extra whitespace
    n = n.replace(/[(),\-&]/g, ' ');
    n = n.replace(/\s+/g, ' ').trim();
    
    return n;
}

/**
 * Uses Dice's Coefficient (string-similarity) to map PDF rows to DB courses
 */
async function matchAndUpdateCourses(dbCourses: any[], extractedRows: ExtractedRow[]) {
    let matchCount = 0;
    
    // Pre-calculate normalized names for the database courses
    const normalizedDbCourses = dbCourses.map(c => ({
        original: c,
        normalized: normalizeForMatch(c.title)
    }));
    
    const dbCourseNames = normalizedDbCourses.map(c => c.normalized);

    for (const row of extractedRows) {
        const normalizedRawName = normalizeForMatch(row.rawName);
        
        if (!normalizedRawName) continue;

        // Find the best match using the normalized names
        const matchResult = stringSimilarity.findBestMatch(normalizedRawName, dbCourseNames);
        const bestMatch = matchResult.bestMatch;

        // 0.55 is a good threshold for fuzzy matching
        if (bestMatch.rating > 0.55) {
            const target = normalizedDbCourses.find(c => c.normalized === bestMatch.target);
            
            if (target && target.original) {
                const dbCourse = target.original;
                
                debug(`Matched:[PDF] "${row.rawName}" -> [DB] "${dbCourse.title}" (Score: ${bestMatch.rating.toFixed(2)}) | Home: £${row.homeFee}, Intl: £${row.intlFee}`);
                
                // Update all options for this course in the database
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
        } else {
            // Uncomment to debug poor matches
            // debug(`Poor Match: "${normalizedRawName}" -> Best guess was "${bestMatch.target}" (Score: ${bestMatch.rating.toFixed(2)})`);
        }
    }

    console.log(`Successfully mapped and updated ${matchCount} courses in the database.`);
}

// --- CLI EXECUTION LOGIC ---
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.error("Usage: npx ts-node src/pdfBulkScraper.ts \"University Name\" \"https://link-to-pdf.pdf\"");
        process.exit(1);
    }

    const uniName = args[0]!;
    const pdfUrl = args[1]!;

    runBulkPdfScraper(uniName, pdfUrl)
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}