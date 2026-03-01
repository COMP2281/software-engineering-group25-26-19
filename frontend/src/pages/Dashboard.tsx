import { useEffect, useMemo, useState } from "react";
import "./Dashboard.css";

import {
    getDashboardSummary,
    getFeeHistogram,
    getScrapes,
} from "../api/Dashboard.api";
import { getExcelExportUrl } from "../api/Excel.api";
import {
    startScraper,
    stopScraper,
    getScraperStatus,
    type ScraperStatusResponse,
} from "../api/Scraper.api";
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

    // Scraper status tracking
    const [scraperState, setScraperState] = useState<ScraperStatusResponse>({
        status: "idle",
    });

    // Poll scraper status
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await getScraperStatus();
                setScraperState((prev) => {
                    // unexpected state transition running -> idle might mean it finished
                    if (prev.status === "running" && status.status === "idle") {
                        refreshDashboardData();
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

    async function refreshDashboardData() {
        // fetch summary, fees and recent scrapes in parallel
        const [s, h, scr] = await Promise.all([
            getDashboardSummary(),
            getFeeHistogram(),
            getScrapes(),
        ]);
        setSummary(s);
        setHomeHist(h.home);
        setIntlHist(h.international);
        // store scrapes in console for now (not displayed in UI yet)
        console.debug("recent scrapes:", scr);
    }

    /* 8.2 Background Scraper Start */
    async function handleStartScrape() {
        try {
            setActionLoading("scrape");
            setError(null);

            const res = await startScraper();
            // Immediate update to running state
            setScraperState({ status: "running", pid: res.pid });
        } catch (e: unknown) {
            const msg =
                e instanceof Error ? e.message : "Failed to start scraper";
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
            const msg =
                e instanceof Error ? e.message : "Failed to stop scraper";
            setError(msg);
        } finally {
            setActionLoading(null);
        }
    }

    /* 8.3 Quick Export */
    function handleQuickExport() {
        try {
            setActionLoading("export");
            setError(null);

            window.location.href = getExcelExportUrl();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Export failed";
            setError(msg);
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
            } catch (e: unknown) {
                if (!cancelled) {
                    const msg =
                        e instanceof Error ? e.message : "Unknown error";
                    setError(msg);
                }
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
                        {scraperState.status === "running" ? (
                            <button
                                className="actionBtn"
                                type="button"
                                onClick={handleStopScrape}
                                style={{
                                    backgroundColor: "#e74c3c",
                                    borderColor: "#c0392b",
                                }}
                                disabled={actionLoading === "scrape"}
                            >
                                {actionLoading === "scrape"
                                    ? "Stopping..."
                                    : "Stop Scraper"}
                            </button>
                        ) : (
                            <button
                                className="actionBtn"
                                type="button"
                                onClick={handleStartScrape}
                                disabled={loading || actionLoading !== null}
                            >
                                {actionLoading === "scrape"
                                    ? "Starting..."
                                    : "Start Scraper"}
                            </button>
                        )}

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
                        <div className="kpiHint">Target institutions list</div>
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
                                        className={`statusDot status-${
                                            scraperState.status === "running"
                                                ? "running"
                                                : (summary?.status ?? "idle")
                                        }`}
                                    />
                                    <span>
                                        {statusText(
                                            scraperState.status === "running"
                                                ? "running"
                                                : (summary?.status ?? "idle"),
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
    );
}
