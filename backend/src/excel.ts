import prisma from "./db";
import ExcelJS from "exceljs";

interface CourseExportFilters {
    q?: string | undefined;
    courseIds?: string[] | undefined;
    universityIds?: string[] | undefined;
    year?: number | undefined;
    minFee?: number | undefined;
    maxFee?: number | undefined;
    feeType?: "home" | "international" | undefined;
    level?: "undergraduate" | "postgraduate" | "all" | undefined;
}

const PURPLE_THEME = {
    dark: "FF68246D",
    deep: "FF7B3E8F",
    medium: "FFA978BA",
    light: "FFD8BFDF",
    soft: "FFF3ECF6",
    softAlt: "FFECE0F1",
    border: "FFB98CBE",
    blockBorder: "FF8A5C94",
    textDark: "FF2F1F35",
    white: "FFFFFFFF",
};

const COLUMNS: Array<{ header: string; key: string; width: number }> = [
    { header: "University Name", key: "universityName", width: 24 },
    { header: "University ID", key: "universityId", width: 36 },
    { header: "UKPRN", key: "universityUkprn", width: 10 },
    { header: "University Website", key: "universityWebsite", width: 28 },
    { header: "Course Title", key: "courseTitle", width: 28 },
    { header: "Course ID", key: "courseId", width: 36 },
    { header: "UCAS Course ID", key: "ucasCourseId", width: 36 },
    { header: "Application Code", key: "applicationCode", width: 8 },
    { header: "Course URL", key: "courseUrl", width: 30 },
    { header: "Option ID", key: "optionId", width: 36 },
    { header: "Year", key: "optionYear", width: 6 },
    { header: "Study Mode", key: "optionStudyMode", width: 14 },
    { header: "Duration", key: "optionDuration", width: 8 },
    { header: "Start Date", key: "optionStartDate", width: 12 },
    { header: "Outcome Qualification", key: "outcomeQualification", width: 24 },
    { header: "Home Fee", key: "homeFee", width: 8 },
    { header: "International Fee", key: "internationalFee", width: 8 },
    { header: "A-Level Grade 1", key: "aLevelGrade1", width: 4 },
    { header: "A-Level Subject 1", key: "aLevelSubject1", width: 22 },
    { header: "A-Level Grade 2", key: "aLevelGrade2", width: 4 },
    { header: "A-Level Subject 2", key: "aLevelSubject2", width: 22 },
    { header: "A-Level Grade 3", key: "aLevelGrade3", width: 4 },
    { header: "A-Level Subject 3", key: "aLevelSubject3", width: 22 },
    { header: "A-Level Grade 4", key: "aLevelGrade4", width: 4 },
    { header: "A-Level Subject 4", key: "aLevelSubject4", width: 22 },
    { header: "Created At", key: "optionCreatedAt", width: 8 },
    { header: "Updated At", key: "optionUpdatedAt", width: 8 },
];

const SHARED_KEYS = [
    "universityName",
    "universityId",
    "universityUkprn",
    "universityWebsite",
    "courseTitle",
    "courseId",
    "ucasCourseId",
    "applicationCode",
    "courseUrl",
];

const OPTION_KEYS = [
    "optionId",
    "optionYear",
    "optionStudyMode",
    "optionDuration",
    "optionStartDate",
    "outcomeQualification",
    "homeFee",
    "internationalFee",
    "aLevelGrade1",
    "aLevelSubject1",
    "aLevelGrade2",
    "aLevelSubject2",
    "aLevelGrade3",
    "aLevelSubject3",
    "aLevelGrade4",
    "aLevelSubject4",
    "optionCreatedAt",
    "optionUpdatedAt",
];

