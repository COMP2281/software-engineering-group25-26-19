import { Router } from "express";
import coursesRouter from "./courses";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";

const router = Router();

// Health
router.get("/health", (_req, res) => {
    res.send({ status: "API is healthy" });
});

// Mount sub-routers
router.use("/courses", coursesRouter);
router.use("/auth", authRouter);
// Dashboard
router.use("/dashboard", dashboardRouter);

export default router;
