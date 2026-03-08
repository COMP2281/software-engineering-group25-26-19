// src/scrapers/manager.ts

import prisma from '../db';
import { ScraperConfig } from './config';
import { IScraperAdapter, ScrapeContext, OptionScrapeResult, UniversityScraperConfig } from './interfaces';
import { Logger } from './logger';
import { GenericHtmlAdapter } from './adapters/GenericHtml';
import { BulkPdfAdapter } from './adapters/BulkPdf';
import { BathAdapter } from './adapters/Bath';
import { BirminghamAdapter } from './adapters/Birmingham';
import { BristolAdapter } from './adapters/Bristol';
import { CambridgeAdapter } from './adapters/Cambridge';
// import { CardiffAdapter } from './adapters/Cardiff';
import { EdinburghAdapter } from './adapters/Edinburgh';
import { ExeterAdapter } from './adapters/Exeter';
import { GlasgowAdapter } from './adapters/Glasgow';
import { LancasterAdapter } from './adapters/Lancaster';
import { LiverpoolAdapter } from './adapters/Liverpool';
import { LoughboroughAdapter } from './adapters/Loughborough';
import { ManchesterAdapter } from './adapters/Manchester';
import { NewcastleAdapter } from './adapters/Newcastle';
import { OxfordAdapter } from './adapters/Oxford';
import { QueenMaryAdapter } from './adapters/QueenMary';
import { QueensBelfastAdapter } from './adapters/QueensBelfast';
import { SheffieldAdapter } from './adapters/Sheffield';
import { SouthamptonAdapter } from './adapters/Southampton';
import { StAndrewsAdapter } from './adapters/StAndrews';
import { SunderlandAdapter } from './adapters/Sunderland';
import { UCLAdapter } from './adapters/UCL';
import { SoasAdapter } from './adapters/Soas';
import { WarwickAdapter } from './adapters/Warwick';

function getAdapter(config: UniversityScraperConfig): IScraperAdapter {
    switch (config.adapterName) {
        case 'BulkPdfAdapter': return new BulkPdfAdapter();
        case 'BathAdapter': return new BathAdapter(config.centralFeeUrls!);
        case 'BirminghamAdapter': return new BirminghamAdapter();
        case 'BristolAdapter': return new BristolAdapter();
        case 'CambridgeAdapter': return new CambridgeAdapter();
        // case 'CardiffAdapter': return new CardiffAdapter();
        case 'EdinburghAdapter': return new EdinburghAdapter();
        case 'ExeterAdapter': return new ExeterAdapter();
        case 'GlasgowAdapter': return new GlasgowAdapter(config.centralFeeUrls!);
        case 'LancasterAdapter': return new LancasterAdapter();
        case 'LiverpoolAdapter': return new LiverpoolAdapter();
        case 'LoughboroughAdapter': return new LoughboroughAdapter();
        case 'ManchesterAdapter': return new ManchesterAdapter();
        case 'NewcastleAdapter': return new NewcastleAdapter();
        case 'OxfordAdapter': return new OxfordAdapter();
        case 'QueenMaryAdapter': return new QueenMaryAdapter();
        case 'QueensBelfastAdapter': return new QueensBelfastAdapter();
        case 'SheffieldAdapter': return new SheffieldAdapter();
        case 'SouthamptonAdapter': return new SouthamptonAdapter();
        case 'StAndrewsAdapter': return new StAndrewsAdapter();
        case 'SunderlandAdapter': return new SunderlandAdapter();
        case 'UCLAdapter': return new UCLAdapter();
        case 'SoasAdapter': return new SoasAdapter();
        case 'WarwickAdapter': return new WarwickAdapter();
        case 'GenericHtmlAdapter': return new GenericHtmlAdapter();
        default:
            console.warn(`[WARNING] Adapter ${config.adapterName} not implemented yet. Falling back to Generic.`);
            return new GenericHtmlAdapter();
    }
}

/**
 * Helper to find the correct configuration even if the names don't match exactly.
 * e.g. Matches "The University of Manchester" (DB) to "University of Manchester" (Config)
 */