function sanitizeWorksheetName(name: string): string {
    const cleaned = name.replace(/[\\/*?:\[\]]/g, " ").trim();
    return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned || "University";
}

function getUniqueWorksheetName(
    workbook: ExcelJS.Workbook,
    preferredName: string,
): string {
    const baseName = sanitizeWorksheetName(preferredName);
    let candidate = baseName;
    let counter = 2;

    while (workbook.getWorksheet(candidate)) {
        const suffix = ` (${counter})`;
        const maxBaseLength = 31 - suffix.length;
        candidate = `${baseName.slice(0, maxBaseLength)}${suffix}`;
        counter += 1;
    }

    return candidate;
}

function applyHeaderStyle(row: ExcelJS.Row): void {
    row.eachCell((cell) => {
        cell.font = {
            bold: true,
            color: { argb: PURPLE_THEME.white },
            size: 11,
        };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: PURPLE_THEME.dark },
        };
        cell.alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
        };
        cell.border = {
            top: { style: "thin", color: { argb: PURPLE_THEME.border } },
            left: { style: "thin", color: { argb: PURPLE_THEME.border } },
            bottom: { style: "thin", color: { argb: PURPLE_THEME.border } },
            right: { style: "thin", color: { argb: PURPLE_THEME.border } },
        };
    });
}

function applySharedCellStyle(
    cell: ExcelJS.Cell,
    hasMultipleOptions: boolean,
): void {
    cell.font = { bold: true, color: { argb: PURPLE_THEME.textDark } };
    cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
            argb: hasMultipleOptions ? PURPLE_THEME.medium : PURPLE_THEME.light,
        },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
        top: { style: "thin", color: { argb: PURPLE_THEME.border } },
        left: { style: "thin", color: { argb: PURPLE_THEME.border } },
        bottom: { style: "thin", color: { argb: PURPLE_THEME.border } },
        right: { style: "thin", color: { argb: PURPLE_THEME.border } },
    };
}

function applyOptionCellStyle(
    cell: ExcelJS.Cell,
    isAlternate: boolean,
    hasMultipleOptions: boolean,
): void {
    cell.font = { color: { argb: PURPLE_THEME.textDark } };
    cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
            argb: hasMultipleOptions
                ? isAlternate
                    ? PURPLE_THEME.softAlt
                    : PURPLE_THEME.soft
                : PURPLE_THEME.soft,
        },
    };
    cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
    cell.border = {
        top: { style: "thin", color: { argb: PURPLE_THEME.border } },
        left: { style: "thin", color: { argb: PURPLE_THEME.border } },
        bottom: { style: "thin", color: { argb: PURPLE_THEME.border } },
        right: { style: "thin", color: { argb: PURPLE_THEME.border } },
    };
}

function getColumnIndexByKey(key: string): number {
    const index = COLUMNS.findIndex((column) => column.key === key);
    return index >= 0 ? index + 1 : -1;
}

function styleCourseBlock(
    worksheet: ExcelJS.Worksheet,
    startRow: number,
    endRow: number,
): void {
    const optionCount = endRow - startRow + 1;
    const hasMultipleOptions = optionCount > 1;

    for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.height = 23;
        const isAlternate = (rowNumber - startRow) % 2 === 1;

        for (const key of OPTION_KEYS) {
            const columnIndex = getColumnIndexByKey(key);
            if (columnIndex > 0) {
                applyOptionCellStyle(
                    row.getCell(columnIndex),
                    isAlternate,
                    hasMultipleOptions,
                );
            }
        }

        if (hasMultipleOptions) {
            const optionIdIndex = getColumnIndexByKey("optionId");
            if (optionIdIndex > 0) {
                const optionIdCell = row.getCell(optionIdIndex);
                optionIdCell.font = {
                    bold: true,
                    color: { argb: PURPLE_THEME.deep },
                };
            }
        }

        for (let column = 1; column <= COLUMNS.length; column += 1) {
            const cell = row.getCell(column);
            if (rowNumber === startRow) {
                cell.border = {
                    ...cell.border,
                    top: {
                        style: "medium",
                        color: { argb: PURPLE_THEME.blockBorder },
                    },
                };
            }
            if (rowNumber === endRow) {
                cell.border = {
                    ...cell.border,
                    bottom: {
                        style: "medium",
                        color: { argb: PURPLE_THEME.blockBorder },
                    },
                };
            }
        }
    }

    for (const key of SHARED_KEYS) {
        const columnIndex = getColumnIndexByKey(key);
        if (columnIndex < 0) continue;

        if (endRow > startRow) {
            worksheet.mergeCells(startRow, columnIndex, endRow, columnIndex);
        }

        applySharedCellStyle(
            worksheet.getCell(startRow, columnIndex),
            hasMultipleOptions,
        );
    }
}

function setupWorksheet(worksheet: ExcelJS.Worksheet): void {
    worksheet.columns = COLUMNS;
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: COLUMNS.length },
    };

    const header = worksheet.getRow(1);
    header.height = 24;
    applyHeaderStyle(header);

    const numericCurrencyKeys = new Set(["homeFee", "internationalFee"]);
    worksheet.columns.forEach((column) => {
        if (column.key && numericCurrencyKeys.has(String(column.key))) {
            column.numFmt = "£#,##0.00";
        }
    });
}

function optionMatchesFilters(
    option: {
        year: number;
        homeFee: number | null;
        internationalFee: number | null;
        outcomeQualification: string | null;
    },
    filters: Required<Pick<CourseExportFilters, "feeType" | "level">> &
        Pick<CourseExportFilters, "year" | "minFee" | "maxFee">,
): boolean {
    const { year, minFee, maxFee, feeType, level } = filters;
    let matches = true;

    if (year && option.year !== year) matches = false;

    if (
        level === "undergraduate" &&
        !option.outcomeQualification?.toLowerCase().startsWith("b")
    ) {
        matches = false;
    }

    if (
        level === "postgraduate" &&
        option.outcomeQualification?.toLowerCase().startsWith("b")
    ) {
        matches = false;
    }

    if (minFee !== undefined) {
        const fee =
            feeType === "international"
                ? option.internationalFee
                : option.homeFee;
        if (fee === null || fee < minFee) matches = false;
    }

    if (maxFee !== undefined) {
        const fee =
            feeType === "international"
                ? option.internationalFee
                : option.homeFee;
        if (fee === null || fee > maxFee) matches = false;
    }

    return matches;
}

export async function exportCoursesToExcel(
    filters: CourseExportFilters,
): Promise<ExcelJS.Workbook> {
    console.log(`Exporting courses with filters:`, filters);

    const {
        q,
        courseIds,
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

    if (courseIds && courseIds.length > 0) {
        andConditions.push({ id: { in: courseIds } });
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
    const worksheetsByUniversity = new Map<string, ExcelJS.Worksheet>();

    for (const course of courses) {
        const uniName = course.university.name;
        let worksheet = worksheetsByUniversity.get(uniName);
        if (!worksheet) {
            worksheet = workbook.addWorksheet(
                getUniqueWorksheetName(workbook, uniName),
            );
            setupWorksheet(worksheet);
            worksheetsByUniversity.set(uniName, worksheet);
        }

        const filteredOptions = course.options.filter((option) =>
            optionMatchesFilters(option, {
                year,
                minFee,
                maxFee,
                feeType,
                level,
            }),
        );

        const sharedData = {
            universityName: course.university.name,
            universityId: course.university.id,
            universityUkprn: course.university.ukprn,
            universityWebsite: course.university.website,
            courseTitle: course.title,
            courseId: course.id,
            ucasCourseId: course.ucasCourseId,
            applicationCode: course.applicationCode,
            courseUrl: course.courseUrl,
        };

        const startRow = worksheet.rowCount + 1;

        if (filteredOptions.length === 0) {
            worksheet.addRow({
                ...sharedData,
                optionId: "No option rows match current filters",
            });
            styleCourseBlock(worksheet, startRow, startRow);
            continue;
        }

        for (const option of filteredOptions) {
            worksheet.addRow({
                ...sharedData,
                optionId: option.id,
                optionYear: option.year,
                optionStudyMode: option.studyMode,
                optionDuration: option.duration,
                optionStartDate: option.startDate,
                outcomeQualification: option.outcomeQualification,
                homeFee: option.homeFee,
                internationalFee: option.internationalFee,
                aLevelGrade1: option.aLevelGrade1,
                aLevelSubject1: option.aLevelSubject1,
                aLevelGrade2: option.aLevelGrade2,
                aLevelSubject2: option.aLevelSubject2,
                aLevelGrade3: option.aLevelGrade3,
                aLevelSubject3: option.aLevelSubject3,
                aLevelGrade4: option.aLevelGrade4,
                aLevelSubject4: option.aLevelSubject4,
                optionCreatedAt: option.createdAt,
                optionUpdatedAt: option.updatedAt,
            });
        }

        const endRow = worksheet.rowCount;
        styleCourseBlock(worksheet, startRow, endRow);
    }

    if (workbook.worksheets.length === 0) {
        const worksheet = workbook.addWorksheet("No Results");
        setupWorksheet(worksheet);
        worksheet.addRow({
            courseTitle: "No courses matched the selected filters.",
        });
        styleCourseBlock(worksheet, 2, 2);
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
