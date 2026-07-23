"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, swrConfig } from "@/lib/swr";
import { useState, useEffect } from "react";
import { countWeeksInReportMonth } from "@/lib/reports/weekly-period";
import { weeklyReportCardSubtitle, REPORT_TEMPLATES, type ManagerReportFormat } from "@/lib/reports/manager-report-format";

const TEMPLATE_LABEL: Record<string, string> = Object.fromEntries(REPORT_TEMPLATES.map((t) => [t.id, t.label]));

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

export default function ManagerReportPage() {
    const params = useParams();
    const managerId = params.managerId as string;

    const { data, error, isLoading } = useSWR(
        managerId ? `/api/reports/${managerId}` : null,
        fetcher,
        swrConfig
    );

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    const [yearOpen, setYearOpen] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState<number | null>(currentMonth);

    // Track submitted status: key = "monthly" | "week-1" | "week-2" etc.
    const [submittedMap, setSubmittedMap] = useState<Record<string, boolean>>({});

    // Fetch submission status when a month is selected — once per template the
    // manager fills (keys carry the template so multi-template managers don't
    // collide). Each template's report is a distinct (manager, template, period).
    useEffect(() => {
        if (selectedMonth === null || !managerId) return;
        const m = data?.manager;
        const fmts: string[] = (m?.reportFormats?.length ? m.reportFormats : [m?.reportFormat ?? "production"]);
        const year = currentYear;

        for (const tmpl of fmts) {
            fetch(`/api/reports/${managerId}/monthly/${selectedMonth}?year=${year}&template=${tmpl}`)
                .then(r => r.json())
                .then(d => {
                    setSubmittedMap(prev => ({ ...prev, [`monthly-${selectedMonth}-${tmpl}`]: !!(d.submitted && d.locked) }));
                })
                .catch(() => {});

            const weekCount = countWeeksInReportMonth(year, selectedMonth);
            for (let w = 1; w <= weekCount; w++) {
                const week = w;
                fetch(`/api/reports/${managerId}/weekly/${week}?month=${selectedMonth}&year=${year}&template=${tmpl}`)
                    .then(r => r.json())
                    .then(d => {
                        setSubmittedMap(prev => ({ ...prev, [`week-${week}-${selectedMonth}-${tmpl}`]: !!(d.submitted && d.locked) }));
                    })
                    .catch(() => {});
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMonth, managerId, data]);

    // Only show months from January up to the current month (inclusive)
    const availableMonths = MONTH_NAMES.slice(0, currentMonth + 1);

    if (isLoading) {
        return (
            <div className="space-y-6">
                {/* Skeleton header */}
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-white/5 animate-pulse" />
                    <div className="space-y-2">
                        <div className="w-48 h-4 rounded bg-white/5 animate-pulse" />
                        <div className="w-32 h-3 rounded bg-white/5 animate-pulse" />
                    </div>
                </div>
                {/* Skeleton cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="h-16 rounded-lg bg-white/5 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
                <p className="text-sm text-red-400">Failed to load report data.</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-md text-xs text-white transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    const manager = data?.manager;

    const canViewReports = manager?.reportEligible === true;
    // Templates this manager fills (designation-driven; falls back to the single
    // legacy format). One card group is rendered per template.
    const reportFormats = ((manager?.reportFormats?.length ? manager.reportFormats : [manager?.reportFormat ?? "production"]) as ManagerReportFormat[]);

    return (
        <div className="space-y-5 max-w-6xl pl-6 pr-4 pt-2">
            {/* ── Page Title ──────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {manager?.profilePictureUrl ? (
                        <img
                            src={manager.profilePictureUrl}
                            alt={manager.name}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-full object-cover ring-2 ring-violet-500/30"
                        />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-violet-600/30 flex items-center justify-center text-white text-sm font-bold ring-2 ring-violet-500/30">
                            {manager?.name?.charAt(0)?.toUpperCase() || "?"}
                        </div>
                    )}
                    <div>
                        <h1 className="text-lg font-bold text-white leading-tight">Managers Report</h1>
                        <p className="text-xs text-slate-400 mt-0.5">
                            {manager?.name} &middot;{" "}
                            <span className="capitalize">{manager?.orgLevel?.replace("_", " ")}</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Year Selector ─────────────────────────────── */}
            <div>
                <button
                    onClick={() => { setYearOpen(!yearOpen); }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-gradient-to-r from-violet-500/10 to-fuchsia-500/5 border border-violet-500/20 text-white font-medium text-sm hover:from-violet-500/20 hover:to-fuchsia-500/10 transition-all duration-200 shadow-sm shadow-violet-500/5 mb-3"
                >
                    <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {currentYear}
                    <svg
                        className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${yearOpen ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {/* ── Months Accordion List ─────────────────────── */}
                {yearOpen && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                        {availableMonths.map((month, index) => {
                            const isCurrentMonth = index === currentMonth;
                            const isSelected = selectedMonth === index;

                            return (
                                <div key={index} className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] overflow-hidden transition-all duration-300 shadow-sm w-full">
                                    {/* Month Header / Trigger */}
                                    <button
                                        onClick={() => setSelectedMonth(isSelected ? null : index)} // toggle month open/close
                                        className={`w-full flex items-center justify-between px-4 py-3 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-white/[0.03] ${
                                            isSelected ? "bg-violet-50/50 dark:bg-violet-500/5 border-b border-violet-100 dark:border-violet-500/10" : ""
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-md flex items-center justify-center text-[13px] font-bold transition-colors ${
                                                isSelected 
                                                    ? "bg-violet-600 text-white ring-2 ring-violet-500/20 shadow-sm" 
                                                    : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10"
                                            }`}>
                                                {String(index + 1).padStart(2, "0")}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-sm font-medium transition-colors ${isSelected ? "text-violet-900 dark:text-white" : "text-slate-700 dark:text-slate-300"}`}>
                                                    {month}
                                                </span>
                                                {isCurrentMonth && (
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ml-2 ${
                                                        isSelected 
                                                            ? "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300" 
                                                            : "bg-slate-50 text-slate-400 dark:bg-white/5 dark:text-slate-500"
                                                    }`}>
                                                        Current
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <svg
                                            className={`w-4 h-4 transition-transform duration-300 ${isSelected ? "rotate-180 text-violet-600 dark:text-violet-400" : "text-slate-400"}`}
                                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>

                                    {/* Month Content - Report Period Options */}
                                    {isSelected && (
                                        <div className="p-3 bg-slate-50/50 dark:bg-white/[0.01] animate-in slide-in-from-top-2 fade-in duration-300">
                                            {/* Auto-fill responsive grid. Min-width is 158px so 6 cards
                                                (Monthly + 5 weeks) still fit on a single row at common
                                                laptop widths (1366px) once the sidebar is open. Cards
                                                grow to fill any extra space via the `1fr` max. */}
                                            {reportFormats.map((tmpl) => {
                                              const hideWeeklyForHr = tmpl === "hr";
                                              return (
                                              <div key={tmpl} className="mb-4 last:mb-0">
                                                {reportFormats.length > 1 && (
                                                  <p className="text-[11px] font-bold uppercase tracking-wide text-violet-500 dark:text-violet-300 mb-2">{TEMPLATE_LABEL[tmpl] ?? tmpl} report</p>
                                                )}
                                                <div
                                                  className="grid gap-3"
                                                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(158px, 1fr))" }}
                                                >

                                                {/* 1. Monthly Report Card */}
                                                {canViewReports ? (
                                                    <Link href={`/dashboard/reports/${managerId}/monthly/${index}?year=${currentYear}&template=${tmpl}`} className="relative flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3 p-3.5 rounded-lg border border-violet-200 dark:border-violet-500/30 bg-white dark:bg-violet-500/10 hover:bg-violet-50 dark:hover:bg-violet-500/20 hover:border-violet-300 dark:hover:border-violet-500/50 transition-all duration-200 shadow-sm group">
                                                        {submittedMap[`monthly-${index}-${tmpl}`] && (
                                                            <span className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-full bg-green-500 shadow-sm">
                                                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            </span>
                                                        )}
                                                        <div className={`w-10 h-10 shrink-0 rounded-md flex items-center justify-center transition-colors ${submittedMap[`monthly-${index}-${tmpl}`] ? "bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400" : "bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 group-hover:bg-violet-200 dark:group-hover:bg-violet-500/30 group-hover:text-violet-700 dark:group-hover:text-violet-300"}`}>
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-[13px] font-medium text-violet-900 dark:text-violet-100 group-hover:text-violet-700 dark:group-hover:text-white transition-colors truncate">Monthly Report</p>
                                                            <p className={`text-[11px] mt-0.5 truncate ${submittedMap[`monthly-${index}-${tmpl}`] ? "text-green-600 dark:text-green-400 font-medium" : "text-violet-600 dark:text-violet-300/70"}`}>
                                                                {submittedMap[`monthly-${index}-${tmpl}`] ? "Submitted" : "Full overview"}
                                                            </p>
                                                        </div>
                                                    </Link>
                                                ) : (
                                                    <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] opacity-75 group cursor-not-allowed">
                                                        <div className="w-10 h-10 shrink-0 rounded-md bg-slate-200 dark:bg-white/10 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400 truncate">Monthly Report</p>
                                                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">Coming soon for this role</p>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Weekly reports (count varies by month) — hidden for HR Manager (Tanvi) */}
                                                {!hideWeeklyForHr &&
                                                    Array.from(
                                                        { length: countWeeksInReportMonth(currentYear, index) },
                                                        (_, i) => i + 1,
                                                    ).map((week) =>
                                                    canViewReports ? (
                                                        <Link
                                                            key={week}
                                                            href={`/dashboard/reports/${managerId}/weekly/${week}?month=${index}&year=${currentYear}&template=${tmpl}`}
                                                            className="relative flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1a32] hover:bg-amber-50 dark:hover:bg-amber-500/5 hover:border-amber-200 dark:hover:border-amber-500/30 transition-all duration-200 shadow-sm group"
                                                        >
                                                            {submittedMap[`week-${week}-${index}-${tmpl}`] && (
                                                                <span className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-full bg-green-500 shadow-sm">
                                                                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                    </svg>
                                                                </span>
                                                            )}
                                                            <div className={`w-10 h-10 shrink-0 rounded-md flex items-center justify-center transition-colors ${submittedMap[`week-${week}-${index}-${tmpl}`] ? "bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400" : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 group-hover:bg-amber-100 dark:group-hover:bg-amber-500/20 group-hover:text-amber-600 dark:group-hover:text-amber-400"}`}>
                                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                                                </svg>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-[13px] font-medium text-slate-800 dark:text-slate-200 group-hover:text-amber-800 dark:group-hover:text-amber-200 transition-colors truncate">Week {week} Report</p>
                                                                <p className={`text-[11px] mt-0.5 truncate ${submittedMap[`week-${week}-${index}-${tmpl}`] ? "text-green-600 dark:text-green-400 font-medium" : "text-slate-500 dark:text-slate-400"}`}>
                                                                    {submittedMap[`week-${week}-${index}-${tmpl}`] ? "Submitted" : weeklyReportCardSubtitle(tmpl)}

                                                                </p>
                                                            </div>
                                                        </Link>
                                                    ) : (
                                                        <div key={week} className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] opacity-60 cursor-not-allowed">
                                                            <div className="w-10 h-10 shrink-0 rounded-md bg-slate-200 dark:bg-white/10 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                                                </svg>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400 truncate">Week {week} Report</p>
                                                                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">Not available for this role</p>
                                                            </div>
                                                        </div>
                                                    )
                                                )}

                                                </div>
                                              </div>
                                              );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            
            {!yearOpen && (
                <div className="text-slate-500 text-xs italic mt-3 opacity-70">
                    Click the year button above to view reports by month.
                </div>
            )}
        </div>
    );
}
