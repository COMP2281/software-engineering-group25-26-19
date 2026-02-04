import type { Course } from "./Courses.types";

const USE_MOCK = false;

// Mock data for frontend dev

const MOCK_COURSES: Course[] = [
  {
    id: "ddb48e92-0cd3-5dd4-b4b5-8baaa5a8f21b",
    academicYear: "2026",
    level: "Undergraduate",
    courseTitle: "Accounting and Business",
    provider: "The University of Edinburgh",
    department: "Business School",
    applicationCode: "NN14",
    studyMode: "Full-time",
    durationYears: 4,
    startDate: "14/09/2026",
    ukTuitionFeeYear1GBP: 9790,
  },
  {
    id: "2f6d7c88-1d64-4f59-9c5d-0f1c4b41a9a1",
    academicYear: "2026",
    level: "Undergraduate",
    courseTitle: "Computer Science",
    provider: "University of Manchester",
    department: "Department of Computer Science",
    applicationCode: "G400",
    studyMode: "Full-time",
    durationYears: 3,
    startDate: "14/09/2026",
    ukTuitionFeeYear1GBP: 9250,
  },
  {
    id: "0a3d1bd6-8e25-4a43-b45e-4c1a52c0b0e7",
    academicYear: "2026",
    level: "Undergraduate",
    courseTitle: "Economics",
    provider: "University of Warwick",
    department: "Department of Economics",
    applicationCode: "L100",
    studyMode: "Full-time",
    durationYears: 3,
    startDate: "14/09/2026",
    ukTuitionFeeYear1GBP: 9250,
  },
  {
    id: "9c0f4ad1-2c2b-45bb-8d2f-7a9ef2d3a2b9",
    academicYear: "2026",
    level: "Undergraduate",
    courseTitle: "Mechanical Engineering",
    provider: "University of Bristol",
    department: "Department of Mechanical Engineering",
    applicationCode: "H300",
    studyMode: "Full-time",
    durationYears: 4,
    startDate: "14/09/2026",
    ukTuitionFeeYear1GBP: 9250,
  },
  {
    id: "3b3f6b0c-7f5b-4f49-b8c5-4d8b9f9b0c21",
    academicYear: "2026",
    level: "Undergraduate",
    courseTitle: "Law (LLB)",
    provider: "King's College London",
    department: "The Dickson Poon School of Law",
    applicationCode: "M100",
    studyMode: "Full-time",
    durationYears: 3,
    startDate: "14/09/2026",
    ukTuitionFeeYear1GBP: 9250,
  },
  {
    id: "5f1d2a77-3a1b-4e9e-8a7e-9b8f0c1d2e3f",
    academicYear: "2026",
    level: "Postgraduate",
    courseTitle: "MSc Data Science",
    provider: "University of Glasgow",
    department: "School of Computing Science",
    applicationCode: "N/A",
    studyMode: "Full-time",
    durationYears: 1,
    startDate: "21/09/2026",
    ukTuitionFeeYear1GBP: 12500,
  },
  {
    id: "7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
    academicYear: "2026",
    level: "Postgraduate",
    courseTitle: "MSc Finance",
    provider: "London School of Economics and Political Science",
    department: "Department of Finance",
    applicationCode: "N/A",
    studyMode: "Full-time",
    durationYears: 1,
    startDate: "21/09/2026",
    ukTuitionFeeYear1GBP: 34000,
  },
  {
    id: "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    academicYear: "2026",
    level: "Undergraduate",
    courseTitle: "Psychology",
    provider: "University of Leeds",
    department: "School of Psychology",
    applicationCode: "C800",
    studyMode: "Full-time",
    durationYears: 3,
    startDate: "14/09/2026",
    ukTuitionFeeYear1GBP: 9250,
  },
  {
    id: "8f7e6d5c-4b3a-2f1e-0d9c-8b7a6f5e4d3c",
    academicYear: "2026",
    level: "Undergraduate",
    courseTitle: "Medicine (MBChB)",
    provider: "University of Birmingham",
    department: "Medical School",
    applicationCode: "A100",
    studyMode: "Full-time",
    durationYears: 5,
    startDate: "14/09/2026",
    ukTuitionFeeYear1GBP: 9250,
  },
  {
    id: "4e3d2c1b-0a9f-8e7d-6c5b-4a3f2e1d0c9b",
    academicYear: "2026",
    level: "Postgraduate",
    courseTitle: "MSc Cyber Security",
    provider: "University of Southampton",
    department: "School of Electronics and Computer Science",
    applicationCode: "N/A",
    studyMode: "Full-time",
    durationYears: 1,
    startDate: "21/09/2026",
    ukTuitionFeeYear1GBP: 14000,
  },
];


async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  
    const res = await fetch(url, options);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** GET /api/courses */

type GetCoursesParams = {
  page: number;
  pageSize: number;
};

export type PagedCoursesResponse = {
  data: Course[];
  totalPages: number;
  page: number;
  pageSize: number;
};


export async function getCourses(
  params: GetCoursesParams
): Promise<PagedCoursesResponse> {

  const { page, pageSize } = params;

  if (USE_MOCK) {
    await sleep(600);

    const totalPages = Math.ceil(MOCK_COURSES.length / pageSize);

    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const data = MOCK_COURSES.slice(start, end);

    return {
      data,
      totalPages,
      page,
      pageSize,
    };
  }

  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  return fetchJson<PagedCoursesResponse>(`/api/courses?${query}`);
}



/** GET /api/courses/:id */
export async function getCourseById(id: string): Promise<Course | null> {
  if (USE_MOCK) {
    await sleep(300);

    return MOCK_COURSES.find((c) => c.id === id) ?? null;
  }

  return fetchJson<Course>(`/api/courses/${id}`);
}