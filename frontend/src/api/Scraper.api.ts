export interface ScraperStatusResponse {
    status: 'idle' | 'running';
    pid?: number;
    startTime?: string;
}

export interface ScraperStartResponse {
    message: string;
    pid: number;
    status: 'running';
}

export interface ScraperStartOptions {
    unis?: string[];
    courses?: string[]; // Kept for backward compat but effectively ignored or needs handling
    q?: string;
    year?: number;
    minFee?: number;
    maxFee?: number;
    feeType?: string;
    level?: string;
}

export async function startScraper(options: ScraperStartOptions = {}): Promise<ScraperStartResponse> {
    const res = await fetch('/api/scraper/start', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(options),
    });
    
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to start scraper');
    }
    
    return res.json();
}

export async function getScraperStatus(): Promise<ScraperStatusResponse> {
    const res = await fetch('/api/scraper/status');
    if (!res.ok) {
        throw new Error('Failed to fetch scraper status');
    }
    return res.json();
}

export async function stopScraper(): Promise<void> {
    const res = await fetch('/api/scraper/stop', {
        method: 'POST'
    });
    
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to stop scraper');
    }
}
