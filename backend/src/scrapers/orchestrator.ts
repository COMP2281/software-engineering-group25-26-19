import { spawn, ChildProcess } from "child_process";
import path from "path";
import prisma from "../db";

let activeChildProcess: ChildProcess | null = null;
let activeScrapeId: string | null = null;

// Handle termination signals to ensure child processes are killed
async function handleSignal(signal: NodeJS.Signals) {
    console.log(
        `[Orchestrator] Received ${signal}. Terminating child process...`,
    );
    if (activeChildProcess) {
        activeChildProcess.kill(signal);
        console.log(
            `[Orchestrator] Sent ${signal} to child process ${activeChildProcess?.pid}`,
        );
    } else {
        console.log("[Orchestrator] No active child process to terminate.");
    }

    if (activeScrapeId) {
        console.log(
            `[Orchestrator] Marking scrape ${activeScrapeId} as FAILED due to termination.`,
        );
        try {
            await prisma.scrape.update({
                where: { id: activeScrapeId },
                data: {
                    status: "FAILED",
                    finishedAt: new Date(),
                },
            });
            console.log(`[Orchestrator] Scrape ${activeScrapeId} updated.`);
        } catch (error) {
            console.error(
                `[Orchestrator] Failed to update scrape ${activeScrapeId}:`,
                error,
            );
        }
    }

    process.exit(0);
}

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));

async function runOrchestrator() {
    console.log("=== Scraper Orchestrator Started ===");

    // 1. Check valid UCAS scrape history
    const lastUcasScrape = await prisma.scrape.findFirst({
        where: {
            type: "UCAS",
            status: "COMPLETED",
        },
        orderBy: {
            finishedAt: "desc",
        },
    });

    const now = new Date();
    const millisInDay = 24 * 60 * 60 * 1000;
    const daysSinceLastScrape =
        lastUcasScrape && lastUcasScrape.finishedAt
            ? (now.getTime() - lastUcasScrape.finishedAt.getTime()) /
              millisInDay
            : Infinity;

    console.log(
        `Last UCAS scrape was ${daysSinceLastScrape.toFixed(2)} days ago.`,
    );

    // 2. Run UCAS scraper if needed (> 7 days or never)
    if (daysSinceLastScrape > 7) {
        console.log("Starting UCAS job...");
        const ucasScrape = await prisma.scrape.create({
            data: {
                type: "UCAS",
                startedAt: new Date(),
                status: "RUNNING",
            },
        });

        // Set active scrape ID for signal handling
        activeScrapeId = ucasScrape.id;

        const ucasStatus = await runScript("src/ucas_job.ts");

        // Clear active scrape ID as we are handling completion now
        activeScrapeId = null;

        await prisma.scrape.update({
            where: { id: ucasScrape.id },
            data: {
                finishedAt: new Date(),
                status: ucasStatus === 0 ? "COMPLETED" : "FAILED",
            },
        });

        if (ucasStatus !== 0) {
            console.error(
                "UCAS job failed. Proceeding to manager anyway, but marking UCAS as failed.",
            );
        } else {
            console.log("UCAS job completed successfully.");
        }
    } else {
        console.log("Skipping UCAS job (recent enough).");
    }

    // 3. Run Manager (Uni Scraper)
    console.log("Starting Manager...");

    // Create a scrape record for the manager/university scrape
    const uniScrape = await prisma.scrape.create({
        data: {
            type: "UNIVERSITY",
            startedAt: new Date(),
            status: "RUNNING",
        },
    });

    // Set active scrape ID for signal handling
    activeScrapeId = uniScrape.id;

    // Pass through CLI args from process.argv
    // process.argv[0] is node, [1] is script, [2...] are args
    const args = process.argv.slice(2);

    // If no filters provided, fetch all universities to ensure full coverage
    if (args.length === 0) {
        console.log(
            "No filters provided. Fetching all universities from DB for comprehensive scrape.",
        );
        const allUnis = await prisma.university.findMany({
            select: { id: true },
        });
        const ids = allUnis.map((u) => u.id).join(",");
        if (ids) {
            args.push(`--universityIds=${ids}`);
        } else {
            console.warn("No universities found in DB.");
        }
    }

    const managerStatus = await runScript("src/scrapers/manager.ts", args);

    // Clear active scrape ID as we are handling completion now
    activeScrapeId = null;

    await prisma.scrape.update({
        where: { id: uniScrape.id },
        data: {
            finishedAt: new Date(),
            status: managerStatus === 0 ? "COMPLETED" : "FAILED",
        },
    });

    console.log(`Manager finished with code ${managerStatus}.`);
    process.exit(managerStatus);
}

function runScript(
    scriptRelativePath: string,
    args: string[] = [],
): Promise<number> {
    return new Promise((resolve, _reject) => {
        const scriptPath = path.resolve(process.cwd(), scriptRelativePath);
        // We use 'npx ts-node' to run the TS file.
        // Assuming we are running this inside a node environment where npx is available
        const child = spawn("npx", ["ts-node", scriptPath, ...args], {
            stdio: "inherit",
            cwd: process.cwd(),
            env: { ...process.env, FORCE_COLOR: "1" }, // Preserve colors
        });

        // Track the active child process
        activeChildProcess = child;

        child.on("close", (code) => {
            if (activeChildProcess === child) {
                activeChildProcess = null;
            }
            resolve(code ?? 0);
        });

        child.on("error", (err) => {
            console.error(`Failed to start script ${scriptPath}:`, err);
            if (activeChildProcess === child) {
                activeChildProcess = null;
            }
            resolve(1);
        });
    });
}

// Run if main
if (require.main === module) {
    runOrchestrator().catch((err) => {
        console.error("Orchestrator encountered error:", err);
        process.exit(1);
    });
}
