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
    // Inside src/scrapers/config.ts

    "University of Bath": {
        strategy: "CUSTOM_HTML",
        adapterName: "BathAdapter",
        centralFeeUrls: {
            ug: "https://www.bath.ac.uk/corporate-information/tuition-fees-for-undergraduate-students-starting-in-2026/",
            pg:[
                "https://www.bath.ac.uk/corporate-information/faculty-of-engineering-design-taught-postgraduate-tuition-fees-2026-27/",
                "https://www.bath.ac.uk/corporate-information/faculty-of-humanities-social-sciences-taught-postgraduate-tuition-fees-2026-27/",
                "https://www.bath.ac.uk/corporate-information/faculty-of-science-taught-postgraduate-tuition-fees-2026-27/",
                "https://www.bath.ac.uk/corporate-information/school-of-management-taught-postgraduate-tuition-fees-2026-27/"
            ]
        }
    },
    "University of Birmingham": {
        strategy: "CUSTOM_HTML",
        adapterName: "BirminghamAdapter",
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