function getConfigForUniversity(dbName: string): UniversityScraperConfig {
    // 1. Try Exact Match
    if (ScraperConfig[dbName]) {
        return ScraperConfig[dbName];
    }

    // 2. Try Partial/Fuzzy Match
    // We check if the DB name contains the Config Key, or vice versa.
    const lowerDbName = dbName.toLowerCase();
    const configKey = Object.keys(ScraperConfig).find(key => {
        const lowerKey = key.toLowerCase();
        return lowerDbName.includes(lowerKey) || lowerKey.includes(lowerDbName);
    });

    if (configKey) {
        // console.log(`[DEBUG] Fuzzy matched config: "${dbName}" -> "${configKey}"`);
        return ScraperConfig[configKey]!;
    }

    // 3. Fallback to Generic
    return {
        strategy: 'GENERIC_HTML',
        adapterName: 'GenericHtmlAdapter'
    };
}

async function runScrapingManager() {
    Logger.info("\n=== Starting Scraper Manager ===");

    // --- 1. CLI ARGUMENT PARSING ---
    const filters: any = {
        q: null,
        universityIds: [],
        year: null,
        minFee: null,
        maxFee: null,
        feeType: "home",
        level: "all"
    };

    const args = process.argv.slice(2);
    for (const arg of args) {
        if (arg.startsWith('--q=')) filters.q = arg.split('=')[1];
        else if (arg.startsWith('--universityIds=')) {
            const value = arg.split('=')[1];
            if (value) filters.universityIds = value.split(',');
        }
        else if (arg.startsWith('--year=')) filters.year = parseInt(arg.split('=')[1] ?? '0', 10);
        else if (arg.startsWith('--minFee=')) filters.minFee = parseFloat(arg.split('=')[1] ?? '0');
        else if (arg.startsWith('--maxFee=')) filters.maxFee = parseFloat(arg.split('=')[1] ?? '0');
        else if (arg.startsWith('--feeType=')) filters.feeType = (arg.split('=')[1] ?? 'home').toLowerCase();
        else if (arg.startsWith('--level=')) filters.level = arg.split('=')[1];
    }

    // --- 2. BUILD PRISMA QUERY ---
    let whereClause: any = {};

    if (filters.level && filters.level.toLowerCase() !== 'all') {
        whereClause.studyMode = { contains: filters.level, mode: 'insensitive' };
    }

    if (filters.year) {
        whereClause.year = filters.year;
    }

    if (filters.minFee || filters.maxFee) {
        const feeField = filters.feeType === 'international' ? 'internationalFee' : 'homeFee';
        whereClause[feeField] = {};
        if (filters.minFee) whereClause[feeField].gte = filters.minFee;
        if (filters.maxFee) whereClause[feeField].lte = filters.maxFee;
    } else {
        whereClause.OR = [{ homeFee: null }, { internationalFee: null }];
    }

    let courseWhere: any = {};
    if (filters.q) {
        courseWhere.OR = [
            { title: { contains: filters.q, mode: "insensitive" } },
            { summary: { contains: filters.q, mode: "insensitive" } },
            { ucasCourseId: { contains: filters.q, mode: "insensitive" } },
        ];
    }
    if (filters.universityIds.length > 0) {
        courseWhere.universityId = { in: filters.universityIds };
    }
    if (Object.keys(courseWhere).length > 0) {
        whereClause.course = courseWhere;
    }

    console.log(`Querying DB with filters:`, filters);

    // --- 3. FETCH AND GROUP DATA ---
    const targetOptions = await prisma.courseOption.findMany({
        where: whereClause,
        include: {
            course: {
                include: { university: true }
            }
        }
    });

    if (targetOptions.length === 0) {
        Logger.info("No course options found matching the criteria. Exiting.");
        return;
    }

    Logger.info(`Found ${targetOptions.length} course options to scrape.`);

    const uniMap = new Map<string, any>();

    for (const option of targetOptions) {
        const uniId = option.course.universityId;
        const courseId = option.courseId;

        if (!uniMap.has(uniId)) {
            uniMap.set(uniId, { 
                university: option.course.university, 
                courses: new Map<string, any>() 
            });
        }

        const uniObj = uniMap.get(uniId);
        if (!uniObj.courses.has(courseId)) {
            uniObj.courses.set(courseId, {
                course: option.course,
                options: []
            });
        }

        uniObj.courses.get(courseId).options.push(option);
    }

    // --- 4. EXECUTE SCRAPING ---
    for (const [uniId, uniData] of uniMap.entries()) {
        const uni = uniData.university;
        const coursesMap = uniData.courses;

        Logger.info(`\n--- Processing: ${uni.name} ${uniId} (${coursesMap.size} unique courses) ---`);

        // UPDATED: Use the helper function to find the config
        const config = getConfigForUniversity(uni.name);
        
        Logger.debug(`Strategy: ${config.strategy} | Adapter: ${config.adapterName}`);
        
        const adapter = getAdapter(config);

        // BULK PDF Phase
        if (config.bulkUrl && (config.strategy === 'BULK_PDF' || config.strategy === 'HYBRID')) {
            const bulkAdapter = new BulkPdfAdapter();
            await bulkAdapter.scrapeBulk(uni.name, config.bulkUrl);
        }

        // HTML Phase
        if (config.strategy !== 'BULK_PDF') {
            if (!adapter.scrapeCourse) continue;

            let count = 1;
            for (const [courseId, courseData] of coursesMap.entries()) {
                const course = courseData.course;
                const options = courseData.options;
                const canResolveMissingUrl =
                    config.adapterName === 'QueenMaryAdapter' ||
                    config.adapterName === 'SheffieldAdapter' ||
                    config.adapterName === 'SouthamptonAdapter' ||
                    config.adapterName === 'StAndrewsAdapter' ||
                    config.adapterName === 'SunderlandAdapter' ||
                    config.adapterName === 'SoasAdapter' ||
                    config.adapterName === 'WarwickAdapter';

                if (!course.courseUrl && !canResolveMissingUrl) {
                    Logger.warn(`[${count}/${coursesMap.size}] Skipping ${course.title} ${courseId}: No URL`);
                    Logger.stats.skipped += options.length;
                    count++;
                    continue;
                }

                if (!course.courseUrl && canResolveMissingUrl) {
                    Logger.info(`[${count}/${coursesMap.size}] Scraping: ${course.title} (${options.length} options) [No URL in DB, attempting adapter resolution]`);
                } else {
                    Logger.info(`[${count}/${coursesMap.size}] Scraping: ${course.title} (${options.length} options)`);
                }

                const targetUrl = course.courseUrl ?? '';

                const contexts: ScrapeContext[] = options.map((opt: any) => ({
                    optionId: opt.id,
                    courseTitle: course.title,
                    studyMode: opt.studyMode,
                    year: opt.year,
                    duration: opt.duration,
                    outcomeQualification: opt.outcomeQualification
                }));

                try {
                    Logger.stats.total += contexts.length;

                    const results: OptionScrapeResult[] = await adapter.scrapeCourse(targetUrl, contexts);

                    for (const res of results) {
                        const hasHomeFee = res.homeFee !== null && res.homeFee !== undefined;
                        const hasIntlFee = res.internationalFee !== null && res.internationalFee !== undefined;

                        if (hasHomeFee || hasIntlFee) {
                            Logger.debug(`   > Option [${res.optionId}]: Home £${res.homeFee}, Intl £${res.internationalFee}`);
                            
                            const updateData: any = {};
                            if (hasHomeFee) updateData.homeFee = res.homeFee;
                            if (hasIntlFee) updateData.internationalFee = res.internationalFee;

                            await prisma.courseOption.update({
                                where: { id: res.optionId },
                                data: updateData
                            });
                            Logger.stats.success++;
                        } else {
                            Logger.debug(`   > Option [${res.optionId}]: No fees found.`);
                            Logger.stats.failed++;
                        }
                    }
                } catch (err) {
                    Logger.error(`   > Error scraping ${course.title}:`, err);
                    Logger.stats.failed += contexts.length;
                }

                count++;
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }

    Logger.info("\n=== Scraper Manager Finished ===");
}

if (require.main === module) {
    runScrapingManager()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
