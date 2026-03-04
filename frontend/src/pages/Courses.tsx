import React, { useEffect, useState } from "react";
import { getCourseFilters, getCourses } from "../api/Courses.api";
import type { Course } from "../api/Courses.types";
import "./Courses.css";
import { useNavigate } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import {
  startScraper,
  stopScraper,
  getScraperStatus,
  type ScraperStatusResponse,
} from "../api/Scraper.api";
import { getExcelExportUrl } from "../api/Excel.api";

type ActionLoading = null | "scrape" | "export";

function Spinner() {
  return <div className="spinner" />;
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [universities, setUniversities] = useState<
    { id: string; name: string }[]
  >([]);
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedCourseMap, setSelectedCourseMap] = useState<Map<string, Course>>(
    new Map(),
  );
  const [selectAllMode, setSelectAllMode] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<ActionLoading>(null);
  const [error, setError] = useState<string | null>(null);

  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 5);
  const search = searchParams.get("q") ?? "";
  const universityIdsParam = searchParams.get("universityIds") ?? "";
  const level = searchParams.get("level") ?? "all";

  const selectedUniversityIds = universityIdsParam
    ? universityIdsParam.split(",").filter(Boolean)
    : [];

  const [showUniDropdown, setShowUniDropdown] = useState(false);
  const [showLevelDropdown, setShowLevelDropdown] = useState(false);
  const [showPageDropdown, setShowPageDropdown] = useState(false);

  const [scraperState, setScraperState] = useState<ScraperStatusResponse>({
    status: "idle",
  });

  const filterBarRef = React.useRef<HTMLDivElement | null>(null);

  const navigate = useNavigate();

  function toggleSelection(course: Course) {
    if (selectAllMode) return; // disable individual toggling when select-all is active

    setSelectedCourseMap((prev) => {
      const newMap = new Map(prev);

      if (newMap.has(course.id)) {
        newMap.delete(course.id);
      } else {
        newMap.set(course.id, course);
      }

      return newMap;
    });
  }

  async function loadCourses() {
    setLoading(true);

    const res = await getCourses({
      page,
      pageSize,
      q: search || undefined,
      universityIds: universityIdsParam || undefined,
      level: level !== "all" ? level : undefined,
    });

    console.log(res.data);

    setCourses(res.data);
    setTotalPages(res.totalPages);
    setLoading(false);
  }

  useEffect(() => {
    loadCourses();
  }, [page, pageSize, search, universityIdsParam, level]);

  useEffect(() => {
    async function loadFilters() {
      const res = await getCourseFilters();
      setUniversities(res.universities);
    }
    loadFilters();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        filterBarRef.current &&
        !filterBarRef.current.contains(event.target as Node)
      ) {
        setShowUniDropdown(false);
        setShowLevelDropdown(false);
        setShowPageDropdown(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function updateParams(updates: Record<string, string | undefined>) {
    // Clear selection immediately when params change to avoid useEffect cascading renders
    setSelectedCourseMap(new Map());
    setSelectAllMode(false);

    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);

      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === "all") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      return params;
    });
  }

  function toggleUniversity(id: string) {
    const current = new Set(selectedUniversityIds);

    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }

    updateParams({
      page: "1",
      universityIds: Array.from(current).join(",") || undefined,
    });
  }

  // Poll scraper status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await getScraperStatus();
        setScraperState((prev) => {
          if (prev.status === "running" && status.status === "idle") {
            loadCourses();
          }
          return status;
        });
      } catch (e) {
        console.error("Scraper status poll failed", e);
      }
    };

    checkStatus();
    const timer = setInterval(checkStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  async function handleStartScrape() {
    try {
      setActionLoading("scrape");
      setError(null);

      const res = await startScraper();
      // Immediate update to running state
      setScraperState({ status: "running", pid: res.pid });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to start scraper";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  }

  /* Stop Scraper */
  async function handleStopScrape() {
    try {
      setActionLoading("scrape");
      setError(null);

      await stopScraper();
      // Immediate update to idle state
      setScraperState({ status: "idle" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to stop scraper";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  }

  function handleQuickExport() {
    try {
      setActionLoading("export");
      setError(null);

      let exportUrl: string;

      if (!selectAllMode && selectedCourseMap.size > 0) {
        exportUrl = getExcelExportUrl({
          courseIds: Array.from(selectedCourseMap.keys()),
        })
      }
      else {
        exportUrl = getExcelExportUrl({
          q: search || undefined,
          universityIds: selectedUniversityIds.length > 0 ? selectedUniversityIds : undefined,
          level: level !== 'all' ? (level as 'undergraduate' | 'postgraduate') : undefined,
        })
      }

      window.location.href = exportUrl;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  }

  const hasSelection = selectAllMode || selectedCourseMap.size > 0;

  return (
    <main className="mainContent">
      {/* Header */}
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Courses</h1>
          <p className="pageSubTitle">
            Available undergraduate and postgraduate courses
          </p>
        </div>
      </div>

      {/* Table */}
      <section className="panel">
        <div className="filterBar" ref={filterBarRef}>
          <input
            type="text"
            placeholder="Search Courses"
            value={search}
            onChange={(e) => {
              updateParams({
                page: "1",
                q: e.target.value || undefined,
              });
            }}
            className="searchInput"
          />

          <div className="checkboxDropdown">
            <button
              type="button"
              className="dropdownToggle"
              onClick={() => setShowUniDropdown((prev) => !prev)}
            >
              {selectedUniversityIds.length === 0
                ? "All Institutions"
                : `${selectedUniversityIds.length} Institution Selected`}
              <i className="bi bi-chevron-down" />
            </button>

            {showUniDropdown && (
              <div className="dropdownPanel">
                {universities.map((u) => (
                  <label key={u.id} className="dropdownItem">
                    <input
                      type="checkbox"
                      checked={selectedUniversityIds.includes(u.id)}
                      onChange={() => toggleUniversity(u.id)}
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="dropdown">
            <button
              type="button"
              className="dropdownToggle"
              onClick={() => setShowLevelDropdown((prev) => !prev)}
            >
              {level === "all"
                ? "All Levels"
                : level === "undergraduate"
                  ? "Undergraduate"
                  : "Postgraduate"}
              <i className="bi bi-chevron-down" />
            </button>

            {showLevelDropdown && (
              <div className="dropdownPanel">
                {["all", "undergraduate", "postgraduate"].map((lvl) => (
                  <div
                    key={lvl}
                    className="dropdownItem"
                    onClick={() => {
                      updateParams({
                        page: "1",
                        level: lvl === "all" ? undefined : lvl,
                      });
                      setShowLevelDropdown(false);
                    }}
                  >
                    {lvl === "all"
                      ? "All Levels"
                      : lvl === "undergraduate"
                        ? "Undergraduate"
                        : "Postgraduate"}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="dropdown">
            <button
              type="button"
              className="dropdownToggle"
              onClick={() => setShowPageDropdown((prev) => !prev)}
            >
              {pageSize} / Page
              <i className="bi bi-chevron-down" />
            </button>

            {showPageDropdown && (
              <div className="dropdownPanel">
                {[5, 10, 20, 50].map((size) => (
                  <div
                    key={size}
                    className="dropdownItem"
                    onClick={() => {
                      updateParams({
                        page: "1",
                        pageSize: String(size),
                      });
                      setShowPageDropdown(false);
                    }}
                  >
                    {size} / Page
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {hasSelection && (
          <div className="selectionRow">
            <div className="selectionText">
              {selectAllMode
                ? "All courses selected"
                : `${selectedCourseMap.size} ${selectedCourseMap.size == 1 ? "course" : "courses"} selected`}
            </div>

            <div className="selectionButtons">
              <button
                className="actionBtn exportBtn"
                onClick={() => {
                  const selectedObjects = selectAllMode
                    ? courses
                    : Array.from(selectedCourseMap.values());

                  navigate('/visualisation', { state: { initialCourses: selectedObjects } });
                }}
              >
                <i className="bi bi-bar-chart" />{" "}
                Visualise
              </button>

              <button
                className="actionBtn exportBtn"
                onClick={() => handleQuickExport()}
                disabled={loading || actionLoading !== null}
              >
                <i className="bi bi-download" />{" "}
                {actionLoading == "export" ? "Exporting..." : "Export"}
              </button>

              {scraperState.status === "running" ? (
                <button
                  className="actionBtn scrapeBtn"
                  onClick={() => handleStopScrape()}
                  disabled={actionLoading === "scrape"}
                >
                  <i className="bi bi-cloud-arrow-down" />{" "}
                  {actionLoading == "scrape" ? "Stopping..." : "Stop Scrape"}
                </button>
              ) : (
                <button
                  className="actionBtn scrapeBtn"
                  onClick={() => handleStartScrape()}
                  disabled={loading || actionLoading !== null}
                >
                  <i className="bi bi-cloud-arrow-down" />{" "}
                  {actionLoading == "scrape" ? "Scraping..." : "Scrape"}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="tableWrapper">
          <table className="coursesTable">
            <thead>
              <tr>
                <th></th>
                <th>Title</th>
                <th>Institution</th>
                <th>Application Code</th>
                <th>Summary</th>
                <th></th>
                <th>
                  <input
                    type="checkbox"
                    checked={selectAllMode}
                    onChange={(e) => {
                      const checked = e.target.checked;

                      if (checked) {
                        setSelectAllMode(true);
                        setSelectedCourseMap(new Map()); // clear specific IDs
                      } else {
                        setSelectAllMode(false);
                        // do NOT repopulate IDs — allow user to reselect manually
                      }
                    }}
                  />
                </th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: "40px",
                    }}
                  >
                    <Spinner />
                  </td>
                </tr>
              ) : (
                courses.map((c, idx) => {
                  const isExpanded = expandedCourseId === c.id;
                  const stripeClass = idx % 2 === 0 ? "rowEven" : "rowOdd";

                  return (
                    <React.Fragment key={c.id}>
                      <tr className={`courseRow ${stripeClass}`} key={c.id}>
                        <td>
                          <div className="expandCell">
                            <i
                              className={`bi bi-chevron-right expandIcon ${isExpanded ? "rotated" : ""
                                }`}
                              onClick={() =>
                                setExpandedCourseId(isExpanded ? null : c.id)
                              }
                            />
                            <span className="optionCount">
                              {c.options?.length ?? 0}
                            </span>
                          </div>
                        </td>

                        <td>{c.title}</td>
                        <td>{c.university?.name || "N/A"}</td>
                        <td>{c.applicationCode || "N/A"}</td>
                        <td className="summaryCell">{c.summary || "N/A"}</td>
                        <td className="actionCell">
                          <i
                            className="bi bi-arrows-angle-expand rowExpandIcon"
                            onClick={() => navigate(`/courses/${c.id}`)}
                          ></i>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={
                              selectAllMode || selectedCourseMap.has(c.id)
                            }
                            disabled={selectAllMode}
                            onChange={() => toggleSelection(c)}
                            className={`rowCheckbox ${selectAllMode ? "disabledMode" : ""}`}
                          />
                        </td>
                      </tr>

                      <tr className={`expandedRow ${stripeClass}`}>
                        <td colSpan={7}>
                          <div
                            className={`expandWrapper ${isExpanded ? "open" : ""}`}
                          >
                            <div className="expandedContent">
                              <div className="optionsGrid">
                                {c.options.map((opt) => (
                                  <div key={opt.id} className="optionCard">
                                    <div className="optionHeader">
                                      {opt.outcomeQualification} ·{" "}
                                      {opt.studyMode || "N/A"}
                                    </div>

                                    <div className="optionMeta">
                                      <div>
                                        <span className="label">Duration:</span>
                                        <span>{opt.duration || "N/A"}</span>
                                      </div>

                                      <div>
                                        <span className="label">Start:</span>
                                        <span>{opt.startDate || "N/A"}</span>
                                      </div>

                                      <div>
                                        <span className="label">Home Fee:</span>
                                        <span>
                                          {opt.homeFee
                                            ? `£${opt.homeFee.toLocaleString()}`
                                            : "N/A"}
                                        </span>
                                      </div>

                                      <div>
                                        <span className="label">
                                          International:
                                        </span>
                                        <span>
                                          {opt.internationalFee
                                            ? `£${opt.internationalFee.toLocaleString()}`
                                            : "N/A"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && courses.length === 0 && (
          <div className="noResults">No Results Found</div>
        )}

        {/* Pagination */}

        {courses.length > 0 && (
          <div className="pagination">
            <button
              className="pageIconBtn"
              disabled={page === 1 || loading}
              onClick={() =>
                setSearchParams((prev) => {
                  const params = new URLSearchParams(prev);
                  params.set("page", String(page - 1));
                  return params;
                })
              }
            >
              <i className="bi bi-arrow-left-circle" />
            </button>

            <span className="pageInfo">
              Page {page} of {totalPages}
            </span>

            <button
              className="pageIconBtn"
              disabled={page === totalPages || loading}
              onClick={() =>
                setSearchParams((prev) => {
                  const params = new URLSearchParams(prev);
                  params.set("page", String(page + 1));
                  return params;
                })
              }
            >
              <i className="bi bi-arrow-right-circle" />
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
