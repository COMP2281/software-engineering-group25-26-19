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

export async function startScraper(courseId?: string): Promise<ScraperStartResponse> {
    const res = await fetch('/api/scraper/start', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ courseId }),
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
