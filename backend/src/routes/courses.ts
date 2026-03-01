import { Router } from "express";
import prisma from "../db";

const router = Router();

// GET /courses? q=&universityIds=&year=&minFee=&maxFee=&feeType=&level=&page=&limit=&sort=&order=
router.get("/", async (req, res) => {
    try {
        const {
            q,
            universityIds,
            year,
            minFee,
            maxFee,
            feeType = "home",
            level = "all",
            page = "1",
            limit = "20",
            sort = "title",
            order = "asc",
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page || "1", 10));
        const lim = Math.min(100, Math.max(1, parseInt(limit || "20", 10)));
        const skip = (pageNum - 1) * lim;

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

        // Universities: allow multiple ids (comma separated)
        let uniIdsArr: string[] | undefined;
        if (universityIds) uniIdsArr = universityIds.split(",").map(s => s.trim()).filter(Boolean);
        if (uniIdsArr && uniIdsArr.length) {
            andConditions.push({ universityId: { in: uniIdsArr } });
        }

        // Options-level filters (year, studyMode, fee range, level)
        const optionFilters: any[] = [];
        if (year) optionFilters.push({ year: parseInt(year, 10) });

        // Fee range filter (apply to homeFee or internationalFee depending on feeType)
        const min = (minFee !== undefined && minFee !== "") ? parseFloat(minFee as string) : undefined;
        const max = (maxFee !== undefined && maxFee !== "") ? parseFloat(maxFee as string) : undefined;
        if (!isNaN(Number(min)) || !isNaN(Number(max))) {
            const feeField = (feeType === "international") ? "internationalFee" : "homeFee";
            const feeCond: any = {};
            if (!isNaN(Number(min))) feeCond.gte = min;
            if (!isNaN(Number(max))) feeCond.lte = max;
            optionFilters.push({ [feeField]: feeCond });
        }

        // Level filter: undergraduate if outcomeQualification starts with 'B' (case-insensitive), postgraduate otherwise
        if (level === "undergraduate") {
            optionFilters.push({ outcomeQualification: { startsWith: "B", mode: "insensitive" } });
        } else if (level === "postgraduate") {
            optionFilters.push({ AND: [ { outcomeQualification: { not: null } }, { NOT: { outcomeQualification: { startsWith: "B", mode: "insensitive" } } } ] });
        }

        if (optionFilters.length) {
            const optionWhere = (optionFilters.length === 1) ? optionFilters[0] : { AND: optionFilters };
            andConditions.push({ options: { some: optionWhere } });
        }

        const where = andConditions.length ? { AND: andConditions } : {};

        const total = await prisma.course.count({ where });

        // Safe orderBy: only allow a few keys; default to title
        const orderBy: any = {};
        const sortKey = sort || "title";
        orderBy[sortKey] = (order === "desc") ? "desc" : "asc";

        const data = await prisma.course.findMany({
            where,
            include: { options: true, university: true },
            skip,
            take: lim,
            orderBy,
        });

        return res.status(200).json({ data, page: pageNum, limit: lim, total, totalPages: Math.ceil(total / lim) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch courses" });
    }
});

// GET /courses/filters - returns available filter options (universities and fee ranges)
router.get("/filters", async (_req, res) => {
    try {
        const universities = await prisma.university.findMany({ orderBy: { name: "asc" } });

        const homeAgg = await prisma.courseOption.aggregate({ _min: { homeFee: true }, _max: { homeFee: true } });
        const intlAgg = await prisma.courseOption.aggregate({ _min: { internationalFee: true }, _max: { internationalFee: true } });

        return res.status(200).json({
            universities,
            fees: {
                home: { min: homeAgg._min.homeFee ?? null, max: homeAgg._max.homeFee ?? null },
                international: { min: intlAgg._min.internationalFee ?? null, max: intlAgg._max.internationalFee ?? null },
            },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch filters" });
    }
});

// GET /courses/:id  (id or ucasCourseId)
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const course = await prisma.course.findFirst({
            where: { OR: [{ id }, { ucasCourseId: id }] },
            include: { options: true, university: true },
        });

        if (!course) return res.status(404).json({ error: "Course not found" });

        return res.status(200).json({ data: course });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch course" });
    }
});



export default router;
