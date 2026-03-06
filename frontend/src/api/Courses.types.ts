export type University = {
  id: string;
  name: string;
  ukprn: string;
  address: {
    line1: string;
    line2: string;
    line3: string;
    line4: string;
    postcode: string;
    latitude: number;
    longitude: number;
    region: {
      id: string;
      caption: string;
      mappedCaption: string;
    };
    country: {
      id: string;
      caption: string;
      mappedCaption: string;
    };
  };
  website: string;
  logoUrl: string;
};

export type CourseOption = {
  id: string;
  courseId: string;
  year: number;
  studyMode: string | null;
  duration: string | null;
  startDate: string | null;
  homeFee: number | null;
  internationalFee: number | null;
  aLevelGrade1: string | null;
  aLevelSubject1: string | null;
  aLevelGrade2: string | null;
  aLevelSubject2: string | null;
  aLevelGrade3: string | null;
  aLevelSubject3: string | null;
  aLevelGrade4: string | null;
  aLevelSubject4: string | null;
  outcomeQualification: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Course = {
  id: string;
  ucasCourseId: string;
  title: string;
  applicationCode: string | null;
  summary: string;
  courseUrl: string | null;
  universityId: string;
  options: CourseOption[];
  university: University;
};

export type CoursesResponse = Course[];

export type CoursesFilters = {
  q?: string;
  universityId?: string;
  year?: string;
  studyMode?: string;
  sort: string;
  order: "asc" | "desc";
};

export interface UniversityFilterOption {
  id: string;
  name: string;
}

export interface CourseFiltersResponse {
  universities: UniversityFilterOption[];
  fees: {
    home: {
      min: number | null;
      max: number | null;
    };
    international: {
      min: number | null;
      max: number | null;
    };
  };
}

export interface AnalyticsCourse {
  id: string;
  title: string;
  university: { name: string };
  options: {
    homeFee: number | null;
    internationalFee: number | null;
    outcomeQualification: string | null;
  }[];
}