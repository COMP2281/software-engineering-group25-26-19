// src/runSingle.ts

import { fetchSpecificCourse } from '../ucas';
import { processCourseData } from '../services';
import { enrichCourseData } from '../htmlscraper';
import prisma from '../db';

async function main() {
    // Get the UCAS Course ID from the command line arguments
    const ucasCourseId = process.argv[2];

    if (!ucasCourseId) {
        console.error("Error: Please provide a UCAS Course ID.");
        console.error("Usage: npx ts-node src/runSingle.ts <UCAS_COURSE_ID>");
        process.exit(1);
    }

    console.log(`\n=== Starting Single Course Pipeline for UCAS ID: ${ucasCourseId} ===\n`);

    try {
        // Step 1: Fetch from UCAS API
        console.log("--- Step 1: Fetching data from UCAS ---");
        const ucasData = await fetchSpecificCourse(ucasCourseId);
        
        if (!ucasData) {
            throw new Error(`No data returned from UCAS for course ID: ${ucasCourseId}`);
        }

        // --- FIX: Handle Array or Wrapped Object Responses ---
        let courseObj = null;
        
        // Check if it's wrapped in a "course" property (Standard v3 Details Response)
        if (ucasData.course && ucasData.course.provider) {
            courseObj = ucasData.course;
        } 
        // Check if it's an array
        else if (Array.isArray(ucasData)) {
            courseObj = ucasData[0];
        } 
        // Check if it's wrapped in a "courses" array (Standard v2 Search Response)
        else if (ucasData.courses && Array.isArray(ucasData.courses)) {
            courseObj = ucasData.courses[0];
        } 
        // Fallback
        else {
            courseObj = ucasData;
        }

        if (!courseObj || !courseObj.provider) {
            console.error("\n[DEBUG] Unexpected API Response Structure:");
            console.error(JSON.stringify(ucasData, null, 2).substring(0, 500) + "...\n");
            throw new Error("Could not locate the course object or provider details in the UCAS response.");
        }
        // -----------------------------------------------------

        console.log(`Successfully fetched data for: ${courseObj.courseTitle || 'Unknown Title'}`);

        // Step 2: Save to Database
        console.log("--- Step 2: Saving to Database ---");
        // processCourseData expects an object with a 'course' property
        await processCourseData({ course: courseObj });
        console.log("Course saved to database successfully.\n");

        // Step 3: Retrieve the internal Database ID (UUID)
        // The HTML scraper requires the internal Prisma UUID, not the UCAS ID
        const dbCourse = await prisma.course.findUnique({
            where: { ucasCourseId: ucasCourseId }
        });

        if (!dbCourse) {
            throw new Error(`Failed to find course in database after saving. UCAS ID: ${ucasCourseId}`);
        }

        // Step 4: HTML Scraping (Enrichment)
        console.log("--- Step 3: Enriching missing data via HTML Scraping ---");
        await enrichCourseData(dbCourse.id);
        console.log("Enrichment Complete.\n");

        console.log("=== Single Course Pipeline Finished Successfully ===");

    } catch (error) {
        console.error("\n!!! Pipeline Failed !!!");
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    } finally {
        // Clean up the database connection
        await prisma.$disconnect();
    }
}

// Execute main function
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}