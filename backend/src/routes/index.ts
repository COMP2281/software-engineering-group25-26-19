import { Router } from "express";
import coursesRouter from "./courses";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Health
router.get("/health", (_req, res) => {
    res.send({ status: "API is healthy" });
});

// Mount sub-routers
// Apply authentication middleware to all routes except public ones (health, auth login)
router.use("/courses", requireAuth, coursesRouter);
router.use("/auth", authRouter);
// Dashboard
router.use("/dashboard", requireAuth, dashboardRouter);

export default router;
