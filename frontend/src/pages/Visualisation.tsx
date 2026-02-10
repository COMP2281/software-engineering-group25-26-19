import { useEffect, useMemo, useState } from "react";

import type { Course } from "../api/Courses.types";
import { getCourses } from "../api/Courses.api";

type Mode = "live" | "fallback";

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "success"; mode: Mode; data: Course[]; meta?: { page: number; pageSize: number; totalPages: number } }
  | { status: "error"; message: string };

const FALLBACK_COURSES: Course[] = [
  {
    id: "fallback-1",
    academicYear: "2026",
    level: "Undergraduate",
    courseTitle: "Computer Science",
    provider: "University of Manchester",
    department: "Department of Computer Science",
    applicationCode: "G400",
    studyMode: "Full-time",
    durationYears: 3,
    startDate: "14/09/2026",
    ukTuitionFeeYear1GBP: 9250,
  },
  {
    id: "fallback-2",
    academicYear: "2026",
    level: "Postgraduate",
    courseTitle: "MSc Data Science",
    provider: "University of Glasgow",
    department: "School of Computing Science",
    applicationCode: "N/A",
    studyMode: "Full-time",
    durationYears: 1,
    startDate: "21/09/2026",
    ukTuitionFeeYear1GBP: 12500,
  },
];

export default function Visualisation() {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  // Keep it super simple for now
  const page = 1;
  const pageSize = 10;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ status: "loading" });

      try {
        const res = await getCourses({ page, pageSize });
        if (cancelled) return;

        setState({
          status: "success",
          mode: "live",
          data: res.data,
          meta: { page: res.page, pageSize: res.pageSize, totalPages: res.totalPages },
        });
      } catch (e) {
        // Don’t brick the page if backend/DB is down: fall back to mock-ish data
        const msg = e instanceof Error ? e.message : "Unknown error";

        if (cancelled) return;

        setState({
          status: "success",
          mode: "fallback",
          data: FALLBACK_COURSES,
          meta: undefined,
        });

        // Optional: also surface the live error in console for debugging
        // eslint-disable-next-line no-console
        console.warn("Live fetch failed; using fallback data:", msg);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const banner = useMemo(() => {
    if (state.status === "loading" || state.status === "idle") return null;

    if (state.status === "error") {
      return (
        <div style={{ border: "1px solid #f5c2c7", padding: 12, borderRadius: 8 }}>
          <strong style={{ color: "#b02a37" }}>Error</strong>: {state.message}
        </div>
      );
    }

    if (state.mode === "live") {
      return (
        <div style={{ border: "1px solid #d1e7dd", padding: 12, borderRadius: 8 }}>
          <strong style={{ color: "#0f5132" }}>Live data</strong> loaded from <code>/api/courses</code>.
          {state.meta && (
            <span style={{ marginLeft: 8, opacity: 0.8 }}>
              (page {state.meta.page}/{state.meta.totalPages}, pageSize {state.meta.pageSize})
            </span>
          )}
        </div>
      );
    }

    return (
      <div style={{ border: "1px solid #ffeeba", padding: 12, borderRadius: 8 }}>
        <strong style={{ color: "#664d03" }}>Fallback mode</strong>: backend fetch failed, so using placeholder data.
        <span style={{ marginLeft: 8, opacity: 0.8 }}>
          (This is expected if DB access isn’t available locally.)
        </span>
      </div>
    );
  }, [state]);

  const body = useMemo(() => {
    if (state.status === "idle" || state.status === "loading") {
      return <p>Loading…</p>;
    }

    if (state.status === "error") {
      return null;
    }

    const data = state.data;

    if (!data.length) {
      return <p>No data returned.</p>;
    }

    return (
      <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
        <p style={{ marginTop: 0, opacity: 0.85 }}>
          Proof-of-concept: rendering the first few course records.
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Title</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Provider</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Level</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Fee</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 10).map((c) => (
              <tr key={c.id}>
                <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3" }}>{c.courseTitle}</td>
                <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3" }}>{c.provider}</td>
                <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3" }}>{c.level}</td>
                <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                  {typeof c.ukTuitionFeeYear1GBP === "number" ? `£${c.ukTuitionFeeYear1GBP.toLocaleString()}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [state]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Visualisation</h1>
      <p style={{ marginTop: 4, opacity: 0.8 }}>
        Basic placeholder page with a live fetch attempt and a safe fallback.
      </p>

      {banner}

      <div style={{ height: 12 }} />

      {body}
    </div>
  );
}
