// src/scrapers/interfaces.ts

export interface ScrapedFees {
    homeFee: number | null;
    internationalFee: number | null;
    scotlandFee?: number | null;
}

export interface IScraperAdapter {
    /**
     * Used for INDIVIDUAL_HTML or CUSTOM_HTML strategies.
     * Takes a single course URL and returns the fees.
     */
    scrapeCourse?(courseUrl: string, courseTitle?: string): Promise<ScrapedFees>;

    /**
     * Used for BULK_PDF strategies.
     * Takes the university name and the bulk PDF URL, and updates the DB internally.
     */
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
    }; 
}