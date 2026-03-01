import prisma from "./db";
import ExcelJS from "exceljs";

interface CourseExportFilters {
    q?: string | undefined;
    universityIds?: string[] | undefined;
    year?: number | undefined;
    minFee?: number | undefined;
    maxFee?: number | undefined;
    feeType?: "home" | "international" | undefined;
    level?: "undergraduate" | "postgraduate" | "all" | undefined;
}

export async function exportCoursesToExcel(
    filters: CourseExportFilters,
): Promise<ExcelJS.Workbook> {
    console.log(`Exporting courses with filters:`, filters);

    const {
        q,
        universityIds,
        year,
        minFee,
        maxFee,
        feeType = "home",
        level = "all",
    } = filters;

    const andConditions: any[] = [];

    if (q) {
        andConditions.push({
            OR: [
                { title: { contains: q, mode: "insensitive" } },
                { summary: { contains: q, mode: "insensitive" } },
                { ucasCourseId: { contains: q, mode: "insensitive" } },
            ],
        });
    }

    if (universityIds && universityIds.length > 0) {
        andConditions.push({ universityId: { in: universityIds } });
    }

    const optionFilters: any[] = [];
    if (year) optionFilters.push({ year });

    if (minFee !== undefined || maxFee !== undefined) {
        const feeField =
            feeType === "international" ? "internationalFee" : "homeFee";
        const feeCond: any = {};
        if (minFee !== undefined) feeCond.gte = minFee;
        if (maxFee !== undefined) feeCond.lte = maxFee;
        optionFilters.push({ [feeField]: feeCond });
    }

    if (level === "undergraduate") {
        optionFilters.push({
            outcomeQualification: { startsWith: "B", mode: "insensitive" },
        });
    } else if (level === "postgraduate") {
        optionFilters.push({
            AND: [
                { outcomeQualification: { not: null } },
                {
                    NOT: {
                        outcomeQualification: {
                            startsWith: "B",
                            mode: "insensitive",
                        },
                    },
                },
            ],
        });
    }

    if (optionFilters.length) {
        const optionWhere =
            optionFilters.length === 1
                ? optionFilters[0]
                : { AND: optionFilters };
        andConditions.push({ options: { some: optionWhere } });
    }

    const where = andConditions.length ? { AND: andConditions } : {};

    const courses = await prisma.course.findMany({
        where,
        include: {
            options: true,
            university: true,
        },
        orderBy: { title: "asc" },
    });

    console.log(`Found ${courses.length} courses to export.`);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Courses");

    worksheet.columns = [
        { header: "University", key: "university", width: 25 },
        { header: "Course Title", key: "title", width: 30 },
        { header: "UCAS Course ID", key: "ucasCourseId", width: 15 },
        { header: "Application Code", key: "applicationCode", width: 15 },
        { header: "Summary", key: "summary", width: 50 },
        { header: "Year", key: "year", width: 10 },
        { header: "Study Mode", key: "studyMode", width: 15 },
        { header: "Duration", key: "duration", width: 15 },
        { header: "Start Date", key: "startDate", width: 15 },
        { header: "Outcome", key: "outcomeQualification", width: 20 },
        { header: "Home Fee", key: "homeFee", width: 15 },
        { header: "Intl Fee", key: "internationalFee", width: 15 },
        { header: "A-Level Grade 1", key: "aLevelGrade1", width: 10 },
        { header: "A-Level Subject 1", key: "aLevelSubject1", width: 20 },
        { header: "A-Level Grade 2", key: "aLevelGrade2", width: 10 },
        { header: "A-Level Subject 2", key: "aLevelSubject2", width: 20 },
        { header: "A-Level Grade 3", key: "aLevelGrade3", width: 10 },
        { header: "A-Level Subject 3", key: "aLevelSubject3", width: 20 },
    ];

    for (const course of courses) {
        if (course.options && course.options.length > 0) {
            for (const option of course.options) {
                let matchesOption = true;
                if (year && option.year !== year) matchesOption = false;
                if (
                    level === "undergraduate" &&
                    !option.outcomeQualification?.toLowerCase().startsWith("b")
                )
                    matchesOption = false;
                if (
                    level === "postgraduate" &&
                    option.outcomeQualification?.toLowerCase().startsWith("b")
                )
                    matchesOption = false;

                if (minFee !== undefined) {
                    const fee =
                        feeType === "international"
                            ? option.internationalFee
                            : option.homeFee;
                    if (fee === null || fee < minFee) matchesOption = false;
                }
                if (maxFee !== undefined) {
                    const fee =
                        feeType === "international"
                            ? option.internationalFee
                            : option.homeFee;
                    if (fee === null || fee > maxFee) matchesOption = false;
                }

                if (matchesOption) {
                    worksheet.addRow({
                        university: course.university.name,
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
            }
        } else {
            worksheet.addRow({
                university: course.university.name,
                title: course.title,
                ucasCourseId: course.ucasCourseId,
                applicationCode: course.applicationCode,
                summary: course.summary,
            });
        }
    }

    return workbook;
}

// Main execution block if run directly
if (require.main === module) {
    const args = process.argv.slice(2);
    const uniName = args[0] || "Durham University";
    const outFile = args[1] || "courses.xlsx";

    // Simple CLI wrapper for backward compatibility feeling
    (async () => {
        try {
            const uni = await prisma.university.findFirst({
                where: { name: { contains: uniName, mode: "insensitive" } },
            });
            if (!uni) {
                console.error(`University '${uniName}' not found.`);
                process.exit(1);
            }
            const workbook = await exportCoursesToExcel({
                universityIds: [uni.id],
            });
            await workbook.xlsx.writeFile(outFile);
            console.log(`Exported data to ${outFile}`);
            process.exit(0);
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    })();
}
