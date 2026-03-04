import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { getCourses } from "../api/Courses.api";
import type { Course } from "../api/Courses.types";
import "./Visualisation.css";

export default function Visualisation() {
    const location = useLocation();

    const [courses, setCourses] = useState<(Course | null)[]>(() => {
        const initial = location.state?.initialCourses as Course[] | undefined;
        if (initial && initial.length > 0) {
            if (initial.length === 1) return [initial[0], null]; // Pad array so we always have at least two slots
            return initial;
        }
        return [null, null];
    });

    const handleSelect = (index: number, course: Course) => {
        const newCourses = [...courses];
        newCourses[index] = course;
        setCourses(newCourses);
    };

    const handleRemove = (index: number) => {
        const newCourses = [...courses];
        if (newCourses.length > 2) {
            newCourses.splice(index, 1);
        } else {
            newCourses[index] = null;
        }
        setCourses(newCourses);
    };

    const handleAddSlot = () => {
        setCourses([...courses, null]);
    };

    const selectedCoursesCount = courses.filter(c => c !== null).length;

    const validHomeFees = courses.map(c => c?.options?.[0]?.homeFee).filter((f): f is number => !!f);
    const minHomeFee = selectedCoursesCount <= 2 && validHomeFees.length ? Math.min(...validHomeFees) : null;
    const maxHomeFee = selectedCoursesCount <= 2 && validHomeFees.length ? Math.max(...validHomeFees) : null;

    const validIntlFees = courses.map(c => c?.options?.[0]?.internationalFee).filter((f): f is number => !!f);
    const minIntlFee = selectedCoursesCount <= 2 && validIntlFees.length ? Math.min(...validIntlFees) : null;
    const maxIntlFee = selectedCoursesCount <= 2 && validIntlFees.length ? Math.max(...validIntlFees) : null;

    return (
        <main className="mainContent visualisationContainer">
            <div className="visualisationHeader">
                <h1 className="visualisationTitle">Visualisation & Comparison</h1>
                <p className="visualisationSubtitle">
                    Select courses below to compare their details side by side.
                </p>
            </div>

            <div className="comparisonArea">
                {courses.map((course, index) => (
                    <CourseSlot
                        key={index}
                        label={`Course ${String.fromCharCode(65 + index)}`}
                        course={course}
                        minHomeFee={minHomeFee}
                        maxHomeFee={maxHomeFee}
                        minIntlFee={minIntlFee}
                        maxIntlFee={maxIntlFee}
                        onSelect={(c) => handleSelect(index, c)}
                        onRemove={() => handleRemove(index)}
                    />
                ))}

                <div className="addCourseSlot" onClick={handleAddSlot}>
                    <div className="addCourseIcon">
                        <i className="bi bi-plus-circle"></i>
                    </div>
                    <div>Add Course</div>
                </div>
            </div>
        </main>
    );
}

interface CourseSlotProps {
    label: string;
    course: Course | null;
    minHomeFee: number | null;
    maxHomeFee: number | null;
    minIntlFee: number | null;
    maxIntlFee: number | null;
    onSelect: (course: Course) => void;
    onRemove: () => void;
}

function CourseSlot({ label, course, minHomeFee, maxHomeFee, minIntlFee, maxIntlFee, onSelect, onRemove }: CourseSlotProps) {
    if (course) {
        return <CourseDetailsCard course={course} minHomeFee={minHomeFee} maxHomeFee={maxHomeFee} minIntlFee={minIntlFee} maxIntlFee={maxIntlFee} onRemove={onRemove} />;
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
                    pageSize: 20,
                    q: searchTerm,
                    titleOnly: true,
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
    minHomeFee: number | null;
    maxHomeFee: number | null;
    minIntlFee: number | null;
    maxIntlFee: number | null;
    onRemove: () => void;
}

function CourseDetailsCard({ course, minHomeFee, maxHomeFee, minIntlFee, maxIntlFee, onRemove }: CourseDetailsCardProps) {
    // Use the first option as the default to display details
    const option = course.options && course.options.length > 0 ? course.options[0] : null;

    const getFeeColor = (fee: number | null, minF: number | null, maxF: number | null) => {
        if (!fee || minF === maxF) return undefined;
        if (fee === maxF) return "var(--danger-color, #dc3545)";
        if (fee === minF) return "var(--success-color, #198754)";
        return undefined; // in between
    };

    let degreeLevel = "Unknown";
    let isUndergrad = false;

    if (option?.outcomeQualification) {
        isUndergrad = option.outcomeQualification.toLowerCase().startsWith('b');
        degreeLevel = isUndergrad ? "Undergraduate" : "Postgraduate";
    }

    return (
        <div className="courseSlot">
            <div className="courseDetailsCard">
                <div className="courseCardHeader">
                    <div>
                        <h2 className="courseCardTitle">
                            {course.title} {course.applicationCode ? `(${course.applicationCode})` : ""}
                        </h2>
                        <div className="courseCardSubheader">
                            <p className="courseCardUni">{course.university?.name || "Unknown University"}</p>
                            {option?.outcomeQualification && (
                                <span className={`levelBadge ${isUndergrad ? 'badgeUg' : 'badgePg'}`}>
                                    {degreeLevel}
                                </span>
                            )}
                        </div>
                    </div>
                    <button className="removeCourseBtn" onClick={onRemove} title="Remove course">
                        <i className="bi bi-x-circle"></i>
                    </button>
                </div>

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
                                <span className="detailValue" style={{ color: getFeeColor(option.homeFee, minHomeFee, maxHomeFee), fontWeight: getFeeColor(option.homeFee, minHomeFee, maxHomeFee) ? 'bold' : 'normal' }}>
                                    {option.homeFee ? `£${option.homeFee.toLocaleString()}` : "N/A"}
                                </span>
                            </div>
                            <div className="detailRow">
                                <span className="detailLabel">International Fee</span>
                                <span className="detailValue" style={{ color: getFeeColor(option.internationalFee, minIntlFee, maxIntlFee), fontWeight: getFeeColor(option.internationalFee, minIntlFee, maxIntlFee) ? 'bold' : 'normal' }}>
                                    {option.internationalFee ? `£${option.internationalFee.toLocaleString()}` : "N/A"}
                                </span>
                            </div>
                        </div>

                        <div className="detailSection">
                            <h3 className="detailSectionTitle">Requirements</h3>
                            {(!option.aLevelGrade1 && !option.aLevelGrade2 && !option.aLevelGrade3 && !option.aLevelGrade4) ? (
                                <div className="detailRow">
                                    <span className="detailLabel">A-Level</span>
                                    <span className="detailValue">N/A</span>
                                </div>
                            ) : (
                                <div className="detailRow">
                                    <span className="detailLabel">A-Levels</span>
                                    <span className="detailValue">
                                        {[1, 2, 3, 4]
                                            .map((i) => option[`aLevelGrade${i}` as keyof typeof option] as string | null)
                                            .filter(Boolean)
                                            .join(", ")}
                                    </span>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {!option && (
                    <div className="detailSection" style={{ color: "var(--text-secondary)", textAlign: "center", fontStyle: "italic", marginTop: "20px" }}>
                        No specific study options or fee data available for this course.
                    </div>
                )}

                {course.courseUrl && (
                    <div style={{ marginTop: 'auto', paddingTop: '20px', textAlign: 'center' }}>
                        <a href={course.courseUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display: 'inline-block', width: '100%', textDecoration: 'none' }}>
                            View Course Details <i className="bi bi-box-arrow-up-right" style={{ marginLeft: '8px' }}></i>
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}
