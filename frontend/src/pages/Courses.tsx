import { useEffect, useState } from "react";
import { getCourses } from "../api/Courses.api";
import type { Course } from "../api/Courses.types";
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

    const PAGE_SIZE = 5

    useEffect(() => {
        async function load() {
            setLoading(true);

            const res = await getCourses({
            page,
            pageSize: PAGE_SIZE,
            });

            setCourses(res.data);
            setTotalPages(res.totalPages);
            setLoading(false);
        }

        load();
        }, [page]);


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

            <div style={{ overflowX: "auto" }}>
              <table className="coursesTable">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Institution</th>
                    <th>Level</th>
                    <th>Duration</th>
                    <th>Fee (£)</th>
                    <th>Start</th>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                        <tr>
                        <td colSpan={6} style={{ textAlign: "center", padding: "40px" }}>
                            <Spinner />
                        </td>
                        </tr>
                    ) : (
                        courses.map((c) => (
                    <tr key={c.id}>
                      <td>{c.courseTitle}</td>
                      <td>{c.provider}</td>
                      <td>{c.level}</td>
                      <td>{c.durationYears} yrs</td>
                      <td>{c.ukTuitionFeeYear1GBP.toLocaleString()}</td>
                      <td>{c.startDate}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}

            <div className="pagination">

            <button
                className="pageIconBtn"
                disabled={page === 1 || loading}
                onClick={() => setPage(p => p - 1)}
            >
                <i className="bi bi-arrow-left-circle" />
            </button>

            <span className="pageInfo">
                Page {page} of {totalPages}
            </span>

            <button
                className="pageIconBtn"
                disabled={page === totalPages || loading}
                onClick={() => setPage(p => p + 1)}
            >
                <i className="bi bi-arrow-right-circle" />
            </button>

            </div>



            </section>



      </main>
    </div>
  );
    }