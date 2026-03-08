import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { getCourseById, getCourses } from "../api/Courses.api";
import type { Course } from "../api/Courses.types";
import "./Comparison.css";

type CourseOptionCard = {
  course: Course;
  option: Course["options"][number];
};

export default function Comparison() {
  const location = useLocation();
  const courseIds = location.state?.courseIds as string[] | undefined;

  const [cards, setCards] = useState<(CourseOptionCard | null)[]>(() => {
    const saved = localStorage.getItem("comparison_cards");

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(Boolean);
        }
      } catch (e) {
        console.error("Failed to parse saved comparison cards", e);
      }
    }

    return [];
  });

  useEffect(() => {
    localStorage.setItem("comparison_cards", JSON.stringify(cards));
  }, [cards]);

  useEffect(() => {
    if (!courseIds || courseIds.length === 0) return;

    async function loadCards() {
      if (!courseIds || courseIds.length === 0) return;
      try {
        const results = await Promise.all(
          courseIds.map(async (id) => {
            const res = await getCourseById(id);
            return res.data;
          }),
        );

        const expandedCards = results.flatMap((course) =>
          course.options.map((option) => ({
            course,
            option,
          })),
        );

        setCards(expandedCards);
      } catch (err) {
        console.error("Failed to load comparison courses", err);
      }
    }

    loadCards();
  }, [courseIds]);

  const handleSelect = (index: number, course: Course) => {
    const optionCards: CourseOptionCard[] =
      course.options && course.options.length > 0
        ? course.options.map((option) => ({
            course,
            option,
          }))
        : [];

    const newCards = [...cards];

    if (optionCards.length > 0) {
      newCards.splice(index, 1, ...optionCards);
    } else {
      newCards[index] = null;
    }

    setCards(newCards);
  };

  const handleRemove = (index: number) => {
    const newCards = [...cards];
    newCards.splice(index, 1);

    if (newCards.length === 0) {
      setCards([]);
      return;
    }

    setCards(newCards);
  };

  const handleAddSlot = () => {
    const hasSearchSlot = cards.some((c) => c === null);
    if (hasSearchSlot) return;

    setCards([...cards, null]);
  };

  const selectedCardsCount = cards.filter((c) => c !== null).length;

  const validHomeFees = cards
    .map((c) => c?.option?.homeFee)
    .filter((f): f is number => !!f);

  const minHomeFee =
    selectedCardsCount <= 2 && validHomeFees.length
      ? Math.min(...validHomeFees)
      : null;

  const maxHomeFee =
    selectedCardsCount <= 2 && validHomeFees.length
      ? Math.max(...validHomeFees)
      : null;

  const validIntlFees = cards
    .map((c) => c?.option?.internationalFee)
    .filter((f): f is number => !!f);

  const minIntlFee =
    selectedCardsCount <= 2 && validIntlFees.length
      ? Math.min(...validIntlFees)
      : null;

  const maxIntlFee =
    selectedCardsCount <= 2 && validIntlFees.length
      ? Math.max(...validIntlFees)
      : null;

  return (
    <main className="mainContent comparisonContainer">
      <div className="comparisonHeader">
        <h1 className="comparisonTitle">Course Comparison</h1>
        <p className="comparisonSubtitle">
          Select courses below to compare their details side by side.
        </p>
      </div>

      <div className="comparisonArea">
        {cards.map((card, index) =>
          card ? (
            <CourseDetailsCard
              key={`${card.course.id}-${card.option.id}`}
              course={card.course}
              option={card.option}
              minHomeFee={minHomeFee}
              maxHomeFee={maxHomeFee}
              minIntlFee={minIntlFee}
              maxIntlFee={maxIntlFee}
              onRemove={() => handleRemove(index)}
            />
          ) : (
            <CourseSearch
              key={`search-${index}`}
              onSelect={(course) => handleSelect(index, course)}
            />
          ),
        )}

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

interface CourseSearchProps {
  onSelect: (course: Course) => void;
}

function CourseSearch({ onSelect }: CourseSearchProps) {
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
        });

        setResults(res.data);
        setShowDropdown(true);
      } catch (err) {
        console.error("Failed to fetch courses for search", err);
      } finally {
        setLoading(false);
      }
    }, 500);

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

      <div className="searchInstructions">Search for Course</div>

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
              <div className="searchResultTitle">
                {c.title} {c.applicationCode ? `(${c.applicationCode})` : ""}
              </div>
              <div className="searchResultUni">
                {c.university?.name || "Unknown University"}
              </div>
            </div>
          ))}
        </div>
      )}

      {showDropdown &&
        results.length === 0 &&
        searchTerm.trim().length >= 2 &&
        !loading && (
          <div
            className="searchResultsDropdown"
            style={{
              padding: "16px",
              color: "var(--text-secondary)",
            }}
          >
            No courses found matching "{searchTerm}"
          </div>
        )}
    </div>
  );
}

