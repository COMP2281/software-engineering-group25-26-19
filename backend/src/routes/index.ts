import { Router } from "express";
import coursesRouter from "./courses";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import scraperRouter from "./scraper";
import excelRouter from "./excel";
import { requireAuth } from "../middleware/auth";
import visualisationRouter from "./visualisation";

const router = Router();

// Health check
router.get("/health", (_req, res) => {
    res.send({ status: "API is healthy" });
});

// Auth routes (public)
router.use("/auth", authRouter);

// Protected routes
router.use("/courses", requireAuth, coursesRouter);
router.use("/visualisation", requireAuth, visualisationRouter);
router.use("/dashboard", requireAuth, dashboardRouter);
router.use("/scraper", requireAuth, scraperRouter);
router.use("/excel", requireAuth, excelRouter);

export default router;
