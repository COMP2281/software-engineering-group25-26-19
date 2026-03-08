export type UniversityDistributionItem = {
    name: string;
    courses: number;
};

export type LevelDistributionItem = {
    name: string; // "Undergraduate" | "Postgraduate" | "Other"
    value: number;
};

export type StudyModeItem = {
    name: string; // "Full-time", "Part-time", etc.
    value: number;
};

export type PriceHistoryItem = {
    year: string;
    home: number;
    international: number;
};
