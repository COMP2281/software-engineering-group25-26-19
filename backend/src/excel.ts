import prisma from './db';
import ExcelJS from 'exceljs';

export async function exportCoursesToExcel(universityName: string, outputPath: string = 'courses.xlsx') {
    console.log(`Fetching courses for university: ${universityName}...`);

    const university = await prisma.university.findFirst({
        where: { name: { contains: universityName, mode: 'insensitive' } },
        include: {
            courses: {
                include: {
                    options: true
                }
            }
        }
    });

    if (!university) {
        console.error(`University '${universityName}' not found.`);
        return;
    }

    console.log(`Found university: ${university.name}. Processing ${university.courses.length} courses...`);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Courses');

    // Define columns
    worksheet.columns = [
        { header: 'Course Title', key: 'title', width: 30 },
        { header: 'UCAS Course ID', key: 'ucasCourseId', width: 15 },
        { header: 'Application Code', key: 'applicationCode', width: 15 },
        { header: 'Summary', key: 'summary', width: 50 },
        { header: 'Year', key: 'year', width: 10 },
        { header: 'Study Mode', key: 'studyMode', width: 15 },
        { header: 'Duration', key: 'duration', width: 15 },
        { header: 'Start Date', key: 'startDate', width: 15 },
        { header: 'Outcome', key: 'outcomeQualification', width: 20 },
        { header: 'Home Fee', key: 'homeFee', width: 15 },
        { header: 'Intl Fee', key: 'internationalFee', width: 15 },
        { header: 'A-Level Grade 1', key: 'aLevelGrade1', width: 10 },
        { header: 'A-Level Subject 1', key: 'aLevelSubject1', width: 20 },
        { header: 'A-Level Grade 2', key: 'aLevelGrade2', width: 10 },
        { header: 'A-Level Subject 2', key: 'aLevelSubject2', width: 20 },
        { header: 'A-Level Grade 3', key: 'aLevelGrade3', width: 10 },
        { header: 'A-Level Subject 3', key: 'aLevelSubject3', width: 20 },
    ];

    // Add rows
    for (const course of university.courses) {
        if (course.options && course.options.length > 0) {
            for (const option of course.options) {
                worksheet.addRow({
                    title: course.title,
                    ucasCourseId: course.ucasCourseId,
                    applicationCode: course.applicationCode,
                    summary: course.summary,
                    year: option.year,
                    studyMode: option.studyMode,
                    duration: option.duration,
                    startDate: option.startDate,
                    outcomeQualification: option.outcomeQualification,
                    homeFee: option.homeFee,
                    internationalFee: option.internationalFee,
                    aLevelGrade1: option.aLevelGrade1,
                    aLevelSubject1: option.aLevelSubject1,
                    aLevelGrade2: option.aLevelGrade2,
                    aLevelSubject2: option.aLevelSubject2,
                    aLevelGrade3: option.aLevelGrade3,
                    aLevelSubject3: option.aLevelSubject3,
                });
            }
        } else {
            // Add a row even if no options, just course info
            worksheet.addRow({
                title: course.title,
                ucasCourseId: course.ucasCourseId,
                applicationCode: course.applicationCode,
                summary: course.summary,
            });
        }
    }

    await workbook.xlsx.writeFile(outputPath);
    console.log(`Exported data to ${outputPath}`);
}

// Main execution block if run directly
if (require.main === module) {
    const args = process.argv.slice(2);
    const uniName = args[0] || "Durham University";
    const outFile = args[1] || "courses.xlsx";
    
    exportCoursesToExcel(uniName, outFile)
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
