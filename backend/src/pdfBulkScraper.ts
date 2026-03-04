// src/pdfBulkScraper.ts

import axios from 'axios';
import * as stringSimilarity from 'string-similarity';
import prisma from './db';
import { PDFParse } from 'pdf-parse'; // Official v2 Import

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
    // Initialize the v2 parser class with the buffer data
    const parser = new PDFParse({ data: buffer });
    
    try {
        // Extract the text
        const result = await parser.getText();
        return result.text;
    } finally {
        // Always destroy the parser instance to free up memory
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
        // 1. Download and Parse PDF
        debug("Downloading PDF...");
        const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        
        debug("Extracting text from PDF...");
        const text = await extractPdfText(buffer);

        // 2. Extract Tabular Data
        debug("Parsing tabular data...");
        const extractedRows = extractTableData(text);
        console.log(`Extracted ${extractedRows.length} potential course rows from the PDF.`);

        if (extractedRows.length === 0) {
            console.log("No data extracted. The PDF might not be formatted as a standard text table.");
            return;
        }

        // 3. Fetch Database Courses for this University
        debug("Fetching courses from database...");
        const university = await prisma.university.findFirst({
            where: { name: { contains: universityName, mode: 'insensitive' } },
            include: { courses: { include: { options: true } } }
        });

        if (!university || university.courses.length === 0) {
            console.error(`No courses found in the database for university: ${universityName}`);
            return;
        }

        // 4. Fuzzy Match and Update
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
    if (!pdfText) return [];

    const rows: ExtractedRow[] =[];
    const lines = pdfText.split('\n');

    // Regex to find numbers formatted like fees: 9,790 or £20,800 or 24800
    const feeRegex = /£?\s?([1-9]\d{0,2}(?:,\d{3})+|\d{4,5})/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;

        // Find all fee-like numbers in the line
        const matches = [...line.matchAll(feeRegex)];

        // If a line has 2 or more fee-like numbers, it's almost certainly a table row
        if (matches.length >= 2) {
            const fees: number[] =[];
            matches.forEach(match => {
                if (match[1]) {
                    const num = parseInt(match[1].replace(/,/g, ''), 10);
                    // Filter out years (like 2026) and tiny numbers
                    if (num > 1000 && num < 80000 && num !== 2026 && num !== 2027) {
                        fees.push(num);
                    }
                }
            });

            if (fees.length >= 2) {
                // Extract the text BEFORE the first number match
                const firstMatchIndex = matches[0]?.index || 0;
                let rawName = line.substring(0, firstMatchIndex).trim();

                // Clean up common PDF artifacts (e.g., "[1]", "ARTS & SOCIAL SCIENCES")
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
 * Uses Dice's Coefficient (string-similarity) to map PDF rows to DB courses
 */
async function matchAndUpdateCourses(dbCourses: any[], extractedRows: ExtractedRow[]) {
    let matchCount = 0;
    const dbCourseNames = dbCourses.map(c => c.title);

    for (const row of extractedRows) {
        // Find the best match in the database for the extracted PDF row name
        const matchResult = stringSimilarity.findBestMatch(row.rawName, dbCourseNames);
        const bestMatch = matchResult.bestMatch;

        // A rating of 0.55 is a good threshold for fuzzy matching course names
        if (bestMatch.rating > 0.55) {
            const targetDbCourse = dbCourses.find(c => c.title === bestMatch.target);
            
            if (targetDbCourse) {
                debug(`Matched: "${row.rawName}" -> "${targetDbCourse.title}" (Score: ${bestMatch.rating.toFixed(2)}) | Home: £${row.homeFee}, Intl: £${row.intlFee}`);
                
                // Update all options for this course in the database
                for (const option of targetDbCourse.options) {
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