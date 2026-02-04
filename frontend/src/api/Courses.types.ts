export type Course = {
    id: string;
    academicYear: string;
    level: "Undergraduate" | "Postgraduate";
    courseTitle: string;
    provider: string;
    department: string;
    applicationCode: string;
    studyMode: string;
    durationYears: number;
    startDate: string;
    ukTuitionFeeYear1GBP: number;
};

export type CoursesResponse = Course[];
