import { Router, Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";

const router = Router();

// Keep track of the running scraper instance
let scraperProcess: ChildProcess | null = null;

// POST /api/scraper/start
// Starts the scraper in a background process
router.post("/start", (req: Request, res: Response): void => {
    if (scraperProcess) {
        res.status(409).json({
            message: "Scraper is already running",
            pid: scraperProcess.pid,
        });
        return;
    }

    const { courseId } = req.body;

    // Determine the script path
    const scriptPath = path.resolve(__dirname, "../../src/htmlscraper.ts");

    // Prepare arguments (mock interface for now as requested)
    const args = [];
    if (courseId) {
        args.push(courseId);
    }

    // Spawn the detached process
    // Using 'ts-node' for execution in this dev environment.
    // In strict production, you'd use 'node' and the build output path.
    const child = spawn("npx", ["ts-node", scriptPath, ...args], {
        detached: true, // Allows the child to run independently
        stdio: "ignore", // Ignore stdio to assume it runs in background (or pipe if you want logs)
        cwd: process.cwd(), // Ensure it runs from the project root
    });

    if (!child.pid) {
        res.status(500).json({ message: "Failed to spawn scraper process" });
        return;
    }

    scraperProcess = child;

    // Unreference the child process so the parent can exit independently if needed,
    // although in an Express server we usually keep running.
    child.unref();

    // Listen for exit to clear the variable
    child.on("exit", (code, signal) => {
        console.log(
            `Scraper process exited with code ${code} and signal ${signal}`,
        );
        scraperProcess = null;
    });

    child.on("error", (err) => {
        console.error("Failed to start scraper subprocess:", err);
        scraperProcess = null;
    });

    res.status(202).json({
        message: "Scraper started in background",
        pid: child.pid,
        status: "running",
    });
});

// GET /api/scraper/status
// Check if the scraper is running
router.get("/status", (_req: Request, res: Response) => {
    if (scraperProcess) {
        res.json({
            status: "running",
            pid: scraperProcess.pid,
            startTime: "Not tracked in this simple mock", // You could store Date.now() in a variable above
        });
    } else {
        res.json({ status: "idle" });
    }
});

// POST /api/scraper/stop
// Force kill the scraper
router.post("/stop", (_req: Request, res: Response) => {
    if (!scraperProcess) {
        res.status(400).json({ message: "No scraper is currently running" });
        return;
    }

    const killed = scraperProcess.kill("SIGTERM");
    if (killed) {
        scraperProcess = null;
        res.json({ message: "Scraper process terminated" });
    } else {
        res.status(500).json({ message: "Failed to kill scraper process" });
    }
});

export default router;
