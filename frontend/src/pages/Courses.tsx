import React, { useEffect, useState } from "react";
import { getCourses } from "../api/Courses.api";
import type { Course, CoursesFilters } from "../api/Courses.types";
import Sidebar from "../components/Sidebar";
import "./Courses.css";

function Spinner() {
  return <div className="spinner" />;
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(5);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const res = await getCourses({
        page,
        pageSize: pageSize,
        q: search || undefined,
      });

      console.log(res.data);

      setCourses(res.data);
      setTotalPages(res.totalPages);
      setLoading(false);
    }

    load();
  }, [page, pageSize, search]);

  useEffect(() => {
    async function loadCourse() {
      
    }



  })

  return (
    <div className="appShell">
      {/* Sidebar */}
      <Sidebar />

      {/* Main area */}
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
          <div className="filterBar">
            <input
              type="text"
              placeholder="Search Courses"
              value={search}
              onChange={(inp) => setSearch(inp.target.value)}
              className="searchInput"
            />

            <select
              value={pageSize}
              onChange={(inp) => setPageSize(parseInt(inp.target.value))}
              className="pageInput"
            >
              <option value={5}>5 / Page</option>
              <option value={10}>10 / Page</option>
              <option value={20}>20 / Page</option>
              <option value={50}>50 / Page</option>
            </select>
          </div>

          <div className="tableWrapper">
            <table className="coursesTable">
              <thead>
                <tr>
                  <th></th>
                  <th>Title</th>
                  <th>Institution</th>
                  <th>Application Code</th>
                  <th>Summary</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
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
                                className={`bi bi-chevron-right expandIcon ${
                                  isExpanded ? "rotated" : ""
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
                        </tr>

                        <tr className={`expandedRow ${stripeClass}`}>
                          <td colSpan={5}>
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
                                          <span className="label">
                                            Duration:
                                          </span>
                                          <span>{opt.duration || "N/A"}</span>
                                        </div>

                                        <div>
                                          <span className="label">Start:</span>
                                          <span>{opt.startDate || "N/A"}</span>
                                        </div>

                                        <div>
                                          <span className="label">
                                            Home Fee:
                                          </span>
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
                onClick={() => setPage((p) => p - 1)}
              >
                <i className="bi bi-arrow-left-circle" />
              </button>

              <span className="pageInfo">
                Page {page} of {totalPages}
              </span>

              <button
                className="pageIconBtn"
                disabled={page === totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                <i className="bi bi-arrow-right-circle" />
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
