import requests
import time
import math
import json
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

def _create_session(max_retries: int = 5, backoff_factor: float = 1.5) -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=max_retries,
        connect=max_retries,
        read=max_retries,
        status=max_retries,
        backoff_factor=backoff_factor,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("POST", "GET"),
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session

def fetch_specific_course(course_id: str, academic_year_id: str = "2026"):
    api_url = f"https://services.ucas.com/search/api/v3/courses?courseDetailsRequest.coursePrimaryId={course_id}&courseDetailsRequest.academicYearId={academic_year_id}"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        # User agent in case the service is picky about clients
        "User-Agent": "Mozilla/5.0 (compatible; UCASFetcher/1.0; +https://example.local)"
    }

    response = _create_session().get(api_url, headers=headers)
    response.raise_for_status()
    return response.json()

def fetch_all_ucas_courses(page_size: int = 200, per_request_timeout: int = 30, delay_between_requests: float = 1.0, max_retries: int = 5, backoff_factor: float = 1.5, hard_result_cap: int | None = 20000):
    api_url = "https://services.ucas.com/search/api/v2/courses/search?fields=courses(id,academicYearId,applicationCode,subjects(caption),courseTitle,routingData(destination(caption),scheme(caption)),provider(id,name,logoUrl,providerSort,institutionCode),options(id,outcomeQualification(caption),duration,durationRange(min,max),studyMode,startDate,location,academicEntryRequirements(qualifications,ucasTariffPointsMin,ucasTariffPointsMax,ucasTariffPointsDisplayMin,ucasTariffPointsDisplayMax),features)),information(postcodeLookup,courseCounts(perProviderCourseCountsByDestination,totalCourseCount,totalProviderCount,ucasTeacherTrainingProvider,degreeApprenticeship,higherTechnicalQualifications,providers,schemes,subjects,startDates,studyTypes,attendanceTypes,acceleratedDegrees,qualifications,entryPoints,allFilters),paging)"
    
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        # User agent in case the service is picky about clients
        "User-Agent": "Mozilla/5.0 (compatible; UCASFetcher/1.0; +https://example.local)"
    }

    post_body = {
        "searchTerm": "",
        "filters": {
            "academicYearId": "2026",
            "destinations": ["Undergraduate"],
            "providers": [
                "University of Aberdeen",
                "University of Bath",
                "University of Birmingham",
                "University of Bristol",
                "University of Cambridge",
                "Cardiff University",
                "Durham University",
                "The University of Edinburgh",
                "University of Exeter",
                "University of Glasgow",
                "Imperial College London",
                "King's College London, University of London (KCL)",
                "Lancaster University",
                "University of Leeds",
                "University of Liverpool",
                "Loughborough University",
                "London School of Economics and Political Science, University of London (LSE)",
                "University of Manchester",
                "Newcastle University",
                "Northumbria University, Newcastle",
                "University of Nottingham",
                "University of Oxford",
                "Queen Mary University of London",
                "Queen's University Belfast",
                "Royal Holloway, University of London",
                "University of Sheffield",
                "SOAS University of London",
                "University of Southampton",
                "University of St Andrews",
                "University of Sunderland",
                "University of Surrey",
                "University of Sussex",
                "UCL (University College London)",
                "University of Warwick",
                "University of York"
            ],
            "schemes": [],
            "ucasTeacherTrainingProvider": False,
            "degreeApprenticeship": False,
            "studyTypes": [],
            "subjects": [],
            "qualifications": [],
            "attendanceTypes": [],
            "acceleratedDegrees": False,
            "entryPoint": None,
            "regions": [],
            "vacancy": "",
            "startDates": [],
            "higherTechnicalQualifications": False
        },
        "options": {
            "sort": [],
            "paging": {
                "pageNumber": 1,
                "pageSize": page_size
            },
            "viewType": "course"
        },
        "inClearing": False
    }

    all_courses = []
    session = _create_session(max_retries=max_retries, backoff_factor=backoff_factor)
    
    try:
        print("Fetching the first page to get total course count...")
        response = session.post(api_url, headers=headers, json=post_body, timeout=per_request_timeout)
        response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)
        data = response.json()
        
        total_courses = data.get("information", {}).get("courseCounts", {}).get("totalCourseCount", 0)
        if total_courses == 0:
            print("No courses found or total course count is zero.")
            return []

        page_size = post_body["options"]["paging"]["pageSize"]
        total_pages = math.ceil(total_courses / page_size)
        # Many search APIs enforce a deep pagination cap (often ~10k results).
        # If configured, cap the total pages accordingly to avoid 400 errors when paging too deep.
        if hard_result_cap is not None:
            max_allowed_pages = max(1, math.ceil(hard_result_cap / page_size))
            if total_pages > max_allowed_pages:
                print(
                    f"Capping total pages from {total_pages} to {max_allowed_pages} to avoid deep pagination limits."
                )
                total_pages = max_allowed_pages
        
        print(f"Total courses found: {total_courses}")
        print(f"Total pages to fetch: {total_pages}")

        # Add the courses from the first page
        all_courses.extend(data.get("courses", []))
        print("Page 1 fetched successfully.")

        # Loop through the rest of the pages
        for page_number in range(2, total_pages + 1):
            post_body["options"]["paging"]["pageNumber"] = page_number
            
            print(f"Fetching page {page_number} of {total_pages}...")
            
            response = session.post(api_url, headers=headers, json=post_body, timeout=per_request_timeout)
            response.raise_for_status()
            page_data = response.json()
            
            page_courses = page_data.get("courses", [])
            if not page_courses:
                print(f"No courses returned on page {page_number}; stopping early.")
                break
            all_courses.extend(page_courses)
            print(len(all_courses))
            
            # add a delay to avoid rate limiting
            if delay_between_requests and delay_between_requests > 0:
                time.sleep(delay_between_requests)

        print(f"Successfully fetched all {len(all_courses)} courses.")
        return all_courses

    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if getattr(e, "response", None) is not None else "unknown"
        print(f"HTTP error occurred (status {status}): {e}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"Network error occurred: {e}")
        return None

def save_courses_to_json(courses, filename: str = "ucas_courses.json") -> None:
    try:
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(courses, f, ensure_ascii=False, indent=2)
        print(f"Saved {len(courses)} courses to '{filename}'.")
    except OSError as e:
        print(f"Failed to save courses to '{filename}': {e}")

def main():
    courses = fetch_all_ucas_courses()
    # only extract IDs
    course_ids = [course.get("id") for course in courses] if courses else []
    # Save to JSON if fetch succeeded (even if empty list)
    if courses is not None:
        save_courses_to_json(course_ids, filename="ucas_ids.json")

        

def test():
    data = fetch_specific_course("d323774d-237f-4237-8986-0fdbf6b12573")
    print(data.get("academicYearsInformation"))
    print(data.get("course").get("options")[0].get("courseFees"))

if __name__ == "__main__":
    main()