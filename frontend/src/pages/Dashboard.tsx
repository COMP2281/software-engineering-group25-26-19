import { useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import "./Dashboard.css";

import {
    getDashboardSummary,
    getFeeHistogram,
    quickScrape,
    getExportUrl,
} from "../api/Dashboard.api";
import type {
    DashboardSummary,
    FeeHistogram,
    ScrapeStatus,
} from "../api/Dashboard.types";

import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";


function formatAge(lastIso: string | null) {
    if (!lastIso) return { text: "Never", stale: true };

    const last = new Date(lastIso).getTime();
    const now = Date.now();
    const diffMs = Math.max(0, now - last);

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    let text = "";
    if (minutes < 60) text = `${minutes} min ago`;
    else if (hours < 24) text = `${hours} hours ago`;
    else text = `${days} days ago`;

    const STALE_DAYS = 7;
    return { text, stale: days >= STALE_DAYS };
}

function statusText(s: ScrapeStatus) {
    if (s === "idle") return "Idle";
    if (s === "running") return "Running";
    if (s === "success") return "Success";
    return "Failed";
}

type ActionLoading = null | "scrape" | "export";

export default function Dashboard() {
    const [summary, setSummary] = useState<DashboardSummary | null>(null);
    const [homeHist, setHomeHist] = useState<FeeHistogram | null>(null);
    const [intlHist, setIntlHist] = useState<FeeHistogram | null>(null);

    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<ActionLoading>(null);
    const [error, setError] = useState<string | null>(null);

    const [selectedCard, setSelectedCard] = useState<
        "total" | "unis" | "updated" | "status" | null
    >(null);

    //  control Sidebar show/hide
    const [sidebarVisible, setSidebarVisible] = useState(true);

    async function refreshDashboardData() {
        const s = await getDashboardSummary();
        const h = await getFeeHistogram();
        setSummary(s);
        setHomeHist(h.home);
        setIntlHist(h.international);
    }

    /* 8.2 Quick Scrape */
    async function handleQuickScrape() {
        try {
            setActionLoading("scrape");
            setError(null);

            await quickScrape();
            await refreshDashboardData();
        } catch (e: any) {
            setError(e?.message ?? "Quick scrape failed");
        } finally {
            setActionLoading(null);
        }
    }

    /* 8.3 Quick Export */
    function handleQuickExport() {
        try {
            setActionLoading("export");
            setError(null);

            window.location.href = getExportUrl();
        } catch (e: any) {
            setError(e?.message ?? "Export failed");
        } finally {
            setActionLoading(null);
        }
    }

    /** Fetch summary + histogram */
    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);
            try {
                const s = await getDashboardSummary();
                const h = await getFeeHistogram();

                if (!cancelled) {
                    setSummary(s);
                    setHomeHist(h.home);
                    setIntlHist(h.international);
                }
            } catch (e: any) {
                if (!cancelled) setError(e?.message ?? "Unknown error");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const age = useMemo(
        () => formatAge(summary?.lastSuccessfulScrapeAt ?? null),
        [summary?.lastSuccessfulScrapeAt],
    );

    return (
        <div className={`appShell ${sidebarVisible ? "" : "sidebar-hidden"}`}>
            {sidebarVisible ? (
                <Sidebar onToggleHide={() => setSidebarVisible(false)} />
            ) : null}

            {!sidebarVisible ? (
                <button
                    className="sidebarFloatToggle"
                    type="button"
                    onClick={() => setSidebarVisible(true)}
                    aria-label="Show sidebar"
                >
                    <span className="hamburger" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                    </span>
                </button>
            ) : null}

            <main className="mainContent">
                <div className="mainInner">
                    {loading ? (
                        <div style={{ padding: 12 }}>Loading dashboard…</div>
                    ) : null}

                    <div className="pageHeader">
                        <div>
                            <h1 className="pageTitle">Dashboard</h1>
                            <p className="pageSubTitle">
                                Competitor course data overview (fees, coverage,
                                freshness)
                            </p>
                        </div>

                        <div className="headerActions">
                            <button
                                className="actionBtn"
                                type="button"
                                onClick={handleQuickScrape}
                                disabled={loading || actionLoading !== null}
                            >
                                {actionLoading === "scrape"
                                    ? "Scraping..."
                                    : "Quick Scrape"}
                            </button>

                            <button
                                className="actionBtn outline"
                                type="button"
                                onClick={handleQuickExport}
                                disabled={loading || actionLoading !== null}
                            >
                                {actionLoading === "export"
                                    ? "Exporting..."
                                    : "Quick Export"}
                            </button>
                        </div>
                    </div>

                    {error ? <div className="errorBox">{error}</div> : null}

                    {/* KPI cards */}
                    <section className="kpiGrid">
                        <div
                            className={`kpiCard clickable ${
                                selectedCard === "total" ? "active" : ""
                            }`}
                            onClick={() => setSelectedCard("total")}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) =>
                                e.key === "Enter" && setSelectedCard("total")
                            }
                        >
                            <div className="kpiTitle">Total Courses</div>
                            <div className="kpiValue">
                                {loading
                                    ? "…"
                                    : (summary?.totalCourses.toLocaleString() ??
                                      "—")}
                            </div>
                            <div className="kpiHint">
                                Currently stored in the system
                            </div>
                        </div>

                        <div
                            className={`kpiCard clickable ${
                                selectedCard === "unis" ? "active" : ""
                            }`}
                            onClick={() => setSelectedCard("unis")}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) =>
                                e.key === "Enter" && setSelectedCard("unis")
                            }
                        >
                            <div className="kpiTitle">Universities Covered</div>
                            <div className="kpiValue">
                                {loading
                                    ? "…"
                                    : (summary?.universitiesCovered ?? "—")}
                            </div>
                            <div className="kpiHint">
                                Target institutions list
                            </div>
                        </div>

                        <div
                            className={`kpiCard clickable ${
                                selectedCard === "updated" ? "active" : ""
                            }`}
                            onClick={() => setSelectedCard("updated")}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) =>
                                e.key === "Enter" && setSelectedCard("updated")
                            }
                        >
                            <div className="kpiTitle">Last Updated</div>
                            <div className="kpiValue">
                                {loading ? "…" : age.text}
                            </div>
                            <div
                                className={`kpiHint ${age.stale ? "warnText" : ""}`}
                            >
                                {age.stale
                                    ? "Stale (≥ 7 days)"
                                    : "Last successful scrape"}
                            </div>
                        </div>

                        <div
                            className={`kpiCard clickable ${
                                selectedCard === "status" ? "active" : ""
                            }`}
                            onClick={() => setSelectedCard("status")}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) =>
                                e.key === "Enter" && setSelectedCard("status")
                            }
                        >
                            <div className="kpiTitle">Status & Issues</div>
                            <div className="kpiValue statusRow">
                                {loading ? (
                                    "…"
                                ) : (
                                    <>
                                        <span
                                            className={`statusDot status-${summary?.status ?? "idle"}`}
                                        />
                                        <span>
                                            {statusText(
                                                summary?.status ?? "idle",
                                            )}
                                        </span>
                                    </>
                                )}
                            </div>
                            <div className="kpiHint">
                                {loading
                                    ? ""
                                    : `${summary?.issuesCount ?? 0} issue(s) detected`}
                            </div>
                        </div>
                    </section>

                    {/* Charts */}
                    <section className="chartsStack">
                        <section className="panel">
                            <div className="panelHeader">
                                <div>
                                    <h2 className="panelTitle">
                                        Tuition Fee Distribution (home)
                                    </h2>
                                    <div className="panelSubTitle">
                                        X: Fee range • Y: Number of courses
                                    </div>
                                </div>
                            </div>

                            <div className="chartBox">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={homeHist?.bins ?? []}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="range" />
                                        <YAxis />
                                        <Tooltip />
                                        <Bar dataKey="count" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </section>

                        <section className="panel">
                            <div className="panelHeader">
                                <div>
                                    <h2 className="panelTitle">
                                        Tuition Fee Distribution (international)
                                    </h2>
                                    <div className="panelSubTitle">
                                        X: Fee range • Y: Number of courses
                                    </div>
                                </div>
                            </div>

                            <div className="chartBox">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={intlHist?.bins ?? []}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="range" />
                                        <YAxis />
                                        <Tooltip />
                                        <Bar dataKey="count" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </section>
                    </section>
                </div>
            </main>
        </div>
    );
}
