import { useState, useEffect, useRef } from "react";
import { getCourses } from "../api/Courses.api";
import type { Course } from "../api/Courses.types";
import "./Visualisation.css";

export default function Visualisation() {
    const [courseA, setCourseA] = useState<Course | null>(null);
    const [courseB, setCourseB] = useState<Course | null>(null);

    return (
        <main className="mainContent visualisationContainer">
            <div className="visualisationHeader">
                <h1 className="visualisationTitle">Visualisation & Comparison</h1>
                <p className="visualisationSubtitle">
                    Select two courses below to compare their details side by side.
                </p>
            </div>

            <div className="comparisonArea">
                <CourseSlot
                    label="Course A"
                    course={courseA}
                    onSelect={setCourseA}
                    onRemove={() => setCourseA(null)}
                />
                <CourseSlot
                    label="Course B"
                    course={courseB}
                    onSelect={setCourseB}
                    onRemove={() => setCourseB(null)}
                />
            </div>
        </main>
    );
}

interface CourseSlotProps {
    label: string;
    course: Course | null;
    onSelect: (course: Course) => void;
    onRemove: () => void;
}

function CourseSlot({ label, course, onSelect, onRemove }: CourseSlotProps) {
    if (course) {
        return <CourseDetailsCard course={course} onRemove={onRemove} />;
    }

    return <CourseSearch label={label} onSelect={onSelect} />;
}

interface CourseSearchProps {
    label: string;
    onSelect: (course: Course) => void;
}

function CourseSearch({ label, onSelect }: CourseSearchProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [results, setResults] = useState<Course[]>([]);
    const [loading, setLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (searchTerm.trim().length < 2) {
                setResults([]);
                setShowDropdown(false);
                return;
            }

            setLoading(true);
            try {
                const res = await getCourses({
                    page: 1,
                    pageSize: 10,
                    q: searchTerm,
                });
                setResults(res.data);
                setShowDropdown(true);
            } catch (err) {
                console.error("Failed to fetch courses for search", err);
            } finally {
                setLoading(false);
            }
        }, 500); // 500ms debounce

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setShowDropdown(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="courseSlot searchArea" ref={dropdownRef}>
            <div className="searchIconWrapper">
                <i className="bi bi-search"></i>
            </div>
            <div className="searchInstructions">Search for {label}</div>
            <input
                type="text"
                className="courseSearchInput"
                placeholder="Type a course title or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => {
                    if (results.length > 0) setShowDropdown(true);
                }}
            />

            {loading && (
                <div style={{ marginTop: "16px" }}>
                    <div className="spinner"></div>
                </div>
            )}

            {showDropdown && results.length > 0 && !loading && (
                <div className="searchResultsDropdown">
                    {results.map((c) => (
                        <div
                            key={c.id}
                            className="searchResultItem"
                            onClick={() => {
                                onSelect(c);
                                setSearchTerm("");
                                setShowDropdown(false);
                            }}
                        >
                            <div className="searchResultTitle">{c.title} {c.applicationCode ? `(${c.applicationCode})` : ""}</div>
                            <div className="searchResultUni">{c.university?.name || "Unknown University"}</div>
                        </div>
                    ))}
                </div>
            )}

            {showDropdown && results.length === 0 && searchTerm.trim().length >= 2 && !loading && (
                <div className="searchResultsDropdown" style={{ padding: "16px", color: "var(--text-secondary)" }}>
                    No courses found matching "{searchTerm}"
                </div>
            )}
        </div>
    );
}

interface CourseDetailsCardProps {
    course: Course;
    onRemove: () => void;
}

function CourseDetailsCard({ course, onRemove }: CourseDetailsCardProps) {
    // Use the first option as the default to display details
    const option = course.options && course.options.length > 0 ? course.options[0] : null;

    return (
        <div className="courseSlot">
            <div className="courseDetailsCard">
                <div className="courseCardHeader">
                    <div>
                        <h2 className="courseCardTitle">
                            {course.title} {course.applicationCode ? `(${course.applicationCode})` : ""}
                        </h2>
                        <p className="courseCardUni">{course.university?.name || "Unknown University"}</p>
                    </div>
                    <button className="removeCourseBtn" onClick={onRemove} title="Remove course">
                        <i className="bi bi-x-circle"></i>
                    </button>
                </div>

                {course.summary && (
                    <div className="detailSection">
                        <h3 className="detailSectionTitle">Summary</h3>
                        <div className="summaryText">
                            {course.summary.replace(/\*\*(.*?)\*\*/g, "$1")}
                        </div>
                    </div>
                )}

                {option && (
                    <>
                        <div className="detailSection">
                            <h3 className="detailSectionTitle">Study Options</h3>
                            <div className="detailRow">
                                <span className="detailLabel">Academic Year</span>
                                <span className="detailValue">{option.year || "N/A"}</span>
                            </div>
                            <div className="detailRow">
                                <span className="detailLabel">Duration</span>
                                <span className="detailValue">{option.duration || "N/A"}</span>
                            </div>
                            <div className="detailRow">
                                <span className="detailLabel">Study Mode</span>
                                <span className="detailValue">{option.studyMode || "N/A"}</span>
                            </div>
                            <div className="detailRow">
                                <span className="detailLabel">Start Date</span>
                                <span className="detailValue">{option.startDate || "N/A"}</span>
                            </div>
                        </div>

                        <div className="detailSection">
                            <h3 className="detailSectionTitle">Fees</h3>
                            <div className="detailRow">
                                <span className="detailLabel">Home Fee</span>
                                <span className="detailValue">
                                    {option.homeFee ? `£${option.homeFee.toLocaleString()}` : "N/A"}
                                </span>
                            </div>
                            <div className="detailRow">
                                <span className="detailLabel">International Fee</span>
                                <span className="detailValue">
                                    {option.internationalFee ? `£${option.internationalFee.toLocaleString()}` : "N/A"}
                                </span>
                            </div>
                        </div>

                        <div className="detailSection">
                            <h3 className="detailSectionTitle">Requirements</h3>
                            <div className="detailRow">
                                <span className="detailLabel">A-Level</span>
                                <span className="detailValue">
                                    {option.aLevelGrade1 || "N/A"}
                                </span>
                            </div>
                        </div>
                    </>
                )}

                {!option && (
                    <div className="detailSection" style={{ color: "var(--text-secondary)", textAlign: "center", fontStyle: "italic", marginTop: "20px" }}>
                        No specific study options or fee data available for this course.
                    </div>
                )}
            </div>
        </div>
    );
}
