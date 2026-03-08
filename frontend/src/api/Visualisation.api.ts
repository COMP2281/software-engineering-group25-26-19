import type {
    UniversityDistributionItem,
    LevelDistributionItem,
    StudyModeItem,
    PriceHistoryItem
} from "./Visualisation.types";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, options);

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Request failed: ${res.status} ${text}`);
    }

    return (await res.json()) as T;
}

/** GET /api/visualisation/university-distribution */
export async function getUniversityDistribution(): Promise<UniversityDistributionItem[]> {
    return fetchJson<UniversityDistributionItem[]>("/api/visualisation/university-distribution");
}

/** GET /api/visualisation/level-distribution */
export async function getLevelDistribution(): Promise<LevelDistributionItem[]> {
    return fetchJson<LevelDistributionItem[]>("/api/visualisation/level-distribution");
}

/** GET /api/visualisation/study-modes */
export async function getStudyModes(): Promise<StudyModeItem[]> {
    return fetchJson<StudyModeItem[]>("/api/visualisation/study-modes");
}

/** GET /api/visualisation/subjects */
export async function getSubjects(): Promise<string[]> {
    return fetchJson<string[]>("/api/visualisation/subjects");
}

/** GET /api/visualisation/price-history?subject=... */
export async function getPriceHistory(subject: string): Promise<PriceHistoryItem[]> {
    const query = new URLSearchParams({ subject });
    return fetchJson<PriceHistoryItem[]>(`/api/visualisation/price-history?${query}`);
}
