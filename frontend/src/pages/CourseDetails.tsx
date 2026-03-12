import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getCourseById } from "../api/Courses.api";
import type { Course } from "../api/Courses.types";
import "./CourseDetails.css";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

export default function CourseDetails() {
  const { id } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      if (!id) {
        setCourse(null);
        setLoading(false);
        return;
      }

      try {
        const res = await getCourseById(id);
        console.log(res);
        setCourse(res.data);
        console.log(res.feeHistory);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("404")) {
          setCourse(null);
        } else {
          console.error(err);
        }
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  if (loading) {
    return (
      <main className="mainContent centeredState">
        <div className="spinner largeSpinner" />
      </main>
    );
  }

  if (!course) {
    return (
      <main className="mainContent centeredState">
        <h2>Course Not Found</h2>
        <p>The course you are looking for does not exist.</p>
      </main>
    );
  }

  return (
    <main
      className="mainContent courseDetails"
      style={{ paddingRight: 0, paddingTop: 0 }}
    >
      <header className="courseHero">
        <div className="heroText">
          <button className="backButton" onClick={() => navigate(-1)}>
            <i className="bi bi-arrow-left"></i>
            Back to Courses
          </button>

          <h1 className="courseTitle">
            {course.courseUrl ? (
              <a
                href={course.courseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="titleLink"
              >
                {course.title} {course.applicationCode && "·"}{" "}
                {course.applicationCode}
              </a>
            ) : (
              <>
                {course.title} {course.applicationCode && "·"}{" "}
                {course.applicationCode}
              </>
            )}
          </h1>
          <p className="courseSubtitle">{course.university?.name}</p>
        </div>

        {course.university?.logoUrl && (
          <div className="heroLogoPanel">
            <img
              src={course.university.logoUrl}
              alt={course.university?.name}
              className="universityLogo"
            />
          </div>
        )}
      </header>

      <div style={{ paddingRight: 28 }}>
        <section className="contentSection summarySection overviewPanel">
          <h2 className="sectionTitle">Overview</h2>

          <div className="summaryContainer">
            <div className="summaryText">
              {course.summary?.split("\n").map((paragraph, i) => {
                if (!paragraph.trim()) return null;

                const formatted = paragraph.replace(
                  /\*\*(.*?)\*\*/g,
                  "<strong>$1</strong>",
                );

                return (
                  <p key={i} dangerouslySetInnerHTML={{ __html: formatted }} />
                );
              })}
            </div>
          </div>
        </section>

        <section
          className="contentSection optionSection overviewPanel"
          style={{ marginTop: 24 }}
        >
          <h2 className="sectionTitle">Available Options</h2>

          <div className="optionsGrid">
            {course.options.map((opt) => {
              const history = course.options
                .filter(
                  (o) =>
                    o.studyMode === opt.studyMode &&
                    o.outcomeQualification === opt.outcomeQualification &&
                    (o.homeFee !== null || o.internationalFee !== null),
                )
                .map((o) => ({
                  year: o.year,
                  homeFee: o.homeFee,
                  internationalFee: o.internationalFee,
                }))
                .sort((a, b) => a.year - b.year);
              return (
                <div key={opt.id} className="optionCard">
                  <div className="optionHeader">
                    {opt.outcomeQualification} · {opt.studyMode}
                  </div>

                  <div className="optionMeta">
                    <div>
                      <span>Academic Year</span>
                      <strong>{opt.year}</strong>
                    </div>

                    <div>
                      <span>Duration</span>
                      <strong>{opt.duration}</strong>
                    </div>

                    <div>
                      <span>Start Date</span>
                      <strong>{opt.startDate}</strong>
                    </div>

                    <div>
                      <span>Home Fee</span>
                      <strong>£{opt.homeFee?.toLocaleString()}</strong>
                    </div>

                    <div>
                      <span>International Fee</span>
                      <strong>£{opt.internationalFee?.toLocaleString()}</strong>
                    </div>
                  </div>

                  {history.length > 0 && (
                    <div style={{ width: "100%", height: 180, marginTop: 16 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={history}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="year" />
                          <YAxis />
                          <Tooltip />
                          <Legend />

                          <Line
                            type="monotone"
                            dataKey="homeFee"
                            stroke="#68246d"
                            strokeWidth={2}
                            name="Home Fees"
                          />

                          <Line
                            type="monotone"
                            dataKey="internationalFee"
                            stroke="#c9a3cc"
                            strokeWidth={2}
                            name="International Fees"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
