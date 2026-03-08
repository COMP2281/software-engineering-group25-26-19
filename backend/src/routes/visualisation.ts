import { Router } from "express";
import prisma from "../db";

const router = Router();

// Helper to determine UG vs PG
function determineLevel(qualification: string | null): "Undergraduate" | "Postgraduate" | "Other" {
    if (!qualification) return "Other";
    const q = qualification.toLowerCase();
    
    // Common UG indicators
    if (q.includes("bsc") || q.includes("ba ") || q.includes("bachelor") || q.includes("undergraduate") || q.includes("llb") || q.includes("beng")) {
        return "Undergraduate";
    }
    
    // Common PG indicators
    if (q.includes("msc") || q.includes("ma ") || q.includes("master") || q.includes("postgraduate") || q.includes("llm") || q.includes("meng") || q.includes("phd") || q.includes("mba")) {
        return "Postgraduate";
    }

    return "Other";
}

/**
 * GET /api/visualisation/university-distribution
 * Returns number of courses per university
 */
router.get("/university-distribution", async (_req, res) => {
    try {
        const distribution = await prisma.university.findMany({
            select: {
                name: true,
                _count: {
                    select: { courses: true }
                }
            },
            // Removed limit to fetch all universities
            orderBy: {
                courses: {
                    _count: 'desc'
                }
            }
        });

        const formatted = distribution.map(uni => ({
            name: uni.name,
            courses: uni._count.courses
        }));

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching university distribution:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

/**
 * GET /api/visualisation/level-distribution
 * Returns distribution of course levels (UG vs PG)
 */
router.get("/level-distribution", async (_req, res) => {
    try {
        // Group by qualification string first since we don't store "Level" explicitly
        // If the dataset is large, this might be heavy, but for distinct qualifications it should be fine.
        // Actually, retrieving all qualifications might be better then processing in memory if list of distinct isn't huge.
        // But options are many.
        // Let's optimize: fetch distinct outcomeQualification and count.
        
        const options = await prisma.courseOption.groupBy({
            by: ['outcomeQualification'],
            _count: {
                _all: true
            }
        });

        const counts = {
            "Undergraduate": 0,
            "Postgraduate": 0,
            "Other": 0
        };

        options.forEach(opt => {
            const level = determineLevel(opt.outcomeQualification);
            counts[level] += opt._count._all;
        });

        // Filter out "Other" if irrelevant or small
        const result = [
            { name: "Undergraduate", value: counts["Undergraduate"] },
            { name: "Postgraduate", value: counts["Postgraduate"] }
        ];

        res.json(result);
    } catch (error) {
        console.error("Error fetching level distribution:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

/**
 * GET /api/visualisation/study-modes
 * Returns distribution of study modes (Full-time, Part-time, etc.)
 */
router.get("/study-modes", async (_req, res) => {
    try {
        const modes = await prisma.courseOption.groupBy({
            by: ['studyMode'],
            _count: {
                _all: true
            }
        });

        let totalCourses = 0;
        const rawModes = modes.map(m => {
            const count = m._count._all;
            totalCourses += count;
            return {
                name: m.studyMode || "Unknown",
                value: count
            };
        });

        const THRESHOLD_PERCENTAGE = 0.02; // 2%
        const result: { name: string, value: number }[] = [];
        let otherCount = 0;

        for (const mode of rawModes) {
            if (mode.value / totalCourses < THRESHOLD_PERCENTAGE) {
                otherCount += mode.value;
            } else {
                result.push(mode);
            }
        }

        if (otherCount > 0) {
            result.push({ name: "Other", value: otherCount });
        }

        // Sort descending
        result.sort((a, b) => b.value - a.value);

        res.json(result);
    } catch (error) {
        console.error("Error fetching study modes:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

/**
 * GET /api/visualisation/subjects
 * Returns list of subjects (distinct titles or predefined categories) for the dropdown
 * Dynamically sanitizes and groups courses.
 */
router.get("/subjects", async (_req, res) => {
    try {
        // Broad categories to check against
        const potentialSubjects = [
            "Computer Science",
            "Mechanical Engineering",
            "Civil Engineering",
            "Electrical Engineering",
            "Business",
            "Management",
            "Law",
            "Medicine",
            "Economics",
            "Psychology",
            "Architecture",
            "Physics",
            "Mathematics",
            "Chemistry",
            "Biology",
            "English",
            "History",
            "Politics",
            "Philosophy",
            "Sociology",
            "Art",
            "Design",
            "Accounting",
            "Finance",
            "Marketing",
            "Nursing"
        ];

        // Check availability of each subject in the database
        // We concurrently check counts for each keyword to see if it's worth showing
        const results = await Promise.all(
            potentialSubjects.map(async (subject) => {
                const count = await prisma.course.count({
                    where: {
                        title: {
                            contains: subject,
                            mode: 'insensitive'
                        }
                    }
                });
                return { subject, count };
            })
        );

        // Filter out subjects with no or very few courses (e.g., < 5)
        const activeSubjects = results
            .filter(r => r.count >= 5)
            .sort((a, b) => b.count - a.count)
            .map(r => r.subject);

        res.json(activeSubjects);
    } catch (error) {
        console.error("Error fetching subjects:", error);
        res.status(500).json({ error: "Failed to fetch subjects" });
    }
});

/**
 * GET /api/visualisation/price-history
 * Query param: ?subject=Computer Science
 * Returns avg price per year for courses matching the subject
 */
router.get("/price-history", async (req, res) => {
    const { subject } = req.query;
    
    if (!subject || typeof subject !== 'string') {
        res.status(400).json({ error: "Subject parameter is required" });
        return;
    }

    try {
        // Find courses where title contains the subject
        // And group options by year
        
        const options = await prisma.courseOption.findMany({
            where: {
                course: {
                    title: {
                        contains: subject,
                        mode: 'insensitive'
                    }
                },
                year: {
                    gte: 2020 // filter for reasonable years if needed
                }
            },
            select: {
                year: true,
                homeFee: true,
                internationalFee: true
            }
        });

        // Calculate averages per year
        const yearGroups: Record<number, { homeSum: number, intSum: number, count: number }> = {};

        options.forEach(opt => {
            const y = opt.year;
            if (!yearGroups[y]) {
                yearGroups[y] = { homeSum: 0, intSum: 0, count: 0 };
            }
            // Only count if fees are present (non-null and > 0)
            if (opt.homeFee || opt.internationalFee) {
                 // We might have records with only one fee. 
                 // Simple average approach:
            }
            
            // Wait, average needs to be per fee type.
        });

        // Better aggregation:
        // const aggregated = {}; // Key: year
        
        // Let's use array reduce
        const years = Array.from(new Set(options.map(o => o.year))).sort();
        
        const result = years.map(year => {
            const optsInYear = options.filter(o => o.year === year);
            
            // Avg Home Fee
            const homeFees = optsInYear.map(o => o.homeFee).filter(f => f !== null && f > 0) as number[];
            const avgHome = homeFees.length > 0 
                ? homeFees.reduce((a, b) => a + b, 0) / homeFees.length 
                : 0;

            // Avg Int Fee
            const intFees = optsInYear.map(o => o.internationalFee).filter(f => f !== null && f > 0) as number[];
            const avgInt = intFees.length > 0 
                ? intFees.reduce((a, b) => a + b, 0) / intFees.length 
                : 0;

            return {
                year: year.toString(),
                home: Math.round(avgHome),
                international: Math.round(avgInt)
            };
        });

        res.json(result);

    } catch (error) {
        console.error("Error fetching price history:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

export default router;
