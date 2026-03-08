// src/utils/Logger.ts

import * as fs from 'fs';
import * as path from 'path';

class LoggerService {
    private logFilePath: string;
    
    // Statistics counters
    public stats = {
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0
    };

    constructor() {
        const logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }

        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        this.logFilePath = path.join(logDir, `scrape-${timestamp}.log`);
        
        this.writeLine(`=== Log Started at ${new Date().toISOString()} ===`);
    }

    /**
     * Logs to both Console and File.
     * Use this for high-level progress updates.
     */
    public info(message: string) {
        console.log(message);
        this.writeLine(`[INFO] ${message}`);
    }

    /**
     * Logs to File ONLY.
     * Use this for verbose debugging (HTML parsing details, regex matches).
     */
    public debug(message: string) {
        // Uncomment the next line if you want debugs in console too
        // console.log(`[DEBUG] ${message}`); 
        this.writeLine(`[DEBUG] ${message}`);
    }

    /**
     * Logs Errors to Console (Red) and File.
     */
    public error(message: string, error?: any) {
        console.error(`\x1b[31m[ERROR] ${message}\x1b[0m`); // Red color for console
        const errorDetails = error ? ` | Stack: ${error instanceof Error ? error.stack : JSON.stringify(error)}` : '';
        this.writeLine(`[ERROR] ${message}${errorDetails}`);
    }

    /**
     * Logs a warning to Console (Yellow) and File.
     */
    public warn(message: string) {
        console.warn(`\x1b[33m[WARN] ${message}\x1b[0m`); // Yellow color
        this.writeLine(`[WARN] ${message}`);
    }

    public printSummary() {
        const summary = `
========================================
SCRAPE COMPLETED
========================================
Total Options Processed : ${this.stats.total}
Successful Scrapes      : ${this.stats.success}
Failed Scrapes          : ${this.stats.failed}
Skipped (No URL/Config) : ${this.stats.skipped}
========================================
Log saved to: ${this.logFilePath}
`;
        console.log(summary);
        this.writeLine(summary);
    }

    private writeLine(line: string) {
        const timestamp = new Date().toISOString();
        fs.appendFileSync(this.logFilePath, `[${timestamp}] ${line}\n`);
    }
}

export const Logger = new LoggerService();