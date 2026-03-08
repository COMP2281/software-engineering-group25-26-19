// src/scrapers/interfaces.ts

export interface ScrapedFees {
    homeFee: number | null;
    internationalFee: number | null;
    scotlandFee?: number | null;
}

// NEW: Context object to tell the scraper exactly what option it's looking for
export interface ScrapeContext {
    optionId: string;
    courseTitle: string;
    studyMode: string | null; // e.g., "Full-time", "Part-time"
    year: number;             // e.g., 2026
    duration: string | null;  // e.g., "3 Years", "4 Years"
    outcomeQualification?: string | null; // e.g., "MSc", "PGDip", "MLitt"
}

// NEW: Links the scraped fees back to the specific option ID
export interface OptionScrapeResult extends ScrapedFees {
    optionId: string;
}

export interface IScraperAdapter {
    /**
     * Takes a single course URL and an array of options (contexts) to scrape.
     * The adapter should load the URL once, and parse the HTML differently for each context.
     */
    scrapeCourse?(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]>;

    scrapeBulk?(universityName: string, bulkUrl: string): Promise<void>;
}

export type ScraperStrategy = 'GENERIC_HTML' | 'CUSTOM_HTML' | 'BULK_PDF' | 'HYBRID';

export interface UniversityScraperConfig {
    strategy: ScraperStrategy;
    adapterName: string;
    bulkUrl?: string; 
    centralFeeUrls?: {
        ug?: string;
        pg?: string[];
        ugRuk?: string;
        ugIntl?: string;
        [key: string]: any;
    }; 
}
