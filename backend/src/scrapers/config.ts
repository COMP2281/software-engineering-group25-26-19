// src/scrapers/config.ts

import { UniversityScraperConfig } from './interfaces';

export const ScraperConfig: Record<string, UniversityScraperConfig> = {
    "University of Cambridge": {
        strategy: "HYBRID",
        adapterName: "CambridgeAdapter",
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
    "University of Bristol": {
        strategy: "CUSTOM_HTML",
        adapterName: "BristolAdapter"
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
        strategy: "CUSTOM_HTML",
        adapterName: "EdinburghAdapter"
    },
    "Durham University": {
        strategy: "GENERIC_HTML",
        adapterName: "GenericHtmlAdapter"
    },
    "University of Glasgow": {
        strategy: "CUSTOM_HTML",
        adapterName: "GlasgowAdapter",
        centralFeeUrls: {
            ugRuk: "https://www.gla.ac.uk/undergraduate/fees/ukfees/",
            ugIntl: "https://www.gla.ac.uk/undergraduate/fees/intlfees/"
        }
    }
};