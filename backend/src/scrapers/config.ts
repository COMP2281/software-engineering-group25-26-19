// src/scrapers/config.ts

import { UniversityScraperConfig } from './interfaces';

export const ScraperConfig: Record<string, UniversityScraperConfig> = {
    // PDF UNIS MAY NEED FURTHER ADJUSTMENTS TO HANDLE MULTIPLE PDF FILES (i.e: POSTGRAD & UNDERGRAD)
    "University of Cambridge": {
        strategy: "BULK_PDF",
        adapterName: "BulkPdfAdapter",
        bulkUrl: "https://www.undergraduate.study.cam.ac.uk/sites/default/files/publications/undergraduate_tuition_fees_2026-27.pdf"
    },
    "University of Aberdeen": {
        strategy: "BULK_PDF",
        adapterName: "BulkPdfAdapter",
        bulkUrl: "https://www.abdn.ac.uk/media/site/students/documents/UG--Full-time-Tuition-Fees-2026-27.pdf"
    },
    "Cardiff University": {
        strategy: "GENERIC_HTML",
        adapterName: "GenericHtmlAdapter"
    },
    "The University of Edinburgh": {
        strategy: "GENERIC_HTML",
        adapterName: "GenericHtmlAdapter"
    },
    "Durham University": {
        strategy: "GENERIC_HTML",
        adapterName: "GenericHtmlAdapter"
    }
};