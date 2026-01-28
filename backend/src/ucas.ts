import axios from 'axios';
import { processCourseData } from './services';

// Configuration
const BASE_URL_V2 = "https://services.ucas.com/search/api/v2/courses/search";
const BASE_URL_V3 = "https://services.ucas.com/search/api/v3/courses";
const DEFAULT_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; UCASFetcher/1.0; +https://example.local)"
};

// Types
interface FetchOptions {
    pageSize?: number;
    perRequestTimeout?: number;
    delayBetweenRequests?: number;
    maxRetries?: number;
    hardResultCap?: number;
}

interface UcasSearchBody {
    searchTerm: string;
    filters: {
        academicYearId: string;
        destinations: string[];
        providers: string[];
        schemes: string[];
        ucasTeacherTrainingProvider: boolean;
        degreeApprenticeship: boolean;
        studyTypes: string[];
        subjects: string[];
        qualifications: string[];
        attendanceTypes: string[];
        acceleratedDegrees: boolean;
        entryPoint: any;
        regions: string[];
        vacancy: string;
        startDates: string[];
        higherTechnicalQualifications: boolean;
    };
    options: {
        sort: string[];
        paging: {
            pageNumber: number;
            pageSize: number;
        };
        viewType: string;
    };
    inClearing: boolean;
}

// Helper to create a delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch specific course details
export async function fetchSpecificCourse(courseId: string, academicYearId: string = "2026") {
    const url = `${BASE_URL_V3}?courseDetailsRequest.coursePrimaryId=${courseId}&courseDetailsRequest.academicYearId=${academicYearId}`;
    
    try {
        const response = await axios.get(url, { headers: DEFAULT_HEADERS });
        return response.data;
    } catch (error) {
        console.error(`Error fetching course ${courseId}:`, error);
        throw error;
    }
}

// Fetch all courses based on filters
export async function fetchAllUcasCourses(
    providers: string[] = ["Durham University"],
    opts: FetchOptions = {}
) {
    const {
        pageSize = 200,
        perRequestTimeout = 30000,
        delayBetweenRequests = 1000,
        maxRetries = 5,
        hardResultCap = 20000
    } = opts;

    const postBody: UcasSearchBody = {
        searchTerm: "",
        filters: {
            academicYearId: "2026",
            destinations: ["Undergraduate", "Postgraduate"],
            providers: providers,
            schemes: [],
            ucasTeacherTrainingProvider: false,
            degreeApprenticeship: false,
            studyTypes: [],
            subjects: [],
            qualifications: [],
            attendanceTypes: [],
            acceleratedDegrees: false,
            entryPoint: null,
            regions: [],
            vacancy: "",
            startDates: [],
            higherTechnicalQualifications: false
        },
        options: {
            sort: [],
            paging: {
                pageNumber: 1,
                pageSize: pageSize
            },
            viewType: "course"
        },
        inClearing: false
    };

    let allCourses: any[] = [];
    let totalPages = 0;

    // Initial request to get total count
    try {
        console.log("Fetching the first page to get total course count...");
        const response = await axios.post(BASE_URL_V2, postBody, {
            headers: DEFAULT_HEADERS,
            timeout: perRequestTimeout
        });

        const data = response.data;
        const totalCourses = data.information?.courseCounts?.totalCourseCount || 0;

        if (totalCourses === 0) {
            console.log("No courses found or total course count is zero.");
            return [];
        }

        totalPages = Math.ceil(totalCourses / pageSize);
        
        if (hardResultCap) {
            const maxAllowedPages = Math.max(1, Math.ceil(hardResultCap / pageSize));
            if (totalPages > maxAllowedPages) {
                console.log(`Capping total pages from ${totalPages} to ${maxAllowedPages} to avoid deep pagination limits.`);
                totalPages = maxAllowedPages;
            }
        }

        console.log(`Total courses found: ${totalCourses}`);
        console.log(`Total pages to fetch: ${totalPages}`);

        const firstPageCourses = data.courses || [];
        allCourses.push(...firstPageCourses);
        
        // Process first page immediately
        for (const course of firstPageCourses) {
            await processCourseData({ course });
        }
        
        console.log("Page 1 fetched and processed successfully.");

    } catch (error) {
        console.error("Error fetching first page:", error);
        return [];
    }

    // Loop through remaining pages
    for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
        postBody.options.paging.pageNumber = pageNumber;
        console.log(`Fetching page ${pageNumber} of ${totalPages}...`);

        let retries = 0;
        let success = false;

        while (!success && retries < maxRetries) {
            try {
                const response = await axios.post(BASE_URL_V2, postBody, {
                    headers: DEFAULT_HEADERS,
                    timeout: perRequestTimeout
                });

                const pageCourses = response.data.courses || [];
                if (pageCourses.length === 0) {
                    console.log(`No courses returned on page ${pageNumber}; stopping early.`);
                    return allCourses;
                }

                allCourses.push(...pageCourses);
                
                // Process courses
                for (const course of pageCourses) {
                    await processCourseData({ course });
                }

                success = true;
                console.log(`Page ${pageNumber} processed. Total courses so far: ${allCourses.length}`);

                if (delayBetweenRequests > 0) {
                    await delay(delayBetweenRequests);
                }

            } catch (error) {
                retries++;
                console.error(`Error fetching page ${pageNumber} (Attempt ${retries}/${maxRetries}):`, error);
                if (retries >= maxRetries) {
                    console.error(`Failed to fetch page ${pageNumber} after ${maxRetries} attempts.`);
                } else {
                    const backoff = 1500 * Math.pow(1.5, retries - 1);
                    await delay(backoff);
                }
            }
        }
    }

    console.log(`Successfully fetched and processed all ${allCourses.length} courses.`);
    return allCourses;
}

// Main execution block if run directly
if (require.main === module) {
    fetchAllUcasCourses()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
