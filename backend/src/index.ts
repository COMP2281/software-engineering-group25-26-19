import { fetchAllUcasCourses } from './ucas';
import { exportCoursesToExcel } from './excel';

async function main() {
    // Get arguments from command line
    // Usage: npx ts-node src/index.ts "University Name" "output.xlsx"
    const universityName = process.argv[2] || "Durham University";
    const excelFilename = process.argv[3] || "courses.xlsx";

    console.log(`\n=== Starting Pipeline for: ${universityName} ===\n`);

    try {
        // Step 1: Fetch from UCAS API and store in Database
        console.log("--- Step 1: Fetching data from UCAS and saving to Database ---");
        // fetchAllUcasCourses takes an array of providers
        await fetchAllUcasCourses([universityName]);
        console.log("Step 1 Complete.\n");

        // Step 2: Export from Database to Excel
        console.log(`--- Step 2: Exporting data to ${excelFilename} ---`);
        await exportCoursesToExcel(universityName, excelFilename);
        console.log("Step 2 Complete.\n");

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
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
