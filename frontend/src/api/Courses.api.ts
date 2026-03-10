import type { Course, CourseFiltersResponse, CourseDetailsResponse } from "./Courses.types";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, options);

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Request failed: ${res.status} ${text}`);
    }

    return (await res.json()) as T;
}

/** GET /api/courses */

type GetCoursesParams = {
    page: number;
    pageSize: number;
    q?: string;
    universityIds?: string;
    level?: string;
    minFee?: number;
    maxFee?: number;
    feeType?: string;
};

export type PagedCoursesResponse = {
    data: Course[];
    totalPages: number;
    page: number;
    pageSize: number;
};

export async function getCourses(
    params: GetCoursesParams,
): Promise<PagedCoursesResponse> {
    const { page, pageSize, q, universityIds, level, minFee, maxFee, feeType } =
        params;

    const query = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
    });

    if (q && q.trim()) {
        query.append("q", q);
    }

    if (universityIds && universityIds.trim()) {
        query.append("universityIds", universityIds);
    }

    if (level && level !== "all") {
        query.append("level", level);
    }

    if (feeType) {
        query.append("feeType", feeType);
    }

    if (minFee) {
        query.append("minFee", String(minFee));
    }

    if (maxFee) {
        query.append("maxFee", String(maxFee));
    }

    return fetchJson<PagedCoursesResponse>(`/api/courses?${query}`);
}

/** GET /api/courses/:id */
export async function getCourseById(
    id: string,
): Promise<CourseDetailsResponse> {
    return fetchJson<CourseDetailsResponse>(`/api/courses/${id}`);
}

export async function getCourseFilters(): Promise<CourseFiltersResponse> {
    return fetchJson<CourseFiltersResponse>("/api/courses/filters");
}
