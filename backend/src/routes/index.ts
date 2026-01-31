import { Router } from "express";

const router = Router();

// Mock route
router.get("/health", (_req, res) => {
    res.send({ status: "API is healthy" });
});

export default router;
