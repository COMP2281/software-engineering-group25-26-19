import prisma from "./db";

export async function processCourseData(data: any) {
    const { course } = data;
    const provider = course.provider;

    // 1. Upsert University
    const university = await prisma.university.upsert({
        where: { ukprn: String(provider.ukprn) },
        update: {
            name: provider.name,
            address: provider.address,
            website: provider.websiteUrl,
            logoUrl: provider.logoUrl,
        },
        create: {
            name: provider.name,
            ukprn: String(provider.ukprn),
            address: provider.address,
            website: provider.websiteUrl,
            logoUrl: provider.logoUrl,
        },
    });

    // 2. Upsert Course
    // Try root level keys (common in Search API v2)
    let courseUrl = course.courseURL || course.deepLink;

    // If not found, look inside the first option (common in Search API v3 / Details)
    if (
        !courseUrl &&
        course.options &&
        Array.isArray(course.options) &&
        course.options.length > 0
    ) {
        // Use the first option's provider URL
        courseUrl = course.options[0].providerCourseUrl;
    }
    if (typeof courseUrl === "string") {
        courseUrl = courseUrl.trim();
    }

    const dbCourse = await prisma.course.upsert({
        where: { ucasCourseId: course.id },
        update: {
            title: course.courseTitle,
            applicationCode: course.applicationCode,
            summary: course.summary,
            universityId: university.id,
            courseUrl: courseUrl || null,
        },
        create: {
            ucasCourseId: course.id,
            title: course.courseTitle,
            applicationCode: course.applicationCode,
            summary: course.summary,
            courseUrl: courseUrl || null,
            universityId: university.id,
        },
    });

    // 3. Create Course Options
    if (course.options && Array.isArray(course.options)) {
        for (const option of course.options) {
            const aLevels = extractALevels(
                option.academicEntryRequirements?.qualifications,
            );

            // Outcome qualification
            const outcome = option.outcomeQualification?.caption;

            const { homeFee, internationalFee } = extractFees(
                option.courseFees,
            );

            // Construct the compound ID input
            const compoundId = {
                courseId: dbCourse.id,
                year: parseInt(option.applyCycle || "2026"),
                studyMode: option.studyMode?.caption,
                duration: option.duration
                    ? `${option.duration.quantity} ${option.duration.durationType?.caption}`
                    : "3 Years",
            };

            // Check if exists to avoid overwriting with nulls
            const existingOption = await prisma.courseOption.findUnique({
                where: {
                    courseId_year_studyMode_duration: compoundId,
                },
            });

            if (existingOption) {
                // Update only non-nulls
                const updateData: any = {};
                if (option.startDate?.date) updateData.startDate = option.startDate.date;
                if (outcome) updateData.outcomeQualification = outcome;
                if (homeFee != null) updateData.homeFee = homeFee;
                if (internationalFee != null) updateData.internationalFee = internationalFee;
                
                // Spread A-level fields only if they exist
                if (Object.keys(aLevels).length > 0) {
                     Object.assign(updateData, aLevels);
                }

                if (Object.keys(updateData).length > 0) {
                    await prisma.courseOption.update({
                        where: {
                             courseId_year_studyMode_duration: compoundId,
                        },
                        data: updateData,
                    });
                }
            } else {
                // Create new
                await prisma.courseOption.create({
                    data: {
                        ...compoundId,
                        startDate: option.startDate?.date,
                        outcomeQualification: outcome,
                        homeFee,
                        internationalFee,
                        ...aLevels,
                    },
                });
            }
        }
    }

    console.log(`Processed course: ${course.courseTitle} at ${provider.name}`);
}

function extractALevels(qualifications: any[]) {
    if (!qualifications) return {};

    const aLevel = qualifications.find(
        (q: any) => q.qualificationName === "A level",
    );
    if (!aLevel) return {};

    let offer = aLevel.summary?.offer || "";
    const result: any = {};

    // Handle ranges like "AAB - AAA"
    if (offer.includes("-")) {
        const parts = offer.split("-").map((s: string) => s.trim());
        let minScore = Infinity;
        let minOffer = "";

        for (const part of parts) {
            if (/^([A-Z]\*?)+$/.test(part)) {
                const score = calculateGradeScore(part);
                if (score < minScore) {
                    minScore = score;
                    minOffer = part;
                }
            }
        }
        if (minOffer) offer = minOffer;
    }

    // Improved heuristic: if offer is like "A*AA" or "BBB", split it.
    // Matches sequences of letters, optionally followed by *.
    if (/^([A-Z]\*?)+$/.test(offer)) {
        const grades = offer.match(/[A-Z]\*?/g) || [];
        if (grades.length > 0) result.aLevelGrade1 = grades[0];
        if (grades.length > 1) result.aLevelGrade2 = grades[1];
        if (grades.length > 2) result.aLevelGrade3 = grades[2];
        if (grades.length > 3) result.aLevelGrade4 = grades[3];
    } else {
        result.aLevelGrade1 = offer;
    }

    return result;
}

function calculateGradeScore(gradeString: string): number {
    const grades = gradeString.match(/[A-Z]\*?/g) || [];
    let score = 0;
    const values: { [key: string]: number } = {
        "A*": 6,
        A: 5,
        B: 4,
        C: 3,
        D: 2,
        E: 1,
    };
    for (const g of grades) {
        score += values[g] || 0;
    }
    return score;
}

function extractFees(courseFees: any[]) {
    if (!courseFees || !Array.isArray(courseFees)) {
        return { homeFee: null, internationalFee: null };
    }

    let homeFee: number | null = null;
    let internationalFee: number | null = null;

    for (const fee of courseFees) {
        const locale = fee.feeLocale?.caption;
        if (locale === "England") {
            homeFee = fee.amount;
        } else if (locale === "International") {
            internationalFee = fee.amount;
        }
    }

    return { homeFee, internationalFee };
}
