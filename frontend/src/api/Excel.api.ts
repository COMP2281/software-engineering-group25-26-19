export interface ExcelExportParams {
    q?: string;
    courseIds?: string[];
    universityIds?: string[];
    year?: number;
    minFee?: number;
    maxFee?: number;
    feeType?: 'home' | 'international';
    level?: 'undergraduate' | 'postgraduate' | 'all';
}

export function getExcelExportUrl(params?: ExcelExportParams): string {
    const searchParams = new URLSearchParams();

    if (params) {

        if (params.courseIds && params.courseIds.length > 0) {
            searchParams.append('courseIds', params.courseIds.join(','));
        }

        if (params.q) searchParams.append('q', params.q);
        if (params.universityIds && params.universityIds.length > 0) {
            searchParams.append('universityIds', params.universityIds.join(','));
        }
        if (params.year) searchParams.append('year', params.year.toString());
        if (params.minFee !== undefined) searchParams.append('minFee', params.minFee.toString());
        if (params.maxFee !== undefined) searchParams.append('maxFee', params.maxFee.toString());
        if (params.feeType) searchParams.append('feeType', params.feeType);
        if (params.level) searchParams.append('level', params.level);
    }

    return `/api/excel/courses?${searchParams.toString()}`;
}
