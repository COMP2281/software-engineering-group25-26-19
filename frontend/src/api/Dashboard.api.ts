import type {
    DashboardSummary,
    FeeHistogramResponse,
    ScrapeStatus,
} from "./Dashboard.types";

const USE_MOCK = true;

// Mock data (frontend dev)//
let mockSummary: DashboardSummary = {
    totalCourses: 12480,
    universitiesCovered: 35,
    lastSuccessfulScrapeAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    status: "idle",
    issuesCount: 3,
};

const MOCK_HIST: FeeHistogramResponse = {
    home: {
        feeType: "home",
        bins: [
            { range: "0–5000", count: 12 },
            { range: "5000–7500", count: 48 },
            { range: "7500–9000", count: 310 },
            { range: "9000–10000", count: 820 },
            { range: "10000–12500", count: 190 },
            { range: "12500+", count: 74 },
        ],
    },
    international: {
        feeType: "international",
        bins: [
            { range: "0–10000", count: 6 },
            { range: "10000–15000", count: 30 },
            { range: "15000–20000", count: 120 },
            { range: "20000–25000", count: 460 },
            { range: "25000–30000", count: 220 },
            { range: "30000+", count: 80 },
        ],
    },
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, options);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Request failed: ${res.status} ${text}`.trim());
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return undefined as unknown as T;
    }

    return (await res.json()) as T;
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

// API functions//
/*8.1: dashboard summary GET /api/dashboard/summary*/
export async function getDashboardSummary(): Promise<DashboardSummary> {
    if (USE_MOCK) return mockSummary;
    return fetchJson<DashboardSummary>("/api/dashboard/summary");
}

/* Fee histograms (home + international)  GET /api/dashboard/fee-histogram*/

export async function getFeeHistogram(): Promise<FeeHistogramResponse> {
    if (USE_MOCK) return MOCK_HIST;
    return fetchJson<FeeHistogramResponse>("/api/dashboard/fee-histogram");
}

/*8.2: quick scrape  POST /api/scrape/quick */
export async function quickScrape(): Promise<void> {
    if (USE_MOCK) {
        mockSummary = {
            ...mockSummary,
            status: "running" as ScrapeStatus,
        };

        await sleep(1200);

        mockSummary = {
            ...mockSummary,
            status: "success",
            lastSuccessfulScrapeAt: new Date().toISOString(),
            totalCourses:
                mockSummary.totalCourses + Math.floor(Math.random() * 20),
            issuesCount: Math.max(0, mockSummary.issuesCount - 1),
        };

        return;
    }

    await fetchJson<void>("/api/scrape/quick", { method: "POST" });
}

//8.3: quick export//
export function getExportUrl(): string {
    return "/api/dashboard/export";
}
