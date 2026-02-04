import { Router } from "express";
import prisma from "../db";

const router = Router();

// GET /courses? q=&universityId=&year=&studyMode=&page=&limit=&sort=&order=
router.get("/", async (req, res) => {
    try {
        const { q, universityId, year, studyMode, page = "1", limit = "20", sort = "title", order = "asc" } = req.query as Record<string, string>;

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

        if (universityId) andConditions.push({ universityId });

        if (year) andConditions.push({ options: { some: { year: parseInt(year, 10) } } });
        if (studyMode) andConditions.push({ options: { some: { studyMode } } });

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
