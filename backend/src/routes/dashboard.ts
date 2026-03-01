import { Router } from "express";
import prisma from "../db";

const router = Router();

// GET /dashboard - summary for the dashboard
router.get("/", async (_req, res) => {
    try {
        const totalCourses = await prisma.course.count();
        const universitiesCovered = await prisma.university.count();

        const lastSuccessfulScrape = await prisma.scrape.findFirst({
            where: { status: "COMPLETED" },
            orderBy: { finishedAt: "desc" },
        });

        const runningScrape = await prisma.scrape.findFirst({
            where: { status: "RUNNING" },
        });

        const issuesCount = await prisma.scrapeIssue.count({
            where: { resolved: false },
        });

        // Compose dashboard summary fields expected by frontend
        const lastUpdatedIso = lastSuccessfulScrape?.finishedAt
            ? lastSuccessfulScrape.finishedAt.toISOString()
            : null;

        // Map status to frontend-friendly enums: 'idle'|'running'|'success'|'failed'
        let statusKey: "idle" | "running" | "success" | "failed" = "idle";
        if (runningScrape) statusKey = "running";
        else if (lastSuccessfulScrape)
            statusKey =
                lastSuccessfulScrape.status === "COMPLETED"
                    ? "success"
                    : "failed";

        return res.status(200).json({
            totalCourses,
            universitiesCovered,
            lastSuccessfulScrapeAt: lastUpdatedIso,
            status: statusKey,
            runningScrapeId: runningScrape?.id ?? null,
            issuesCount: issuesCount,
        });
    } catch (err) {
        console.error(err);
        return res
            .status(500)
            .json({ error: "Failed to fetch dashboard data" });
    }
});

// Also expose /dashboard/summary for compatibility
router.get("/summary", async (_req, res) => {
    try {
        const totalCourses = await prisma.course.count();
        const universitiesCovered = await prisma.university.count();

        const lastSuccessfulScrape = await prisma.scrape.findFirst({
            where: { status: "COMPLETED" },
            orderBy: { finishedAt: "desc" },
        });

        const runningScrape = await prisma.scrape.findFirst({
            where: { status: "RUNNING" },
        });

        const issuesCount = await prisma.scrapeIssue.count({
            where: { resolved: false },
        });

        const lastUpdatedIso = lastSuccessfulScrape?.finishedAt
            ? lastSuccessfulScrape.finishedAt.toISOString()
            : null;

        let statusKey: "idle" | "running" | "success" | "failed" = "idle";
        if (runningScrape) statusKey = "running";
        else if (lastSuccessfulScrape)
            statusKey =
                lastSuccessfulScrape.status === "COMPLETED"
                    ? "success"
                    : "failed";

        return res.status(200).json({
            totalCourses,
            universitiesCovered,
            lastSuccessfulScrapeAt: lastUpdatedIso,
            status: statusKey,
            runningScrapeId: runningScrape?.id ?? null,
            issuesCount: issuesCount,
        });
    } catch (err) {
        console.error(err);
        return res
            .status(500)
            .json({ error: "Failed to fetch dashboard data" });
    }
});

// GET /dashboard/scrapes - list recent scrapes with their issue counts
router.get("/scrapes", async (_req, res) => {
    try {
        const scrapes = await prisma.scrape.findMany({
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { issues: true },
        });
        const out = scrapes.map((s) => ({
            id: s.id,
            startedAt: s.startedAt,
            finishedAt: s.finishedAt,
            status: s.status,
            issueCount: s.issues.length,
        }));
        return res.status(200).json({ data: out });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch scrapes" });
    }
});

// GET /dashboard/fees - return histograms in frontend-friendly shape
router.get("/fees", async (_req, res) => {
    try {
        const options = await prisma.courseOption.findMany({
            select: { homeFee: true, internationalFee: true },
        });

        const homeRanges = [
            { range: "0–5000", test: (v: number) => v < 5000 },
            { range: "5000–7500", test: (v: number) => v >= 5000 && v < 7500 },
            { range: "7500–9000", test: (v: number) => v >= 7500 && v < 9000 },
            {
                range: "9000–10000",
                test: (v: number) => v >= 9000 && v < 10000,
            },
            {
                range: "10000–12500",
                test: (v: number) => v >= 10000 && v < 12500,
            },
            { range: "12500+", test: (_v: number) => true },
        ];

        const intlRanges = [
            { range: "0–10000", test: (v: number) => v < 10000 },
            {
                range: "10000–15000",
                test: (v: number) => v >= 10000 && v < 15000,
            },
            {
                range: "15000–20000",
                test: (v: number) => v >= 15000 && v < 20000,
            },
            {
                range: "20000–25000",
                test: (v: number) => v >= 20000 && v < 25000,
            },
            {
                range: "25000–30000",
                test: (v: number) => v >= 25000 && v < 30000,
            },
            { range: "30000+", test: (_v: number) => true },
        ];

        const homeBins = homeRanges.map((r) => ({ range: r.range, count: 0 }));
        const intlBins = intlRanges.map((r) => ({ range: r.range, count: 0 }));

        for (const o of options) {
            const h = o.homeFee;
            if (typeof h === "number") {
                for (let i = 0; i < homeRanges.length; i++) {
                    const range = homeRanges[i];
                    if (range && range.test(h)) {
                        const bin = homeBins[i];
                        if (bin) bin.count = bin.count + 1;
                        break;
                    }
                }
            }

            const ii = o.internationalFee;
            if (typeof ii === "number") {
                for (let i = 0; i < intlRanges.length; i++) {
                    const range = intlRanges[i];
                    if (range && range.test(ii)) {
                        const bin = intlBins[i];
                        if (bin) bin.count = bin.count + 1;
                        break;
                    }
                }
            }
        }

        return res.status(200).json({
            home: { feeType: "home", bins: homeBins },
            international: { feeType: "international", bins: intlBins },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch fee histogram" });
    }
});
export default router;
