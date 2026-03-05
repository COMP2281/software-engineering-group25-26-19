// src/scrapers/manager.ts

import prisma from '../db';
import { ScraperConfig } from './config';
import { IScraperAdapter, ScrapedFees, UniversityScraperConfig } from './interfaces';
import { GenericHtmlAdapter } from './adapters/GenericHtml';
import { BulkPdfAdapter } from './adapters/BulkPdf';
import { BathAdapter } from './adapters/Bath';
import { BirminghamAdapter } from './adapters/Birmingham';

/**
 * Factory function to instantiate the correct adapter.
 * Takes the full config object so adapters can access custom URLs.
 */
function getAdapter(config: UniversityScraperConfig): IScraperAdapter {
    switch (config.adapterName) {
        case 'BulkPdfAdapter': 
            return new BulkPdfAdapter();
        case 'BathAdapter': 
            // Pass the centralFeeUrls object to the Bath adapter
            return new BathAdapter(config.centralFeeUrls!);
        case 'BirminghamAdapter':
            return new BirminghamAdapter();
        case 'GenericHtmlAdapter': 
            return new GenericHtmlAdapter();
        // case 'CardiffAdapter': 
        //     return new CardiffAdapter(); 
        default:
            console.warn(`[WARNING] Adapter ${config.adapterName} not implemented yet. Falling back to Generic.`);
            return new GenericHtmlAdapter();
    }
}

/**
 * Main Orchestrator Function
 */
async function runScrapingManager() {
    console.log("\n=== Starting Scraper Manager ===");

    let unis: string[] = [];
    let courses: string[] =[];

    // Parse command line arguments safely
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;

        if (arg.startsWith('--uni=')) {
            unis = arg.substring(6).split(',').map(s => s.trim()).filter(Boolean);
        } else if (arg === '--uni' && i + 1 < args.length) {
            const nextArg = args[i + 1];
            if (nextArg) {
                unis = nextArg.split(',').map(s => s.trim()).filter(Boolean);
                i++;
            }
        } else if (arg.startsWith('--course=')) {
            courses = arg.substring(9).split(',').map(s => s.trim()).filter(Boolean);
        } else if (arg === '--course' && i + 1 < args.length) {
            const nextArg = args[i + 1];
            if (nextArg) {
                courses = nextArg.split(',').map(s => s.trim()).filter(Boolean);
                i++;
            }
        }
    }

    // Validation
    if (unis.length > 0 && courses.length > 0) {
        console.error("\n[ERROR] You cannot specify both --uni and --course parameters at the same time.");
        process.exit(1);
    }

    // 1. Fetch Target Data from DB
    let universitiesData: any[] =[];

    if (courses.length > 0) {
        console.log(`Targeting specific courses: ${courses.join(', ')}`);
        const dbCourses = await prisma.course.findMany({
            where: { id: { in: courses } },
            include: { university: true, options: true }
        });
        
        const uniMap = new Map<string, any>();
        for (const c of dbCourses) {
            if (!uniMap.has(c.universityId)) {
                uniMap.set(c.universityId, { ...c.university, courses:[] });
            }
            uniMap.get(c.universityId).courses.push(c);
        }
        universitiesData = Array.from(uniMap.values());

    } else {
        const whereClause = unis.length > 0 
            ? { OR: unis.map(u => ({ name: { contains: u, mode: 'insensitive' as const } })) }
            : {};

        if (unis.length > 0) console.log(`Targeting universities: ${unis.join(', ')}`);
        else console.log(`Targeting ALL universities with missing fees.`);

        universitiesData = await prisma.university.findMany({
            where: whereClause,
            include: {
                courses: {
                    where: {
                        options: { some: { OR: [{ homeFee: null }, { internationalFee: null }] } }
                    },
                    include: { options: true }
                }
            }
        });
    }

    if (universitiesData.length === 0) {
        console.log("No targets found in the database requiring scraping. Exiting.");
        return;
    }

    // 2. Process each university according to its configured strategy
    for (const uni of universitiesData) {
        if (!uni.courses || uni.courses.length === 0) continue;

        console.log(`\n--- Processing: ${uni.name} (${uni.courses.length} target courses) ---`);

        const config = ScraperConfig[uni.name] || {
            strategy: 'GENERIC_HTML',
            adapterName: 'GenericHtmlAdapter'
        };

        if (courses.length > 0 && config.strategy === 'BULK_PDF') {
            console.log(`[INFO] Overriding BULK_PDF strategy to GENERIC_HTML because specific courses were requested.`);
            config.strategy = 'GENERIC_HTML';
            config.adapterName = 'GenericHtmlAdapter';
        }

        console.log(`Strategy: ${config.strategy} | Adapter: ${config.adapterName}`);
        const adapter = getAdapter(config);

        // --- STRATEGY: BULK PDF ---
        if (config.strategy === 'BULK_PDF') {
            if (!config.bulkUrl || !adapter.scrapeBulk) {
                console.error(`[ERROR] Missing bulkUrl or scrapeBulk method for ${uni.name}`);
                continue;
            }
            await adapter.scrapeBulk(uni.name, config.bulkUrl);
        } 
        
        // --- STRATEGY: HTML (Generic or Custom) ---
        else {
            if (!adapter.scrapeCourse) {
                console.error(`[ERROR] Missing scrapeCourse method for ${uni.name}`);
                continue;
            }

            let count = 1;
            for (const course of uni.courses) {
                if (!course.courseUrl) {
                    console.log(`[${count}/${uni.courses.length}] Skipping ${course.title}: No URL`);
                    count++;
                    continue;
                }

                console.log(`[${count}/${uni.courses.length}] Scraping: ${course.title}`);
                
                try {
                    const fees: ScrapedFees = await adapter.scrapeCourse(course.courseUrl, course.title);

                    if (fees.homeFee || fees.internationalFee) {
                        console.log(`   > Found: Home £${fees.homeFee}, Intl £${fees.internationalFee}`);
                        
                        for (const option of course.options) {
                            const updateData: any = {};
                            if (!option.homeFee && fees.homeFee) updateData.homeFee = fees.homeFee;
                            if (!option.internationalFee && fees.internationalFee) updateData.internationalFee = fees.internationalFee;

                            if (Object.keys(updateData).length > 0) {
                                await prisma.courseOption.update({
                                    where: { id: option.id },
                                    data: updateData
                                });
                            }
                        }
                    } else {
                        console.log(`   > No fees found.`);
                    }
                } catch (err) {
                    console.error(`   > Error scraping ${course.title}:`, err);
                }

                count++;
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }

    console.log("\n=== Scraper Manager Finished ===");
}

if (require.main === module) {
    runScrapingManager()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}