import { fetchAllUcasCourses } from "../ucas";
import { exportCoursesToExcel } from "../excel";
import { enrichCourseData } from "../htmlscraper";
import prisma from "../db";

async function main() {
    // Get arguments from command line
    // Usage: npx ts-node src/index.ts "University Name" "output.xlsx"
    const universityName = process.argv[2] || "Durham University";
    const excelFilename = process.argv[3] || "courses.xlsx";

    console.log(`\n=== Starting Pipeline for: ${universityName} ===\n`);

    try {
        // Step 1: Fetch from UCAS API and store in Database
        console.log(
            "--- Step 1: Fetching data from UCAS and saving to Database ---",
        );
        // fetchAllUcasCourses takes an array of providers
        await fetchAllUcasCourses([universityName]);
        console.log("Step 1 Complete.\n");

        // Step 1.5: HTML Scraping (The Enrichment Phase)
        console.log(
            "--- Step 1.5: Enriching missing data via HTML Scraping ---",
        );

        // Find courses for this uni that have options with missing fees
        const university = await prisma.university.findFirst({
            where: { name: { contains: universityName, mode: "insensitive" } },
            include: {
                courses: {
                    include: { options: true },
                },
            },
        });

        if (university) {
            // Filter courses where ANY option has null fees
            const coursesToScrape = university.courses.filter((c) =>
                c.options.some(
                    (o) => o.homeFee === null || o.internationalFee === null,
                ),
            );

            console.log(
                `Found ${coursesToScrape.length} courses with missing fee data.`,
            );

            let counter = 0;
            for (const course of coursesToScrape) {
                counter++;
                console.log(
                    `[${counter}/${coursesToScrape.length}] Processing: ${course.title}`,
                );

                // Call the scraper
                await enrichCourseData(course.id);

                // Polite delay to avoid IP bans
                await new Promise((r) => setTimeout(r, 1000));
            }
        }
        console.log("Step 1.5 Complete.\n");

        // Step 2: Export from Database to Excel
        console.log(`--- Step 2: Exporting data to ${excelFilename} ---`);

        const uniForExport = await prisma.university.findFirst({
            where: { name: { contains: universityName, mode: "insensitive" } },
        });

        if (uniForExport) {
            const workbook = await exportCoursesToExcel({
                universityIds: [uniForExport.id],
            });
            await workbook.xlsx.writeFile(excelFilename);
            console.log("Step 2 Complete.\n");
        } else {
            console.error(`University '${universityName}' not found.`);
        }

        console.log("=== Pipeline Finished Successfully ===");
    } catch (error) {
        console.error("\n!!! Pipeline Failed !!!");
        console.error(error);
        process.exit(1);
    }
}

// Execute main function
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