interface CourseDetailsCardProps {
  course: Course;
  option: Course["options"][number];
  minHomeFee: number | null;
  maxHomeFee: number | null;
  minIntlFee: number | null;
  maxIntlFee: number | null;
  onRemove: () => void;
}

function CourseDetailsCard({
  course,
  option,
  minHomeFee,
  maxHomeFee,
  minIntlFee,
  maxIntlFee,
  onRemove,
}: CourseDetailsCardProps) {
  const getFeeColor = (
    fee: number | null,
    minF: number | null,
    maxF: number | null,
  ) => {
    if (!fee || minF === maxF) return undefined;
    if (fee === maxF) return "var(--danger-color, #dc3545)";
    if (fee === minF) return "var(--success-color, #198754)";
    return undefined;
  };

  let degreeLevel = "Unknown";
  let isUndergrad = false;

  if (option.outcomeQualification) {
    isUndergrad = option.outcomeQualification.toLowerCase().startsWith("b");
    degreeLevel = isUndergrad ? "Undergraduate" : "Postgraduate";
  }

  return (
    <div className="courseSlot">
      <div className="courseDetailsCard">
        <div className="courseCardHeader">
          <div>
            <h2 className="courseCardTitle">
              {course.title}{" "}
              {course.applicationCode ? `(${course.applicationCode})` : ""}
            </h2>

            <div className="courseCardSubheader">
              <p className="courseCardUni">
                {course.university?.name || "Unknown University"}
              </p>

              {option.outcomeQualification && (
                <span
                  className={`levelBadge ${isUndergrad ? "badgeUg" : "badgePg"}`}
                >
                  {degreeLevel}
                </span>
              )}
            </div>
          </div>

          <button
            className="removeCourseBtn"
            onClick={onRemove}
            title="Remove course option"
          >
            <i className="bi bi-x-circle"></i>
          </button>
        </div>

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
            <span
              className="detailValue"
              style={{
                color: getFeeColor(option.homeFee, minHomeFee, maxHomeFee),
                fontWeight: getFeeColor(option.homeFee, minHomeFee, maxHomeFee)
                  ? "bold"
                  : "normal",
              }}
            >
              {option.homeFee ? `£${option.homeFee.toLocaleString()}` : "N/A"}
            </span>
          </div>

          <div className="detailRow">
            <span className="detailLabel">International Fee</span>
            <span
              className="detailValue"
              style={{
                color: getFeeColor(
                  option.internationalFee,
                  minIntlFee,
                  maxIntlFee,
                ),
                fontWeight: getFeeColor(
                  option.internationalFee,
                  minIntlFee,
                  maxIntlFee,
                )
                  ? "bold"
                  : "normal",
              }}
            >
              {option.internationalFee
                ? `£${option.internationalFee.toLocaleString()}`
                : "N/A"}
            </span>
          </div>
        </div>

        <div className="detailSection">
          <h3 className="detailSectionTitle">Requirements</h3>

          {!option.aLevelGrade1 &&
          !option.aLevelGrade2 &&
          !option.aLevelGrade3 &&
          !option.aLevelGrade4 ? (
            <div className="detailRow">
              <span className="detailLabel">A-Level</span>
              <span className="detailValue">N/A</span>
            </div>
          ) : (
            <div className="detailRow">
              <span className="detailLabel">A-Levels</span>
              <span className="detailValue">
                {[1, 2, 3, 4]
                  .map(
                    (i) =>
                      option[`aLevelGrade${i}` as keyof typeof option] as
                        | string
                        | null,
                  )
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>

        {course.courseUrl && (
          <div
            style={{
              marginTop: "auto",
              paddingTop: "20px",
              textAlign: "center",
            }}
          >
            <a
              href={course.courseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{
                display: "inline-block",
                width: "100%",
                textDecoration: "none",
              }}
            >
              View Course Details{" "}
              <i
                className="bi bi-box-arrow-up-right"
                style={{ marginLeft: "8px" }}
              ></i>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
