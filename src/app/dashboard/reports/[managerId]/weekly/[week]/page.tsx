"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { formatWeeklyReportPeriodLabel, countWeeksInReportMonth } from "@/lib/reports/weekly-period";
import type { ManagerReportFormat } from "@/lib/reports/manager-report-format";
import RefreshTeamSnapshotButton from "@/components/reports/RefreshTeamSnapshotButton";

function getStatusColor(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("done") || s.includes("complete")) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300";
    if (s.includes("script") || s.includes("writing")) return "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300";
    if (s.includes("edit") || s.includes("video")) return "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300";
    if (s.includes("review") || s.includes("qa")) return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
    if (s.includes("research")) return "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300";
    if (s.includes("hold") || s.includes("block")) return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
    return "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";
}

/* ─────────────────────────────── Constants ─────────────────────────────── */
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

// Report template from API (`reportFormat`) — role + orgLevel, with name fallback in lib

/* ─────────────────────────────── Types ─────────────────────────────────── */
interface WriterRow {
    id: string;
    writerName: string;
    caseName: string;
    subtaskName: string;
    caseStatus: string;
    heroCase: "yes" | "no" | "";
    tatFirstDraft: string;
    tatRevision: string;
    reasonTatExceeding: string;
    actionTaken: string;
    qualityScore: string;
    remark: string;
    autoFilled?: boolean; // true = row came from DB auto-fill → lock DB columns
}

interface EditorRow {
    id: string;
    editorName: string;
    caseName: string;
    caseStatus: string;
    heroCase: "yes" | "no" | "";
    tatEditing: string;
    tatRevision: string;
    reasonTatExceeding: string;
    actionTaken: string;
    qualityScore: string;
    remark: string;
}

interface QuickOverviewRow {
    id: string;
    weekDateRange: string;
    winOfWeek: string;
    roadblock: string;
    researcherOfWeek: string;
    totalFoiaPitched: string;
    totalFoiaReceived: string;
    totalFinalCases: string;
    reasonVariance: string;
    fiveStarCases: string;
    fiveStarRemarks: string;
    remark: string;
}

interface ResearcherRow {
    id: string;
    researcher: string;
    dailyTargetsMet: string;
    approvedCasesRTC: string;
    avgRating: string;
    foiaResearched: string;
    foiaPitched: string;
    foiaReceived: string;
    overallRemarks: string;
}

interface ClickUpRow {
    id: string;
    editorName: string;
    caseName: string;
    subtaskName: string;
    caseStatus: string;
    heroCase: "yes" | "no" | "";
    tatFirstDraft: string;
    tatRevision: string;
    reasonTatExceeding: string;
    actionTaken: string;
    qualityScore: string;
    remark: string;
    autoFilled?: boolean;
}

const mkWriter = (id: string, name = ""): WriterRow => ({
    id, writerName: name, caseName: "", subtaskName: "", caseStatus: "", heroCase: "",
    tatFirstDraft: "", tatRevision: "", reasonTatExceeding: "", actionTaken: "", qualityScore: "", remark: "",
});
const mkEditor = (id: string, name = ""): EditorRow => ({
    id, editorName: name, caseName: "", caseStatus: "", heroCase: "",
    tatEditing: "", tatRevision: "", reasonTatExceeding: "", actionTaken: "", qualityScore: "", remark: "",
});
const mkOverview = (id: string): QuickOverviewRow => ({
    id, weekDateRange: "", winOfWeek: "", roadblock: "",
    researcherOfWeek: "", totalFoiaPitched: "", totalFoiaReceived: "",
    totalFinalCases: "", reasonVariance: "", fiveStarCases: "", fiveStarRemarks: "", remark: "",
});
const mkResearcher = (id: string, name = ""): ResearcherRow => ({
    id, researcher: name, dailyTargetsMet: "", approvedCasesRTC: "",
    avgRating: "", foiaResearched: "", foiaPitched: "", foiaReceived: "", overallRemarks: "",
});

const mkClickUp = (id: string, name = ""): ClickUpRow => ({
    id, editorName: name, caseName: "", subtaskName: "", caseStatus: "", heroCase: "",
    tatFirstDraft: "", tatRevision: "", reasonTatExceeding: "", actionTaken: "", qualityScore: "", remark: "",
});

interface AndrewRow {
    id: string;
    caseName: string;
    caseStatus: string;
    capsuleName: string;
    caseRating: string;
    caseType: string;
    writer: string;
    qaScriptStartDate: string;
    ratingByQA: string;
    ratingReason: string;
    writerQualityScore: string;
    structuralChanges: string;
    remark: string;
    autoFilled?: boolean;
}
const mkAndrew = (id: string): AndrewRow => ({
    id, caseName: "", caseStatus: "", capsuleName: "", caseRating: "", caseType: "Normal",
    writer: "", qaScriptStartDate: "", ratingByQA: "", ratingReason: "",
    writerQualityScore: "", structuralChanges: "", remark: "",
});

interface AbhishekRow {
    id: string;
    caseName: string;
    capsuleName: string;
    caseRating: string;
    caseType: string;
    writer: string;
    writerQualityScore: string;
    editor: string;
    qaVideoStartDate: string;
    ratingByAbhishek: string;
    ratingReason: string;
    editorQualityScore: string;
    structuralChanges: string;
    remark: string;
    autoFilled?: boolean;
}
const mkAbhishek = (id: string): AbhishekRow => ({
    id, caseName: "", capsuleName: "", caseRating: "", caseType: "Normal",
    writer: "", writerQualityScore: "", editor: "", qaVideoStartDate: "",
    ratingByAbhishek: "", ratingReason: "", editorQualityScore: "", structuralChanges: "", remark: "",
});

interface SectionBRow {
    id: string;
    reviewer: string;
    targetForWeek: string;
    totalReviewsDone: string;
    reasonVariance: string;
    avgRating: string;
    casesMajorChanges: string;
    bestCase: string;
    leastInterestingCase: string;
    suggestedPattern: string;
    repetitiveIssues: string;
    winLastWeek: string;
    roadblockLastWeek: string;
    remark: string;
}
const mkSectionB = (id: string, reviewer = "", targetForWeek = "10"): SectionBRow => ({
    id, reviewer, targetForWeek, totalReviewsDone: "", reasonVariance: "",
    avgRating: "", casesMajorChanges: "", bestCase: "", leastInterestingCase: "",
    suggestedPattern: "", repetitiveIssues: "", winLastWeek: "", roadblockLastWeek: "", remark: "",
});

interface SectionCRow {
    id: string;
    respectivePerson: string;
    thumbnailsDone: string;
    avgCtr: string;
    remark: string;
    autoFilled?: boolean;
}
const mkSectionC = (id: string, person = ""): SectionCRow => ({
    id, respectivePerson: person, thumbnailsDone: "", avgCtr: "", remark: "",
});

interface SectionDRow {
    id: string;
    channel: string;
    totalViews: string;
    viewsNoShorts: string;
    subscriberCount: string;
    videosUploaded: string;
    titlesChanged: string;
    remark: string;
}
const mkSectionD = (id: string, channel = "M7"): SectionDRow => ({
    id, channel, totalViews: "", viewsNoShorts: "", subscriberCount: "", videosUploaded: "", titlesChanged: "", remark: "",
});

// Section E mirrors Section D's channel table but for YouTube Shorts —
// the metrics describe shorts performance only, so the "views excluding
// shorts" column has no analogue and is dropped.
interface SectionERow {
    id: string;
    channel: string;
    totalViews: string;
    subscriberCount: string;
    shortsUploaded: string;
    titlesChanged: string;
    remark: string;
}
const mkSectionE = (id: string, channel = "M7"): SectionERow => ({
    id, channel, totalViews: "", subscriberCount: "", shortsUploaded: "", titlesChanged: "", remark: "",
});

type SectionKey = "a1" | "a2" | "a3" | "b" | "c" | "d" | "e";

/* ─────────────────────────────── Primitives ────────────────────────────── */
function ResizableTh({
    children,
    colIndex,
    widths,
    setWidths,
    tableRef,
    colCount,
    measureTrigger,
}: {
    children: React.ReactNode;
    colIndex: number;
    widths: Record<number, number>;
    setWidths: React.Dispatch<React.SetStateAction<Record<number, number>>>;
    /** Pass on colIndex===0 to trigger auto-fit for all columns on mount */
    tableRef?: React.RefObject<HTMLTableElement>;
    colCount?: number;
    /** Increment to re-trigger auto-fit after async data loads */
    measureTrigger?: number;
}) {
    const thRef = React.useRef<HTMLTableCellElement>(null);

    // Auto-fit all columns on mount and whenever measureTrigger changes (only col 0 drives this)
    React.useEffect(() => {
        if (colIndex !== 0 || !tableRef || !colCount) return;
        const run = () => {
            const table = tableRef.current;
            if (!table) return;
            const newWidths: Record<number, number> = {};
            const measureSpan = document.createElement('span');
            measureSpan.style.visibility = 'hidden';
            measureSpan.style.position = 'absolute';
            measureSpan.style.whiteSpace = 'nowrap';
            document.body.appendChild(measureSpan);
            for (let ci = 0; ci < colCount; ci++) {
                const cells = Array.from(table.rows).map(r => r.cells[ci]).filter(Boolean);
                let maxW = 0;
                cells.forEach(cell => {
                    const inp = cell.querySelector('input');
                    const sel = cell.querySelector('select');
                    let text = '';
                    if (inp) text = inp.value || inp.placeholder || '';
                    else if (sel) text = sel.options[sel.selectedIndex]?.text || '';
                    else text = cell.textContent || '';
                    const cs = window.getComputedStyle(cell);
                    measureSpan.style.font = cs.font || 'inherit';
                    measureSpan.textContent = text || 'W';
                    const extra = sel ? 30 : inp ? 16 : 8;
                    const w = measureSpan.getBoundingClientRect().width
                        + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
                        + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
                        + extra;
                    if (w > maxW) maxW = w;
                });
                newWidths[ci] = Math.max(60, Math.ceil(maxW));
            }
            document.body.removeChild(measureSpan);
            setWidths(newWidths);
        };
        // Two rAF + small timeout to let data populate before measuring
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(run, 150)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [measureTrigger]);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = thRef.current?.offsetWidth ?? 120;
        const onMove = (ev: MouseEvent) => {
            const newWidth = Math.max(60, startWidth + ev.clientX - startX);
            setWidths(prev => ({ ...prev, [colIndex]: newWidth }));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();

        const th = thRef.current;
        if (!th) return;

        const table = th.closest('table');
        if (!table) return;

        const cellIndex = th.cellIndex;
        const cells = Array.from(table.rows).map(row => row.cells[cellIndex]).filter(Boolean);

        let maxWidth = 0;

        const measureSpan = document.createElement('span');
        measureSpan.style.visibility = 'hidden';
        measureSpan.style.position = 'absolute';
        measureSpan.style.whiteSpace = 'nowrap';
        document.body.appendChild(measureSpan);

        cells.forEach(cell => {
            const input = cell.querySelector('input');
            const select = cell.querySelector('select');
            let text = '';

            if (input) {
                text = input.value || input.placeholder || '';
            } else if (select) {
                const selectedOption = select.options[select.selectedIndex];
                text = selectedOption ? selectedOption.text : '';
            } else {
                text = cell.textContent || '';
            }

            const cellStyle = window.getComputedStyle(cell);
            measureSpan.style.font = cellStyle.font || 'inherit';
            
            measureSpan.textContent = text || 'W'; // provide some fallback
            
            const paddingLeft = parseFloat(cellStyle.paddingLeft) || 0;
            const paddingRight = parseFloat(cellStyle.paddingRight) || 0;
            const borderLeft = parseFloat(cellStyle.borderLeftWidth) || 0;
            const borderRight = parseFloat(cellStyle.borderRightWidth) || 0;
            
            let extraBuffer = 8;
            if (select) extraBuffer = 30;
            else if (input) extraBuffer = 16;

            const cellWidth = measureSpan.getBoundingClientRect().width + paddingLeft + paddingRight + borderLeft + borderRight + extraBuffer;
            if (cellWidth > maxWidth) {
                maxWidth = cellWidth;
            }
        });

        document.body.removeChild(measureSpan);

        const finalWidth = Math.max(60, Math.ceil(maxWidth));
        setWidths(prev => ({ ...prev, [colIndex]: finalWidth }));
    };

    const w = widths[colIndex];
    return (
        <th
            ref={thRef}
            style={w ? { width: w, minWidth: w } : {}}
            className="relative px-3 py-[10px] text-left text-[11px] font-bold uppercase tracking-wide leading-tight text-white bg-indigo-500 border border-indigo-600 break-words select-none"
        >
            {children}
            {/* Resize handle */}
            <div
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize group/handle flex items-center justify-center z-10"
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
                title="Drag to resize · Double-click to auto-fit"
            >
                <div className="w-px h-4/5 bg-indigo-300/40 group-hover/handle:bg-white/70 transition-colors rounded-full" />
            </div>
        </th>
    );
}
// Alias for the action column (no resize handle needed)
function Th({ children }: { children: React.ReactNode }) {
    return (
        <th className="px-3 py-[10px] text-left text-[11px] font-bold uppercase tracking-wide leading-tight text-white bg-indigo-500 border border-indigo-600 break-words">
            {children}
        </th>
    );
}

function Td({ children, muted, highlight }: { children?: React.ReactNode; muted?: boolean; highlight?: boolean }) {
    return (
        <td className={[
            "px-3 py-2.5 border border-slate-200 dark:border-white/10 align-middle text-sm leading-snug",
            muted     ? "bg-slate-50 dark:bg-[#2a2a42] text-slate-500 dark:text-slate-400" : "",
            highlight ? "bg-emerald-50 dark:bg-emerald-900/20 text-slate-800 dark:text-slate-200" : "bg-white dark:bg-[#32324a] text-slate-800 dark:text-slate-200",
        ].join(" ")}>
            {children}
        </td>
    );
}

function EditInput({ value, onChange, placeholder, disabled, manual }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; manual?: boolean }) {
    const isManualFilled = manual && value && value.trim().length > 0;
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={[
                "w-full min-w-0 bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded",
                isManualFilled ? "manual-entry" : "",
                disabled ? "cursor-not-allowed opacity-60 select-none" : "",
            ].join(" ")}
        />
    );
}

function YNSelect({ value, onChange, disabled }: { value: string; onChange: (v: "yes" | "no" | "") => void; disabled?: boolean }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as "yes" | "no" | "")}
            disabled={disabled}
            className={["w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
        >
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
        </select>
    );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            title="Remove row"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-100 text-slate-300 hover:text-red-500 transition-colors"
        >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    );
}

/* ── Drag-to-scroll wrapper for horizontal table containers ── */
function DragScrollDiv({ children, className }: { children: React.ReactNode; className?: string }) {
    const ref      = React.useRef<HTMLDivElement>(null);
    const dragging = React.useRef(false);
    const startX   = React.useRef(0);
    const scrollL  = React.useRef(0);

    const onMouseDown = (e: React.MouseEvent) => {
        // No preventDefault here — allows clicks to properly focus inputs inside cells
        const el = e.target as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (["input", "select", "textarea", "a", "button"].includes(tag)) return;
        dragging.current = true;
        startX.current   = e.pageX - (ref.current?.offsetLeft ?? 0);
        scrollL.current  = ref.current?.scrollLeft ?? 0;
        if (ref.current) ref.current.style.cursor = "grabbing";
    };
    const stop = () => {
        dragging.current = false;
        if (ref.current) ref.current.style.cursor = "grab";
    };
    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragging.current || !ref.current) return;
        e.preventDefault();
        const x = e.pageX - ref.current.offsetLeft;
        ref.current.scrollLeft = scrollL.current - (x - startX.current) * 1.2;
    };

    return (
        <div
            ref={ref}
            className={className}
            style={{ cursor: "grab" }}
            onMouseDown={onMouseDown}
            onMouseLeave={stop}
            onMouseUp={stop}
            onMouseMove={onMouseMove}
        >
            {children}
        </div>
    );
}

/* ─────────────────────────────── Page ──────────────────────────────────── */
export default function WeeklyReportPage() {
    const params       = useParams();
    const router       = useRouter();
    const searchParams = useSearchParams();

    const managerId  = params.managerId as string;
    const week       = Number(params.week);
    const monthIndex = Number(searchParams.get("month") ?? new Date().getMonth());
    const monthName  = MONTH_NAMES[monthIndex] || "Unknown";
    const yearParam  = searchParams.get("year");
    const year =
        yearParam != null && yearParam !== "" && Number.isFinite(Number(yearParam))
            ? Number(yearParam)
            : new Date().getFullYear();

    const maxWeekInMonth = useMemo(
        () => (monthIndex >= 0 && monthIndex <= 11 ? countWeeksInReportMonth(year, monthIndex) : 0),
        [year, monthIndex],
    );
    const weekInvalid =
        !Number.isFinite(week) ||
        Number.isNaN(week) ||
        monthIndex < 0 ||
        monthIndex > 11 ||
        week < 1 ||
        week > maxWeekInMonth;

    // Mon–Sun week; label may span two months (same as API `getWeeklyReportPeriod`)
    const weekDateRange = useMemo(
        () => (weekInvalid ? "" : formatWeeklyReportPeriodLabel(year, monthIndex, week)),
        [week, monthIndex, year, weekInvalid],
    );

    const [activeSection, setActiveSection] = useState<SectionKey>("a1");

    const { data: session, status: sessionStatus } = useSession();
    const sessionUser = session?.user as any;
    const currentDbId   = sessionUser?.dbId;
    const isAdmin       = sessionUser?.isDeveloper === true || sessionUser?.orgLevel === "special_access";
    const isCeo         = sessionUser?.orgLevel === "ceo" && !isAdmin;
    const isOwner       = currentDbId && String(currentDbId) === String(managerId);

    // Explicit per-manager access granted by admin
    const [allowedManagerIds, setAllowedManagerIds] = useState<number[]>([]);
    useEffect(() => {
        if (!sessionUser?.dbId || isOwner || isAdmin) return;
        fetch("/api/user/report-access").then(r => r.json()).then(d => {
            setAllowedManagerIds(d.allowedManagerIds ?? []);
        }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionUser?.dbId]);
    const hasExplicitAccess = allowedManagerIds.includes(Number(managerId));

    const isCeoOrAdmin  = isCeo || isAdmin || hasExplicitAccess; // kept for compatibility
    // CEO: view-only. Admin/developer/special_access: full access like owner
    const viewOnly      = sessionStatus === "authenticated" && !isOwner && !isAdmin;

    // Drag-to-scroll for each table wrapper

    // Column resize state for each table
    const [wMeasureTrigger,  setWMeasureTrigger]  = useState(0);
    const [aMeasureTrigger,  setAMeasureTrigger]  = useState(0);
    const [abMeasureTrigger, setAbMeasureTrigger] = useState(0);
    const [refreshingAndrew,   setRefreshingAndrew]   = useState(false);
    const [refreshingAbhishek, setRefreshingAbhishek] = useState(false);
    const [wColWidths, setWColWidths] = useState<Record<number, number>>({});
    const [cColWidths, setCColWidths] = useState<Record<number, number>>({});
    const [oColWidths, setOColWidths] = useState<Record<number, number>>({});

    // Table refs for auto-fit on mount
    const wTableRef = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const cTableRef = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const oTableRef = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const aTableRef  = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const [aColWidths,  setAColWidths]  = useState<Record<number, number>>({});
    const abTableRef = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const [abColWidths, setAbColWidths] = useState<Record<number, number>>({});
    const bTableRef  = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const [bColWidths,  setBColWidths]  = useState<Record<number, number>>({});
    const sectionCTableRef  = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const [sectionCColWidths, setSectionCColWidths] = useState<Record<number, number>>({});
    const sectionDTableRef  = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const [sectionDColWidths, setSectionDColWidths] = useState<Record<number, number>>({});
    const sectionETableRef  = React.useRef<HTMLTableElement>(null) as React.RefObject<HTMLTableElement>;
    const [sectionEColWidths, setSectionEColWidths] = useState<Record<number, number>>({});

    const fetcher = (url: string) => fetch(url).then((r) => r.json());
    // Pass the report's period so the API can return the FROZEN team
    // (teamSnapshot) for locked reports — see src/lib/reports/team-snapshot.ts.
    // Drafts and legacy reports without a snapshot still get the live team.
    const { data, isLoading, error: teamLoadError } = useSWR(
        `/api/reports/${managerId}?week=${week}&month=${monthIndex}&year=${year}`,
        fetcher,
    );
    const manager     = data?.manager;
    const teamMembers: any[] = data?.teamMembers ?? [];
    // Effective report function: prefer the designation's scorecardFunction
    // (RBAC source of truth), fall back to the legacy `role`. Mirrors
    // teamFunction() on the server (team-snapshot.ts).
    const memberFn = (u: any): string => String(u?.scorecardFunction || u?.role || "").toLowerCase();


    const periodLabel = `${monthName} (${manager?.name ?? "…"} C1)`;


    // URL template wins (designation-driven fill — a manager may fill several
    // templates); fall back to the manager's single format for old links that
    // have no ?template=.
    const urlTemplate = searchParams.get("template");
    const reportFmt = (urlTemplate ?? manager?.reportFormat ?? "production") as ManagerReportFormat;
    const isResearcherReport = !isLoading && reportFmt === "researcher";
    const isQaReport = !isLoading && reportFmt === "qa";

    // Set default tab based on manager type once manager data loads
    useEffect(() => {
        if (isResearcherReport) setActiveSection("a3");
        else if (isQaReport) setActiveSection("a1");
    }, [isResearcherReport, isQaReport]);

    // Nishant: only Researcher + Overview tabs (no Writers/Editors)
    // Andrew:  only QA Review tab
    // Others:  only Writers + Editors + simple Overview
    const SECTIONS: { key: SectionKey; label: string; sub: string }[] = isResearcherReport
        ? [
            { key: "a3", label: "Section A", sub: "Researchers" },
            { key: "b",  label: "Section B", sub: "Overview"    },
          ]
        : isQaReport
        ? [
            { key: "a1", label: "Section A1", sub: "Clickup Andrew"   },
            { key: "a2", label: "Section A2", sub: "Clickup Abhishek" },
            { key: "b",  label: "Section B",  sub: ""                 },
            { key: "c",  label: "Section C",  sub: ""                 },
            { key: "d",  label: "Section D",  sub: "Long-form"        },
            { key: "e",  label: "Section E",  sub: "YT Shorts"        },
          ]
        : [
            { key: "a1", label: "Section A1", sub: "Writers"  },
            { key: "a2", label: "Section A2", sub: "Editors"  },
            { key: "b",  label: "Section B",  sub: "Overview" },
          ];

    /* Writers */
    const defaultWriters = useMemo((): WriterRow[] => {
        const list = teamMembers.filter((u) => memberFn(u) === "writer");
        return list.length > 0
            ? list.map((w) => mkWriter(String(w.id), w.name))
            : [mkWriter("w-1"), mkWriter("w-2"), mkWriter("w-3")];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const [writerRows, setWriterRows] = useState<WriterRow[] | null>(null);
    const wRows = writerRows ?? defaultWriters;
    const setW = useCallback((idx: number, f: keyof WriterRow, v: string) => {
        setWriterRows((p) => (p ?? defaultWriters).map((r, i) => i === idx ? { ...r, [f]: v } : r));
    }, [defaultWriters]);
    const addW    = () => setWriterRows((p) => [...(p ?? defaultWriters), mkWriter(`w-${Date.now()}`)]);
    const removeW = (idx: number) => setWriterRows((p) => (p ?? defaultWriters).filter((_, i) => i !== idx));

    /* Editors */
    const defaultEditors = useMemo((): EditorRow[] => {
        const list = teamMembers.filter((u) => memberFn(u) === "editor");
        return list.length > 0
            ? list.map((e) => mkEditor(String(e.id), e.name))
            : [mkEditor("e-1"), mkEditor("e-2"), mkEditor("e-3")];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const [editorRows, setEditorRows] = useState<EditorRow[] | null>(null);
    const eRows = editorRows ?? defaultEditors;
    const setE = useCallback((idx: number, f: keyof EditorRow, v: string) => {
        setEditorRows((p) => (p ?? defaultEditors).map((r, i) => i === idx ? { ...r, [f]: v } : r));
    }, [defaultEditors]);
    const addE    = () => setEditorRows((p) => [...(p ?? defaultEditors), mkEditor(`e-${Date.now()}`)]);
    const removeE = (idx: number) => setEditorRows((p) => (p ?? defaultEditors).filter((_, i) => i !== idx));

    /* Quick Overview (B) */
    const [overviewRows, setOverviewRows] = useState<QuickOverviewRow[]>([mkOverview("o-1")]);
    const setO = (idx: number, f: keyof QuickOverviewRow, v: string) =>
        setOverviewRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addO    = () => setOverviewRows((p) => [...p, mkOverview(`o-${Date.now()}`)]);
    const removeO = (idx: number) => setOverviewRows((p) => p.filter((_, i) => i !== idx));

    /* Researchers (A3) */
    const defaultResearchers = useMemo((): ResearcherRow[] => {
        const list = teamMembers.filter((u) => memberFn(u) === "researcher");
        return list.length > 0
            ? list.map((r) => mkResearcher(String(r.id), r.name))
            : [mkResearcher("r-1"), mkResearcher("r-2"), mkResearcher("r-3")];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const [researcherRows, setResearcherRows] = useState<ResearcherRow[] | null>(null);
    const rRows = researcherRows ?? defaultResearchers;
    const setR = useCallback((idx: number, f: keyof ResearcherRow, v: string) => {
        setResearcherRows((p) => (p ?? defaultResearchers).map((r, i) => i === idx ? { ...r, [f]: v } : r));
    }, [defaultResearchers]);
    const addR    = () => setResearcherRows((p) => [...(p ?? defaultResearchers), mkResearcher(`r-${Date.now()}`)]);
    const removeR = (idx: number) => setResearcherRows((p) => (p ?? defaultResearchers).filter((_, i) => i !== idx));

    /* ClickUp (A2) */
    const defaultClickUp = useMemo((): ClickUpRow[] => {
        const list = teamMembers.filter((u) => memberFn(u) === "editor");
        return list.length > 0
            ? list.map((e) => mkClickUp(String(e.id), e.name))
            : [mkClickUp("c-1"), mkClickUp("c-2"), mkClickUp("c-3")];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const [clickUpRows, setClickUpRows] = useState<ClickUpRow[] | null>(null);
    const cRows = clickUpRows ?? defaultClickUp;
    const setC = useCallback((idx: number, f: keyof ClickUpRow, v: string) => {
        setClickUpRows((p) => (p ?? defaultClickUp).map((r, i) => i === idx ? { ...r, [f]: v } : r));
    }, [defaultClickUp]);
    const addC    = () => setClickUpRows((p) => [...(p ?? defaultClickUp), mkClickUp(`c-${Date.now()}`)]);
    const removeC = (idx: number) => setClickUpRows((p) => (p ?? defaultClickUp).filter((_, i) => i !== idx));

    /* Andrew QA Review (A1) */
    const [andrewRows, setAndrewRows] = useState<AndrewRow[]>([mkAndrew("a-1")]);
    const setAR = (idx: number, f: keyof AndrewRow, v: string) =>
        setAndrewRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addAR    = () => setAndrewRows((p) => [...p, mkAndrew(`a-${Date.now()}`)]);
    const removeAR = (idx: number) => setAndrewRows((p) => p.filter((_, i) => i !== idx));

    /* Abhishek QA Review (A2) */
    const [abhishekRows, setAbhishekRows] = useState<AbhishekRow[]>([mkAbhishek("ab-1")]);
    const setAB = (idx: number, f: keyof AbhishekRow, v: string) =>
        setAbhishekRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addAB    = () => setAbhishekRows((p) => [...p, mkAbhishek(`ab-${Date.now()}`)]);
    const removeAB = (idx: number) => setAbhishekRows((p) => p.filter((_, i) => i !== idx));

    /* Section B — Quick Overview (Andrew + Abhishek) */
    const [sectionBRows, setSectionBRows] = useState<SectionBRow[]>([
        mkSectionB("b-1", "Andrew"),
        mkSectionB("b-2", "Abhishek"),
    ]);
    const setSB = (idx: number, f: keyof SectionBRow, v: string) =>
        setSectionBRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addSB    = () => setSectionBRows((p) => [...p, mkSectionB(`b-${Date.now()}`)]);
    const removeSB = (idx: number) => setSectionBRows((p) => p.filter((_, i) => i !== idx));

    /* Section C — Rohini & Shikha thumbnails (Abhishek) */
    const [sectionCRows, setSectionCRows] = useState<SectionCRow[]>([
        mkSectionC("c-1", "Rohini"),
        mkSectionC("c-2", "Shikha"),
    ]);
    const setSC = (idx: number, f: keyof SectionCRow, v: string) =>
        setSectionCRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addSC    = () => setSectionCRows((p) => [...p, mkSectionC(`c-${Date.now()}`)]);
    const removeSC = (idx: number) => setSectionCRows((p) => p.filter((_, i) => i !== idx));

    /* Section D — Views and Changes */
    const [sectionDRows, setSectionDRows] = useState<SectionDRow[]>([
        mkSectionD("d-1", "M7"),
        mkSectionD("d-2", "M7CS"),
        mkSectionD("d-3", "Bodycam"),
    ]);
    const setSD = (idx: number, f: keyof SectionDRow, v: string) =>
        setSectionDRows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addSD    = () => setSectionDRows((p) => [...p, mkSectionD(`d-${Date.now()}`)]);
    const removeSD = (idx: number) => setSectionDRows((p) => p.filter((_, i) => i !== idx));

    /* Section E — Views and Changes (YT Shorts) */
    const [sectionERows, setSectionERows] = useState<SectionERow[]>([
        mkSectionE("e-1", "M7"),
        mkSectionE("e-2", "M7CS"),
        mkSectionE("e-3", "Bodycam"),
    ]);
    const setSE = (idx: number, f: keyof SectionERow, v: string) =>
        setSectionERows((p) => p.map((r, i) => i === idx ? { ...r, [f]: v } : r));
    const addSE    = () => setSectionERows((p) => [...p, mkSectionE(`e-${Date.now()}`)]);
    const removeSE = (idx: number) => setSectionERows((p) => p.filter((_, i) => i !== idx));

    /* ── Lock / submit state ── */
    const [isLocked,     setIsLocked]     = useState(false);
    const [isSubmitted,  setIsSubmitted]  = useState(false);
    const [isDraftSaved, setIsDraftSaved] = useState(false);
    const [submitting,        setSubmitting]        = useState(false);
    // Synchronous re-entry guard for postReport. `submitting` is React
    // state — there's a render gap between click → setState → re-render
    // where the disabled prop hasn't been applied yet, so a double-click
    // (or Submit clicked while a Save-Draft is mid-flight) can fire two
    // concurrent POSTs. A ref is checked synchronously in postReport
    // before the await, so the second click is dropped immediately.
    const submitInFlight = React.useRef(false);
    const [submitError,       setSubmitError]       = useState<string | null>(null);
    const [statusLoaded,      setStatusLoaded]      = useState(false);
    const [showConfirm,       setShowConfirm]       = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingDraft,     setDeletingDraft]     = useState(false);
    const [refreshingWriters, setRefreshingWriters] = useState(false);
    const [refreshingEditors, setRefreshingEditors] = useState(false);
    const autoFillDoneRef = React.useRef(false);

    // Fetch submission status on mount
    useEffect(() => {
        if (!managerId || isNaN(week) || isNaN(monthIndex) || weekInvalid) return;
        fetch(`/api/reports/${managerId}/weekly/${week}?month=${monthIndex}&year=${year}${urlTemplate ? `&template=${urlTemplate}` : ""}`)
            .then(r => r.json())
            .then(d => {
                if (d.submitted) {
                    setIsSubmitted(d.locked);
                    setIsDraftSaved(!d.locked);
                    setIsLocked(d.locked);
                    // Pre-fill form with saved data
                    const saved = d.data as any;
                    if (saved?.writerRows)      setWriterRows(saved.writerRows.map((r: any) => ({ subtaskName: "", ...r })));
                    if (saved?.writerRows)      setAndrewRows(saved.writerRows);    // Andrew reuses writerRows column
                    if (saved?.editorRows)      setAbhishekRows(saved.editorRows);  // Abhishek reuses editorRows column
                    if (saved?.overviewRows)    setSectionBRows(saved.overviewRows);   // Andrew Section B
                    if (saved?.researcherRows)  setSectionCRows(saved.researcherRows); // Andrew Section C
                    if (saved?.viewsRows)       setSectionDRows(saved.viewsRows);       // Andrew Section D
                    if (saved?.shortsRows)      setSectionERows(saved.shortsRows);      // Andrew Section E
                    if (saved?.editorRows)      setClickUpRows(saved.editorRows.map((r: any) => ({ subtaskName: "", ...r })));  // API returns editorRows
                    else if (saved?.clickUpRows) setClickUpRows(saved.clickUpRows.map((r: any) => ({ subtaskName: "", ...r }))); // legacy key
                    if (saved?.overviewRows)    setOverviewRows(saved.overviewRows);
                    if (saved?.researcherRows)  setResearcherRows(saved.researcherRows);
                }
                setStatusLoaded(true);
            })
            .catch(() => setStatusLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, week, monthIndex, year, weekInvalid]);

    // Shared helper — fetch writer cases from DB and populate rows
    const fetchAndFillWriterCases = useCallback((merge = false) => {
        if (isQaReport || isResearcherReport) return;
        setRefreshingWriters(true);
        fetch(`/api/reports/${managerId}/weekly/${week}/writer-cases?month=${monthIndex}&year=${year}`)
            .then(r => r.json())
            .then(d => {
                const writerCases: any[] = d.writerCases ?? [];

                const casesByWriter = new Map<number, any[]>();
                for (const c of writerCases) {
                    if (c.writerId == null) continue;
                    if (!casesByWriter.has(c.writerId)) casesByWriter.set(c.writerId, []);
                    casesByWriter.get(c.writerId)!.push(c);
                }

                const rows: WriterRow[] = [];
                const coveredWriterIds = new Set<number>();
                for (const dw of defaultWriters) {
                    const wid = parseInt(dw.id, 10);
                    const cases = Number.isFinite(wid) ? (casesByWriter.get(wid) ?? []) : [];
                    if (cases.length === 0) continue;
                    coveredWriterIds.add(wid);
                    cases.forEach((c, ci) => {
                        rows.push({
                            id: `w-${c.writerId}-${ci}-${Date.now()}`,
                            writerName:         c.writerName,
                            caseName:           c.caseName,
                            subtaskName:        c.subtaskName ?? "",
                            caseStatus:         c.caseStatus ?? "",
                            heroCase:           c.heroCase as "yes" | "no" | "",
                            tatFirstDraft:      c.tatFirstDraft,
                            tatRevision:        c.tatRevision,
                            reasonTatExceeding: "",
                            actionTaken:        "",
                            qualityScore:       c.qualityScore,
                            remark:             "",
                            autoFilled:         true,
                        });
                    });
                }
                for (const [wid, cases] of casesByWriter) {
                    if (coveredWriterIds.has(wid)) continue;
                    cases.forEach((c, ci) => {
                        rows.push({
                            id: `w-${c.writerId}-${ci}-${Date.now()}`,
                            writerName:         c.writerName,
                            caseName:           c.caseName,
                            subtaskName:        c.subtaskName ?? "",
                            caseStatus:         c.caseStatus ?? "",
                            heroCase:           c.heroCase as "yes" | "no" | "",
                            tatFirstDraft:      c.tatFirstDraft,
                            tatRevision:        c.tatRevision,
                            reasonTatExceeding: "",
                            actionTaken:        "",
                            qualityScore:       c.qualityScore,
                            remark:             "",
                            autoFilled:         true,
                        });
                    });
                }

                if (merge) {
                    // Keep saved rows intact; only append cases whose caseName is new
                    setWriterRows(prev => {
                        const existing = prev ?? defaultWriters;
                        const savedNames = new Set(
                            existing.map(r => (r.caseName ?? "").toLowerCase().trim()).filter(Boolean)
                        );
                        const newRows = rows.filter(
                            r => !savedNames.has((r.caseName ?? "").toLowerCase().trim())
                        );
                        return newRows.length > 0 ? [...existing, ...newRows] : existing;
                    });
                } else {
                    setWriterRows(rows);
                }
                setTimeout(() => setWMeasureTrigger(t => t + 1), 200);
            })
            .catch(() => {})
            .finally(() => setRefreshingWriters(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, week, monthIndex, year, isQaReport, isResearcherReport, defaultWriters]);

    // Fetch editor cases and auto-fill Section A2
    const fetchAndFillEditorCases = useCallback((merge = false) => {
        if (isQaReport || isResearcherReport) return;
        setRefreshingEditors(true);
        fetch(`/api/reports/${managerId}/weekly/${week}/editor-cases?month=${monthIndex}&year=${year}`)
            .then(r => r.json())
            .then(d => {
                const editorCases: any[] = d.editorCases ?? [];
                const casesByEditor = new Map<number, any[]>();
                for (const c of editorCases) {
                    if (c.editorId == null) continue;
                    if (!casesByEditor.has(c.editorId)) casesByEditor.set(c.editorId, []);
                    casesByEditor.get(c.editorId)!.push(c);
                }
                const rows: ClickUpRow[] = [];
                const coveredEditorIds = new Set<number>();
                for (const de of defaultClickUp) {
                    const eid = parseInt(de.id, 10);
                    const cases = Number.isFinite(eid) ? (casesByEditor.get(eid) ?? []) : [];
                    if (cases.length === 0) continue;
                    coveredEditorIds.add(eid);
                    cases.forEach((c, ci) => {
                        rows.push({
                            id:                 `e-${c.editorId}-${ci}-${Date.now()}`,
                            editorName:         c.editorName,
                            caseName:           c.caseName,
                            subtaskName:        c.subtaskName ?? "",
                            caseStatus:         c.caseStatus ?? "",
                            heroCase:           c.heroCase as "yes" | "no" | "",
                            tatFirstDraft:      c.tatEditing,
                            tatRevision:        c.tatRevision,
                            reasonTatExceeding: "",
                            actionTaken:        "",
                            qualityScore:       c.qualityScore,
                            remark:             "",
                            autoFilled:         true,
                        });
                    });
                }
                for (const [eid, cases] of casesByEditor) {
                    if (coveredEditorIds.has(eid)) continue;
                    cases.forEach((c, ci) => {
                        rows.push({
                            id:                 `e-${c.editorId}-${ci}-${Date.now()}`,
                            editorName:         c.editorName,
                            caseName:           c.caseName,
                            subtaskName:        c.subtaskName ?? "",
                            caseStatus:         c.caseStatus ?? "",
                            heroCase:           c.heroCase as "yes" | "no" | "",
                            tatFirstDraft:      c.tatEditing,
                            tatRevision:        c.tatRevision,
                            reasonTatExceeding: "",
                            actionTaken:        "",
                            qualityScore:       c.qualityScore,
                            remark:             "",
                            autoFilled:         true,
                        });
                    });
                }
                if (merge) {
                    // Keep saved rows intact; only append cases whose caseName is new
                    setClickUpRows(prev => {
                        const existing = prev ?? defaultClickUp;
                        const savedNames = new Set(
                            existing.map(r => (r.caseName ?? "").toLowerCase().trim()).filter(Boolean)
                        );
                        const newRows = rows.filter(
                            r => !savedNames.has((r.caseName ?? "").toLowerCase().trim())
                        );
                        return newRows.length > 0 ? [...existing, ...newRows] : existing;
                    });
                } else {
                    setClickUpRows(rows);
                }
            })
            .catch(() => {})
            .finally(() => setRefreshingEditors(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, week, monthIndex, year, isQaReport, isResearcherReport, defaultClickUp]);

    // Fetch cases where qaVideoMeetingDate falls in this week and auto-fill Section A2 (Abhishek)
    const fetchAndFillAbhishekCases = useCallback(() => {
        if (!isQaReport) return;
        setRefreshingAbhishek(true);
        fetch(`/api/reports/${managerId}/weekly/${week}/andrew-video-cases?month=${monthIndex}&year=${year}`)
            .then(r => r.json())
            .then(d => {
                const videoCases: any[] = d.videoCases ?? [];
                if (videoCases.length === 0) return;
                const rows: AbhishekRow[] = videoCases.map((c, i) => ({
                    id:                 `ab-${i}-${Date.now()}`,
                    caseName:           c.caseName,
                    capsuleName:        c.capsuleName,
                    caseRating:         c.caseRating,
                    caseType:           c.caseType,
                    writer:             c.writerName,
                    writerQualityScore: c.writerQualityScore,
                    editor:             c.editorName,
                    qaVideoStartDate:   c.qaVideoStartDate,
                    ratingByAbhishek:   c.videoQualityRating,
                    editorQualityScore: c.editorQualityScore,
                    ratingReason:       "",
                    structuralChanges:  "",
                    remark:             "",
                    autoFilled:         true,
                }));
                setAbhishekRows(rows);
                setTimeout(() => setAbMeasureTrigger(t => t + 1), 200);
            })
            .catch(() => {})
            .finally(() => setRefreshingAbhishek(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, week, monthIndex, year, isQaReport]);

    // Fetch cases where scriptQaStartDate falls in this week and auto-fill Andrew Section A1
    const fetchAndFillAndrewCases = useCallback(() => {
        if (!isQaReport) return;
        setRefreshingAndrew(true);
        fetch(`/api/reports/${managerId}/weekly/${week}/andrew-cases?month=${monthIndex}&year=${year}`)
            .then(r => r.json())
            .then(d => {
                const andrewCases: any[] = d.andrewCases ?? [];
                if (andrewCases.length === 0) return;
                const rows: AndrewRow[] = andrewCases.map((c, i) => ({
                    id:                `a-${i}-${Date.now()}`,
                    caseName:          c.caseName,
                    caseStatus:        c.caseStatus ?? "",
                    capsuleName:       c.capsuleName,
                    caseRating:        c.caseRating,
                    caseType:          c.caseType,
                    writer:            c.writerName,
                    qaScriptStartDate: c.qaScriptStartDate,
                    writerQualityScore:c.writerQualityScore,
                    ratingByQA:        c.scriptQualityRating ?? "N/A",
                    ratingReason:      "",
                    structuralChanges: "",
                    remark:            "",
                    autoFilled:        true,
                }));
                setAndrewRows(rows);
                setTimeout(() => setAMeasureTrigger(t => t + 1), 200);
            })
            .catch(() => {})
            .finally(() => setRefreshingAndrew(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, week, monthIndex, year, isQaReport]);

    // Fetch completed "Thumbnail" subtasks for this week and auto-fill Section C
    const fetchAndFillThumbnailCases = useCallback(() => {
        if (!isQaReport) return;
        fetch(`/api/reports/${managerId}/weekly/${week}/andrew-thumbnail-cases?month=${monthIndex}&year=${year}`)
            .then(r => r.json())
            .then(d => {
                const thumbnailData: { person: string; thumbnailsDone: string }[] = d.thumbnailData ?? [];
                if (thumbnailData.length === 0) return;
                setSectionCRows(prev => prev.map(row => {
                    const match = thumbnailData.find(t =>
                        t.person.toLowerCase().startsWith(row.respectivePerson.toLowerCase()) ||
                        row.respectivePerson.toLowerCase().startsWith(t.person.toLowerCase())
                    );
                    if (!match) return row;
                    return { ...row, thumbnailsDone: match.thumbnailsDone, autoFilled: true };
                }));
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, week, monthIndex, year, isQaReport]);

    // Auto-fill on load — always refresh from DB on open, unless locked.
    // Uses a ref to fire only once per page load (ignores SWR revalidations).
    useEffect(() => {
        if (weekInvalid || !statusLoaded || isLoading || teamLoadError || data == null) return;
        if (isLocked || isSubmitted) return;
        if (autoFillDoneRef.current) return;
        autoFillDoneRef.current = true;
        if (isQaReport) {
            fetchAndFillAndrewCases();
            fetchAndFillAbhishekCases();
            fetchAndFillThumbnailCases();
            return;
        }
        if (isResearcherReport) return;
        fetchAndFillWriterCases(isDraftSaved);
        fetchAndFillEditorCases(isDraftSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        statusLoaded,
        isLoading,
        teamLoadError,
        data,
        isQaReport,
        isResearcherReport,
        weekInvalid,
        isDraftSaved,
        managerId,
        week,
        monthIndex,
        year,
    ]);

    // Auto-compute Section B totals/averages from Section A1 (Andrew) and A2 (Abhishek)
    useEffect(() => {
        if (!isQaReport || isLocked || isSubmitted || isDraftSaved) return;
        const andrewCount = andrewRows.filter(r => r.caseName && r.caseName !== "N/A").length;
        const abhishekCount = abhishekRows.filter(r => r.caseName && r.caseName !== "N/A").length;

        const andrewRatings = andrewRows.map(r => parseFloat(r.ratingByQA)).filter(n => !isNaN(n));
        const abhishekRatings = abhishekRows.map(r => parseFloat(r.ratingByAbhishek)).filter(n => !isNaN(n));

        const andrewAvg = andrewRatings.length
            ? (andrewRatings.reduce((s, n) => s + n, 0) / andrewRatings.length).toFixed(2)
            : "";
        const abhishekAvg = abhishekRatings.length
            ? (abhishekRatings.reduce((s, n) => s + n, 0) / abhishekRatings.length).toFixed(2)
            : "";

        setSectionBRows(prev => prev.map(row => {
            if (row.reviewer === "Andrew") return {
                ...row,
                totalReviewsDone: andrewCount > 0 ? String(andrewCount) : row.totalReviewsDone,
                avgRating: andrewAvg || row.avgRating,
            };
            if (row.reviewer === "Abhishek") return {
                ...row,
                totalReviewsDone: abhishekCount > 0 ? String(abhishekCount) : row.totalReviewsDone,
                avgRating: abhishekAvg || row.avgRating,
            };
            return row;
        }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [andrewRows, abhishekRows, isQaReport]);

    const validateRequired = (): string | null => {
        if (isQaReport || isResearcherReport) return null; // Andrew and Nishant have their own required-field logic inline
        for (let i = 0; i < wRows.length; i++) {
            const r = wRows[i];
            if (!r.writerName.trim())    return `Writer row ${i + 1}: Writer Name is required.`;
            if (!r.caseName.trim())      return `Writer row ${i + 1}: Case Name is required.`;
            if (!r.heroCase)             return `Writer row ${i + 1}: Hero Case (Yes/No) is required.`;
            if (!r.tatFirstDraft.trim())       return `Writer row ${i + 1}: TAT — First Draft is required.`;
            if (!r.tatRevision.trim())        return `Writer row ${i + 1}: TAT — Revision is required.`;
            if (!r.qualityScore.trim())       return `Writer row ${i + 1}: Quality Score is required.`;
        }
        for (let i = 0; i < cRows.length; i++) {
            const r = cRows[i];
            if (!r.editorName.trim())    return `Editor row ${i + 1}: Editor Name is required.`;
            if (!r.caseName.trim())      return `Editor row ${i + 1}: Case Name is required.`;
            if (!r.heroCase)             return `Editor row ${i + 1}: Hero Case (Yes/No) is required.`;
            if (!r.tatFirstDraft.trim())       return `Editor row ${i + 1}: TAT — First Draft is required.`;
            if (!r.tatRevision.trim())        return `Editor row ${i + 1}: TAT for Revision is required.`;
            if (!r.qualityScore.trim())       return `Editor row ${i + 1}: Quality Score is required.`;
        }
        for (let i = 0; i < overviewRows.length; i++) {
            const r = overviewRows[i];
            if (!r.winOfWeek.trim()) return `Overview row ${i + 1}: Win of the Week is required.`;
            if (!r.roadblock.trim()) return `Overview row ${i + 1}: Roadblock is required.`;
        }
        return null;
    };

    const postReport = async (isDraft: boolean) => {
        if (isLocked) return;
        if (!isDraft) {
            const err = validateRequired();
            if (err) { setSubmitError(err); setShowConfirm(false); return; }
        }
        if (submitInFlight.current) return;
        submitInFlight.current = true;
        setSubmitting(true);
        setSubmitError(null);
        setShowConfirm(false);
        try {
            const res = await fetch(`/api/reports/${managerId}/weekly/${week}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    month: monthIndex,
                    year,
                    isDraft,
                    template: reportFmt,
                    writerRows:      isQaReport ? andrewRows   : wRows,
                    editorRows:      isQaReport ? abhishekRows : cRows,
                    overviewRows:    isQaReport ? sectionBRows  : overviewRows,
                    researcherRows:  isResearcherReport ? rRows : isQaReport ? sectionCRows : null,
                    viewsRows:       isQaReport ? sectionDRows : null,
                    shortsRows:      isQaReport ? sectionERows : null,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Submission failed");
            if (isDraft) {
                setIsDraftSaved(true);
                setIsSubmitted(false);
            } else {
                setIsSubmitted(true);
                setIsDraftSaved(false);
                setIsLocked(true);
                // Bounce the manager back to their reports overview so they
                // can see the freshly-locked week alongside the rest of the
                // year. Uses replace so Back doesn't return to the editable
                // form (which is now read-only anyway).
                router.replace(`/dashboard/reports/${managerId}`);
            }
        } catch (e: any) {
            setSubmitError(e.message);
        }
        setSubmitting(false);
        submitInFlight.current = false;
    };

    const handleSubmit    = () => postReport(false);
    const handleSaveDraft = () => postReport(true);

    const handleDeleteDraft = async () => {
        setDeletingDraft(true);
        setShowDeleteConfirm(false);
        try {
            const res = await fetch(
                `/api/reports/${managerId}/weekly/${week}?month=${monthIndex}&year=${year}${urlTemplate ? `&template=${urlTemplate}` : ""}`,
                { method: "DELETE" }
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Delete failed");
            // Reset all state back to blank
            setIsDraftSaved(false);
            setIsSubmitted(false);
            setIsLocked(false);
            setWriterRows(null);
            setEditorRows(null);
            setClickUpRows(null);
            setOverviewRows([mkOverview("o-1")]);
            setResearcherRows(null);
            setAndrewRows([mkAndrew("a-1")]);
            setAbhishekRows([mkAbhishek("ab-1")]);
            setSectionBRows([mkSectionB("b-1", "Andrew"), mkSectionB("b-2", "Abhishek")]);
            setSectionCRows([mkSectionC("c-1", "Rohini"), mkSectionC("c-2", "Shikha")]);
            setSectionDRows([mkSectionD("d-1", "M7"), mkSectionD("d-2", "M7CS"), mkSectionD("d-3", "Bodycam")]);
            setSectionERows([mkSectionE("e-1", "M7"), mkSectionE("e-2", "M7CS"), mkSectionE("e-3", "Bodycam")]);
        } catch (e: any) {
            setSubmitError(e.message);
        }
        setDeletingDraft(false);
    };

    /* ── Access denied: non-owner trying to view a report that hasn't been submitted yet ── */
    if (!isLoading && !isSubmitted && !isDraftSaved && viewOnly && !isCeoOrAdmin) {
        return (
            <div className="max-w-[1200px] mx-auto flex items-center justify-center" style={{ minHeight: "calc(100vh - 80px)" }}>
                <div className="bg-white border border-slate-200 rounded-2xl shadow-xl px-10 py-12 flex flex-col items-center gap-4 max-w-md text-center">
                    <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                        <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                    </div>
                    <h2 className="text-lg font-bold text-slate-900">Report Not Submitted Yet</h2>
                    <p className="text-sm text-slate-500">This report has not been submitted. It will be visible once the manager submits it.</p>
                    <button onClick={() => router.back()} className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors">
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    /* ── Section A1 ── */
    const renderA1 = () => (
        <div>
            <div className="mb-3 rounded-t-lg bg-amber-500 px-4 py-2 flex items-center gap-3">
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section A: Performance of Writers</h2>
                <span className="text-[11px] text-amber-100 font-medium">Fields marked <span className="text-white font-bold">*</span> are required</span>
                {isAdmin && !isLocked && !isQaReport && !isResearcherReport && (
                    <button
                        onClick={() => fetchAndFillWriterCases()}
                        disabled={refreshingWriters}
                        title="Re-fetch latest data from database"
                        className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-white/20 hover:bg-white/30 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <svg className={`w-3 h-3 ${refreshingWriters ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {refreshingWriters ? "Refreshing…" : "Refresh from DB"}
                    </button>
                )}
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={wTableRef} className="border-collapse" style={{ width: "100%", tableLayout: "auto", minWidth: 1600 }}>
                    <colgroup>
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 70  }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 90  }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 180 }} />
                        <col style={{ minWidth: 150 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 150 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={wColWidths} setWidths={setWColWidths} tableRef={wTableRef} colCount={11} measureTrigger={wMeasureTrigger}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={wColWidths} setWidths={setWColWidths}>Name of the Writer <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={wColWidths} setWidths={setWColWidths}>Case Name <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={wColWidths} setWidths={setWColWidths}>Subtask Name</ResizableTh>
                            {!isResearcherReport && <ResizableTh colIndex={4} widths={wColWidths} setWidths={setWColWidths}>Case Status</ResizableTh>}
                            <ResizableTh colIndex={4} widths={wColWidths} setWidths={setWColWidths}>Hero Case? <span className="text-red-300">*</span></ResizableTh>
                            {/* colIndex was previously a duplicate `4`, which made
                                this column share width state with "Hero Case?" —
                                resizing one resized both. Sequential numbering
                                gives each column its own width. */}
                            <ResizableTh colIndex={5} widths={wColWidths} setWidths={setWColWidths}>TAT — First Draft <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={wColWidths} setWidths={setWColWidths}>TAT — Revision <span className="text-red-400">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={wColWidths} setWidths={setWColWidths}>Reason for TAT Exceeding <span className="text-amber-200 italic text-[10px] font-medium">(optional)</span></ResizableTh>
                            <ResizableTh colIndex={8} widths={wColWidths} setWidths={setWColWidths}>Action Taken <span className="text-amber-200 italic text-[10px] font-medium">(optional)</span></ResizableTh>
                            <ResizableTh colIndex={9} widths={wColWidths} setWidths={setWColWidths}>Quality Score <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={10} widths={wColWidths} setWidths={setWColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {wRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-amber-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? periodLabel : ""}
                                    </span>
                                </Td>
                                <Td><EditInput value={row.writerName} onChange={(v) => setW(idx, "writerName", v)} placeholder="Writer name" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td highlight><EditInput value={row.caseName} onChange={(v) => setW(idx, "caseName", v)} placeholder="Case name" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td><EditInput value={row.subtaskName ?? ""} onChange={(v) => setW(idx, "subtaskName", v)} placeholder="Subtask name" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                {!isResearcherReport && <Td><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${getStatusColor(row.caseStatus)}`}>{row.caseStatus || "—"}</span></Td>}
                                <Td><YNSelect value={row.heroCase} onChange={(v) => setW(idx, "heroCase", v)} disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                <Td><EditInput value={row.tatFirstDraft} onChange={(v) => setW(idx, "tatFirstDraft", v)} placeholder="e.g. 4 days" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td><EditInput value={row.tatRevision} onChange={(v) => setW(idx, "tatRevision", v)} placeholder="e.g. 1 day" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td><EditInput value={row.reasonTatExceeding} onChange={(v) => setW(idx, "reasonTatExceeding", v)} placeholder="Reason if exceeded" disabled={isLocked || viewOnly} manual /></Td>
                                <Td><EditInput value={row.actionTaken} onChange={(v) => setW(idx, "actionTaken", v)} placeholder="Action taken" disabled={isLocked || viewOnly} manual /></Td>
                                <Td><EditInput value={row.qualityScore} onChange={(v) => setW(idx, "qualityScore", v)} placeholder="e.g. 45 / 50" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td><EditInput value={row.remark} onChange={(v) => setW(idx, "remark", v)} placeholder="Optional remark…" disabled={isLocked || viewOnly} manual /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {wRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeW(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addW} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );

    /* ── Section A2 ── */
    const renderA2 = () => (
        <div>
            <div className="mb-3 rounded-t-lg bg-amber-500 px-4 py-2 flex items-center gap-3">
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section A2: Performance of Editors</h2>
                <span className="text-[11px] text-amber-100 font-medium">Fields marked <span className="text-white font-bold">*</span> are required</span>
                {!isLocked && !viewOnly && !isQaReport && !isResearcherReport && (
                    <button
                        onClick={() => fetchAndFillEditorCases()}
                        disabled={refreshingEditors}
                        title="Re-fetch latest data from database"
                        className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-white/20 hover:bg-white/30 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <svg className={`w-3 h-3 ${refreshingEditors ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {refreshingEditors ? "Refreshing…" : "Refresh from DB"}
                    </button>
                )}
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={cTableRef} className="border-collapse" style={{ width: "100%", tableLayout: "auto", minWidth: 1600 }}>
                    <colgroup>
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 70  }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 90  }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 180 }} />
                        <col style={{ minWidth: 150 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 150 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={cColWidths} setWidths={setCColWidths} tableRef={cTableRef} colCount={11}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={cColWidths} setWidths={setCColWidths}>Name of the Editor <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={cColWidths} setWidths={setCColWidths}>Case Name <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={cColWidths} setWidths={setCColWidths}>Subtask Name</ResizableTh>
                            {!isResearcherReport && <ResizableTh colIndex={4} widths={cColWidths} setWidths={setCColWidths}>Case Status</ResizableTh>}
                            <ResizableTh colIndex={4} widths={cColWidths} setWidths={setCColWidths}>Hero Case? <span className="text-red-300">*</span></ResizableTh>
                            {/* See writer table above — duplicate colIndex 4
                                made TAT share width state with Hero Case. */}
                            <ResizableTh colIndex={5} widths={cColWidths} setWidths={setCColWidths}>TAT for the First Draft <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={cColWidths} setWidths={setCColWidths}>TAT for Revision <span className="text-red-400">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={cColWidths} setWidths={setCColWidths}>Reason for TAT Exceeding <span className="text-amber-200 italic text-[10px] font-medium">(optional)</span></ResizableTh>
                            <ResizableTh colIndex={8} widths={cColWidths} setWidths={setCColWidths}>Action Taken <span className="text-amber-200 italic text-[10px] font-medium">(optional)</span></ResizableTh>
                            <ResizableTh colIndex={9} widths={cColWidths} setWidths={setCColWidths}>Quality Score <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={10} widths={cColWidths} setWidths={setCColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {cRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-sky-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? periodLabel : ""}
                                    </span>
                                </Td>
                                <Td><EditInput value={row.editorName} onChange={(v) => setC(idx, "editorName", v)} placeholder="Editor name" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td highlight><EditInput value={row.caseName} onChange={(v) => setC(idx, "caseName", v)} placeholder="Case name" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td><EditInput value={row.subtaskName} onChange={(v) => setC(idx, "subtaskName", v)} placeholder="Subtask name" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                {!isResearcherReport && <Td><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${getStatusColor(row.caseStatus)}`}>{row.caseStatus || "—"}</span></Td>}
                                <Td><YNSelect value={row.heroCase} onChange={(v) => setC(idx, "heroCase", v)} disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                <Td><EditInput value={row.tatFirstDraft} onChange={(v) => setC(idx, "tatFirstDraft", v)} placeholder="e.g. 4 days" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td><EditInput value={row.tatRevision} onChange={(v) => setC(idx, "tatRevision", v)} placeholder="e.g. 1 day" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td><EditInput value={row.reasonTatExceeding} onChange={(v) => setC(idx, "reasonTatExceeding", v)} placeholder="Reason if exceeded" disabled={isLocked || viewOnly} manual /></Td>
                                <Td><EditInput value={row.actionTaken} onChange={(v) => setC(idx, "actionTaken", v)} placeholder="Action taken" disabled={isLocked || viewOnly} manual /></Td>
                                <Td><EditInput value={row.qualityScore} onChange={(v) => setC(idx, "qualityScore", v)} placeholder="e.g. 45 / 50" disabled={isLocked || viewOnly || !!row.autoFilled} manual={!row.autoFilled} /></Td>
                                <Td><EditInput value={row.remark} onChange={(v) => setC(idx, "remark", v)} placeholder="Optional remark…" disabled={isLocked || viewOnly} manual /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {cRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeC(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addC} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );

    /* ── Section B (simple — non-Nishant managers) ── */
    const renderBSimple = () => (
        <div>
            <div className="mb-3 rounded-t-lg bg-violet-600 px-4 py-2 flex items-center gap-3">
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section B: Quick Overview</h2>
                <span className="text-[11px] text-violet-200 font-medium">Fields marked <span className="text-white font-bold">*</span> are required</span>
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={oTableRef} className="border-collapse w-full" style={{ minWidth: 700 }}>
                    <colgroup>
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 260 }} />
                        <col style={{ minWidth: 260 }} />
                        <col style={{ minWidth: 200 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={oColWidths} setWidths={setOColWidths} tableRef={oTableRef} colCount={4}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={oColWidths} setWidths={setOColWidths}>Win of the week <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={oColWidths} setWidths={setOColWidths}>Roadblock of the week <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={oColWidths} setWidths={setOColWidths}><span className="text-violet-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {overviewRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-violet-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? periodLabel : ""}
                                    </span>
                                </Td>
                                <Td><EditInput value={row.winOfWeek} onChange={(v) => setO(idx, "winOfWeek", v)} placeholder="Win of the week…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.roadblock} onChange={(v) => setO(idx, "roadblock", v)} placeholder="Roadblock of the week…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.remark} onChange={(v) => setO(idx, "remark", v)} placeholder="Optional remark…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {overviewRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeO(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addO} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );

    /* ── Section A3: Performance of Researchers ── */
    const renderA3 = () => (
        <div>
            <div className="mb-3 rounded-t-lg px-4 py-2 flex items-center gap-3" style={{ background: "linear-gradient(90deg, #e87722 0%, #c95f00 100%)" }}>
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section A: Performance of Researchers</h2>
                <span className="text-[11px] text-orange-100 font-medium">Fields marked <span className="text-white font-bold">*</span> are required</span>
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={oTableRef} className="border-collapse w-full" style={{ minWidth: 1100 }}>
                    <colgroup>
                        <col style={{ minWidth: 90  }} />
                        <col style={{ minWidth: 150 }} />
                        <col style={{ minWidth: 220 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 200 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={oColWidths} setWidths={setOColWidths} tableRef={oTableRef} colCount={9}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={oColWidths} setWidths={setOColWidths}>Researcher <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={oColWidths} setWidths={setOColWidths}>Is the researcher completing his daily targets? If not so why? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={oColWidths} setWidths={setOColWidths}>No. of Approved Cases (RTC) <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={oColWidths} setWidths={setOColWidths}>Average rating of the cases <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={5} widths={oColWidths} setWidths={setOColWidths}>No. of FOIA researched <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={oColWidths} setWidths={setOColWidths}>No. of FOIA pitched? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={oColWidths} setWidths={setOColWidths}>No. of FOIA received <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={8} widths={oColWidths} setWidths={setOColWidths}>Overall Remarks</ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {rRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-orange-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? monthName : ""}
                                    </span>
                                </Td>
                                <Td highlight><EditInput value={row.researcher} onChange={(v) => setR(idx, "researcher", v)} placeholder="Researcher name" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.dailyTargetsMet} onChange={(v) => setR(idx, "dailyTargetsMet", v)} placeholder="Yes / No — reason if no" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.approvedCasesRTC} onChange={(v) => setR(idx, "approvedCasesRTC", v)} placeholder="N/A or number" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.avgRating} onChange={(v) => setR(idx, "avgRating", v)} placeholder="e.g. 4 / 5" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.foiaResearched} onChange={(v) => setR(idx, "foiaResearched", v)} placeholder="e.g. 10" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.foiaPitched} onChange={(v) => setR(idx, "foiaPitched", v)} placeholder="e.g. 10" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.foiaReceived} onChange={(v) => setR(idx, "foiaReceived", v)} placeholder="e.g. 2 + 1" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.overallRemarks} onChange={(v) => setR(idx, "overallRemarks", v)} placeholder="Overall remarks…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {rRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeR(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addR} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add researcher row
                </button>
            )}
        </div>
    );

    /* ── Section B: Quick Overview ── */
    const renderB = () => (
        <div>
            <div className="mb-3 rounded-t-lg bg-violet-600 px-4 py-2 flex items-center gap-3">
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section B: Quick Overview</h2>
                <span className="text-[11px] text-violet-200 font-medium">Fields marked <span className="text-white font-bold">*</span> are required</span>
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={oTableRef} className="border-collapse w-full" style={{ minWidth: 1400 }}>
                    <colgroup>
                        <col style={{ minWidth: 90  }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 200 }} />
                        <col style={{ minWidth: 220 }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={oColWidths} setWidths={setOColWidths} tableRef={oTableRef} colCount={11}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={oColWidths} setWidths={setOColWidths}>Week <span className="text-violet-300 font-normal text-[10px]">(Date Range)</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={oColWidths} setWidths={setOColWidths}>Win from the last week <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={oColWidths} setWidths={setOColWidths}>Roadblock from the last week <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={oColWidths} setWidths={setOColWidths}>Researcher of the week</ResizableTh>
                            <ResizableTh colIndex={5} widths={oColWidths} setWidths={setOColWidths}>Total FOIA pitched? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={oColWidths} setWidths={setOColWidths}>Total FOIA received? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={oColWidths} setWidths={setOColWidths}>Total final cases <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={8} widths={oColWidths} setWidths={setOColWidths}>Reason for variance or gap?</ResizableTh>
                            <ResizableTh colIndex={9} widths={oColWidths} setWidths={setOColWidths}>No. of 5 star cases</ResizableTh>
                            <ResizableTh colIndex={10} widths={oColWidths} setWidths={setOColWidths}>Remarks, if any 5 star existed?</ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {overviewRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-violet-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? monthName : ""}
                                    </span>
                                </Td>
                                <Td muted><EditInput value={row.weekDateRange} onChange={(v) => setO(idx, "weekDateRange", v)} placeholder="e.g. 01/03/2025 – 07/03/2025 (5 days)" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.winOfWeek} onChange={(v) => setO(idx, "winOfWeek", v)} placeholder="Win from last week…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.roadblock} onChange={(v) => setO(idx, "roadblock", v)} placeholder="Roadblock…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.researcherOfWeek} onChange={(v) => setO(idx, "researcherOfWeek", v)} placeholder="Name" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.totalFoiaPitched} onChange={(v) => setO(idx, "totalFoiaPitched", v)} placeholder="e.g. 15 (pitched) + 30" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.totalFoiaReceived} onChange={(v) => setO(idx, "totalFoiaReceived", v)} placeholder="e.g. 2 + 1" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.totalFinalCases} onChange={(v) => setO(idx, "totalFinalCases", v)} placeholder="e.g. 8 RTC + 28 FOIA" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.reasonVariance} onChange={(v) => setO(idx, "reasonVariance", v)} placeholder="Reason for variance…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.fiveStarCases} onChange={(v) => setO(idx, "fiveStarCases", v)} placeholder="N/A or number" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.fiveStarRemarks} onChange={(v) => setO(idx, "fiveStarRemarks", v)} placeholder="Remarks…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {overviewRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeO(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addO} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );

    /* ── Section A: Andrew James — QA Script Review ── */
    const renderAndrew = () => {
        const avgRating = andrewRows.length > 0
            ? andrewRows.reduce((s, r) => s + (parseFloat(r.ratingByQA) || 0), 0) / andrewRows.filter(r => r.ratingByQA.trim()).length
            : NaN;
        const avgQScore = andrewRows.length > 0
            ? andrewRows.reduce((s, r) => s + (parseFloat(r.writerQualityScore) || 0), 0) / andrewRows.filter(r => r.writerQualityScore.trim()).length
            : NaN;
        return (
            <div>
                <div className="mb-3 rounded-t-lg px-4 py-2 flex items-center gap-3" style={{ background: "linear-gradient(90deg, #1a6b3a 0%, #145c30 100%)" }}>
                    <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section A: Detailed Analysis of the Reviewed Cases</h2>
                    <span className="text-[11px] text-green-200 font-medium">(To be filled by Andrew)</span>
                    {!isLocked && !viewOnly && (
                        <button
                            onClick={fetchAndFillAndrewCases}
                            disabled={refreshingAndrew}
                            title="Re-fetch latest data from database"
                            className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-white/20 hover:bg-white/30 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <svg className={`w-3 h-3 ${refreshingAndrew ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {refreshingAndrew ? "Refreshing…" : "Refresh from DB"}
                        </button>
                    )}
                </div>
                <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                    <table ref={aTableRef} className="border-collapse" style={{ width: "100%", tableLayout: "auto", minWidth: 1600 }}>
                        <colgroup>
                            <col style={{ minWidth: 120 }} />
                            <col style={{ minWidth: 220 }} />
                            <col style={{ minWidth: 130 }} />
                            <col style={{ minWidth: 100 }} />
                            <col style={{ minWidth: 90  }} />
                            <col style={{ minWidth: 120 }} />
                            <col style={{ minWidth: 130 }} />
                            <col style={{ minWidth: 120 }} />
                            <col style={{ minWidth: 220 }} />
                            <col style={{ minWidth: 100 }} />
                            <col style={{ minWidth: 130 }} />
                            <col style={{ minWidth: 40  }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <ResizableTh colIndex={0} widths={aColWidths} setWidths={setAColWidths} tableRef={aTableRef} colCount={12} measureTrigger={aMeasureTrigger}>Month <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={1} widths={aColWidths} setWidths={setAColWidths}>Case Name <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={2} widths={aColWidths} setWidths={setAColWidths}>Case Status</ResizableTh>
                                <ResizableTh colIndex={3} widths={aColWidths} setWidths={setAColWidths}>Capsule Name <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={3} widths={aColWidths} setWidths={setAColWidths}>Case Rating <span className="text-indigo-200 font-normal text-[10px]">(given by Nishant)</span> <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={4} widths={aColWidths} setWidths={setAColWidths}>Case Type? <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={5} widths={aColWidths} setWidths={setAColWidths}>Writer <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={6} widths={aColWidths} setWidths={setAColWidths}>QA Script Starting Date <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={7} widths={aColWidths} setWidths={setAColWidths}>Rating given by QA Script team <span className="text-indigo-200 font-normal text-[10px]">(Andrew/Diya)</span> <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={8} widths={aColWidths} setWidths={setAColWidths}>Reason for the Rating <span className="text-indigo-200 font-normal text-[10px]">(given by Andrew/Diya)</span> <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={9} widths={aColWidths} setWidths={setAColWidths}>Writer Quality Score <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={10} widths={aColWidths} setWidths={setAColWidths}>Any Structural Changes Observed? <span className="text-indigo-200 font-normal text-[10px]">(Efficiency)</span> <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={11} widths={aColWidths} setWidths={setAColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                                <Th>{" "}</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {andrewRows.map((row, idx) => (
                                <tr key={row.id} className="group hover:bg-green-50/60 transition-colors">
                                    <Td muted>
                                        <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                            {idx === 0 ? monthName : ""}
                                        </span>
                                    </Td>
                                    <Td highlight><EditInput value={row.caseName} onChange={(v) => setAR(idx, "caseName", v)} placeholder="Case name" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${getStatusColor(row.caseStatus)}`}>{row.caseStatus || "—"}</span></Td>
                                    <Td><EditInput value={row.capsuleName} onChange={(v) => setAR(idx, "capsuleName", v)} placeholder="Capsule name" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.caseRating} onChange={(v) => setAR(idx, "caseRating", v)} placeholder="e.g. 4" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td>
                                        <select
                                            value={row.caseType}
                                            onChange={(e) => setAR(idx, "caseType", e.target.value)}
                                            disabled={isLocked || viewOnly || !!row.autoFilled}
                                            className={["w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none", (isLocked || viewOnly || !!row.autoFilled) ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
                                        >
                                            <option value="Normal">Normal</option>
                                            <option value="Hero">Hero</option>
                                        </select>
                                    </Td>
                                    <Td><EditInput value={row.writer} onChange={(v) => setAR(idx, "writer", v)} placeholder="Writer name" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.qaScriptStartDate} onChange={(v) => setAR(idx, "qaScriptStartDate", v)} placeholder="e.g. Feb 2" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.ratingByQA} onChange={(v) => setAR(idx, "ratingByQA", v)} placeholder="e.g. 4" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.ratingReason} onChange={(v) => setAR(idx, "ratingReason", v)} placeholder="Reason for rating…" disabled={isLocked || viewOnly} /></Td>
                                    <Td><EditInput value={row.writerQualityScore} onChange={(v) => setAR(idx, "writerQualityScore", v)} placeholder="e.g. 34" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td>
                                        <select
                                            value={row.structuralChanges}
                                            onChange={(e) => setAR(idx, "structuralChanges", e.target.value)}
                                            disabled={isLocked || viewOnly}
                                            className={["w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none", (isLocked || viewOnly) ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
                                        >
                                            <option value="">—</option>
                                            <option value="Yes">Yes</option>
                                            <option value="No">No</option>
                                        </select>
                                    </Td>
                                    <Td><EditInput value={row.remark} onChange={(v) => setAR(idx, "remark", v)} placeholder="Remark…" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                        {andrewRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeAR(idx)} />}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </DragScrollDiv>
                {!isLocked && !viewOnly && (
                    <button onClick={addAR} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-green-700 hover:text-green-800 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        Add case row
                    </button>
                )}
            </div>
        );
    };

    /* ── Section B: Quick Overview — Andrew & Abhishek ── */
    const renderAndrewSectionB = () => (
        <div>
            <div className="mb-3 rounded-t-lg px-4 py-2 flex items-center gap-3" style={{ background: "linear-gradient(90deg, #c95f00 0%, #e87722 100%)" }}>
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section B: A Quick Overview</h2>
                <span className="text-[11px] text-orange-100 font-medium">(To be filled by Andrew and Abhishek both)</span>
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={bTableRef} className="border-collapse" style={{ width: "100%", tableLayout: "auto", minWidth: 2400 }}>
                    <colgroup>
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 100 }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 150 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 220 }} />
                        <col style={{ minWidth: 220 }} />
                        <col style={{ minWidth: 220 }} />
                        <col style={{ minWidth: 220 }} />
                        <col style={{ minWidth: 200 }} />
                        <col style={{ minWidth: 200 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={bColWidths} setWidths={setBColWidths} tableRef={bTableRef} colCount={14}>Month <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={1} widths={bColWidths} setWidths={setBColWidths}>Reviewer <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={bColWidths} setWidths={setBColWidths}>Target for the week? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={bColWidths} setWidths={setBColWidths}>Total No. of Reviews Done for the week? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={bColWidths} setWidths={setBColWidths}>Reason for variance if any? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={5} widths={bColWidths} setWidths={setBColWidths}>Average Rating of the cases reviewed? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={bColWidths} setWidths={setBColWidths}>No. of the cases in which major changes came? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={bColWidths} setWidths={setBColWidths}>Best case for the last week along with a reason? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={8} widths={bColWidths} setWidths={setBColWidths}>Least interesting case for the last week along with a reason? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={9} widths={bColWidths} setWidths={setBColWidths}>Cases where you suggested something new or identified some pattern? <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={10} widths={bColWidths} setWidths={setBColWidths}>Capsules in which repetitive issues are occurring? <span className="text-indigo-200 font-normal text-[10px]">(mention writer/editor)</span> <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={11} widths={bColWidths} setWidths={setBColWidths}>1 Win from last week <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={12} widths={bColWidths} setWidths={setBColWidths}>1 Roadblock from last week <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={13} widths={bColWidths} setWidths={setBColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {sectionBRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-orange-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? monthName : ""}
                                    </span>
                                </Td>
                                <Td>
                                    <select
                                        value={row.reviewer}
                                        onChange={(e) => setSB(idx, "reviewer", e.target.value)}
                                        disabled={true}
                                        className="w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none cursor-not-allowed opacity-60"
                                    >
                                        <option value="">—</option>
                                        <option value="Andrew">Andrew</option>
                                        <option value="Abhishek">Abhishek</option>
                                        <option value="Andrew/Diya">Andrew/Diya</option>
                                    </select>
                                </Td>
                                <Td><EditInput value={row.targetForWeek} onChange={(v) => setSB(idx, "targetForWeek", v)} placeholder="e.g. 15" disabled={true} /></Td>
                                <Td><EditInput value={row.totalReviewsDone} onChange={(v) => setSB(idx, "totalReviewsDone", v)} placeholder="e.g. 10" disabled={true} /></Td>
                                <Td><EditInput value={row.reasonVariance} onChange={(v) => setSB(idx, "reasonVariance", v)} placeholder="Reason if any…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.avgRating} onChange={(v) => setSB(idx, "avgRating", v)} placeholder="e.g. 3.75" disabled={true} /></Td>
                                <Td><EditInput value={row.casesMajorChanges} onChange={(v) => setSB(idx, "casesMajorChanges", v)} placeholder="e.g. 5" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.bestCase} onChange={(v) => setSB(idx, "bestCase", v)} placeholder="Case name + reason…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.leastInterestingCase} onChange={(v) => setSB(idx, "leastInterestingCase", v)} placeholder="Case name + reason…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.suggestedPattern} onChange={(v) => setSB(idx, "suggestedPattern", v)} placeholder="Pattern or suggestion…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.repetitiveIssues} onChange={(v) => setSB(idx, "repetitiveIssues", v)} placeholder="Capsule — writer/editor…" disabled={isLocked || viewOnly} /></Td>
                                <Td highlight><EditInput value={row.winLastWeek} onChange={(v) => setSB(idx, "winLastWeek", v)} placeholder="Win…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.roadblockLastWeek} onChange={(v) => setSB(idx, "roadblockLastWeek", v)} placeholder="Roadblock…" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.remark} onChange={(v) => setSB(idx, "remark", v)} placeholder="Remark…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {sectionBRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeSB(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addSB} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );

    /* ── Section C: Rohini & Shikha thumbnails ── */
    const renderAndrewSectionC = () => (
        <div>
            <div className="mb-3 rounded-t-lg px-4 py-2 flex items-center gap-3" style={{ background: "linear-gradient(90deg, #e87722 0%, #f59e0b 100%)" }}>
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section C: A Quick Overview of Rohini &amp; Shikha</h2>
                <span className="text-[11px] text-amber-100 font-medium">(To be filled by Abhishek)</span>
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={cTableRef} className="border-collapse" style={{ width: "100%", tableLayout: "auto", minWidth: 900 }}>
                    <colgroup>
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 160 }} />
                        <col style={{ minWidth: 400 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={sectionCColWidths} setWidths={setSectionCColWidths} tableRef={sectionCTableRef} colCount={5}>Month <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={1} widths={sectionCColWidths} setWidths={setSectionCColWidths}>Respective Person <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={sectionCColWidths} setWidths={setSectionCColWidths}>Number of Thumbnails done <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={sectionCColWidths} setWidths={setSectionCColWidths}>Average CTR of weekly uploads <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={sectionCColWidths} setWidths={setSectionCColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {sectionCRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-amber-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? monthName : ""}
                                    </span>
                                </Td>
                                <Td>
                                    <select
                                        value={row.respectivePerson}
                                        onChange={(e) => setSC(idx, "respectivePerson", e.target.value)}
                                        disabled={isLocked || viewOnly}
                                        className={["w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none", (isLocked || viewOnly) ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
                                    >
                                        <option value="">—</option>
                                        <option value="Rohini">Rohini</option>
                                        <option value="Shikha">Shikha</option>
                                    </select>
                                </Td>
                                <Td><EditInput value={row.thumbnailsDone} onChange={(v) => setSC(idx, "thumbnailsDone", v)} placeholder="e.g. 5" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                <Td>
                                    <textarea
                                        value={row.avgCtr}
                                        onChange={(e) => setSC(idx, "avgCtr", e.target.value)}
                                        placeholder="e.g. M7cs -9.7 and M7 - 8.1"
                                        disabled={isLocked || viewOnly}
                                        rows={3}
                                        className={[
                                            "w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded resize-y",
                                            (isLocked || viewOnly) ? "cursor-not-allowed opacity-60" : "",
                                        ].join(" ")}
                                    />
                                </Td>
                                <Td><EditInput value={row.remark} onChange={(v) => setSC(idx, "remark", v)} placeholder="Remark…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {sectionCRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeSC(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addSC} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );

    /* ── Section D: Views and Changes ── */
    const renderAndrewSectionD = () => (
        <div>
            <div className="mb-3 rounded-t-lg px-4 py-2" style={{ background: "linear-gradient(90deg, #1e40af 0%, #3b82f6 100%)" }}>
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section D - Views and Changes <span className="text-[11px] font-normal opacity-90">(To be filled by Andrew)</span></h2>
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={sectionDTableRef} className="border-collapse" style={{ width: "100%", tableLayout: "auto", minWidth: 900 }}>
                    <colgroup>
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 90  }} />
                        <col style={{ minWidth: 100 }} />
                        <col style={{ minWidth: 130 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 130 }} />
                        <col style={{ minWidth: 300 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={sectionDColWidths} setWidths={setSectionDColWidths} tableRef={sectionDTableRef} colCount={8}>Month <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={1} widths={sectionDColWidths} setWidths={setSectionDColWidths}>Channel <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={2} widths={sectionDColWidths} setWidths={setSectionDColWidths}>Total Views <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={3} widths={sectionDColWidths} setWidths={setSectionDColWidths}>Views (Not Counting Shorts) <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={4} widths={sectionDColWidths} setWidths={setSectionDColWidths}>Subscriber Count <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={5} widths={sectionDColWidths} setWidths={setSectionDColWidths}>Number of Videos Uploaded <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={6} widths={sectionDColWidths} setWidths={setSectionDColWidths}>Titles and Thumbnails which required changing <span className="text-red-300">*</span></ResizableTh>
                            <ResizableTh colIndex={7} widths={sectionDColWidths} setWidths={setSectionDColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {sectionDRows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-blue-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? monthName : ""}
                                    </span>
                                </Td>
                                <Td>
                                    <select
                                        value={row.channel}
                                        onChange={(e) => setSD(idx, "channel", e.target.value)}
                                        disabled={isLocked || viewOnly}
                                        className={["w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none", (isLocked || viewOnly) ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
                                    >
                                        <option value="M7">M7</option>
                                        <option value="M7CS">M7CS</option>
                                        <option value="Bodycam">Bodycam</option>
                                    </select>
                                </Td>
                                <Td><EditInput value={row.totalViews}      onChange={(v) => setSD(idx, "totalViews",      v)} placeholder="e.g. 693k"  disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.viewsNoShorts}   onChange={(v) => setSD(idx, "viewsNoShorts",   v)} placeholder="e.g. 644k"  disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.subscriberCount} onChange={(v) => setSD(idx, "subscriberCount", v)} placeholder="e.g. 1.3k+" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.videosUploaded}  onChange={(v) => setSD(idx, "videosUploaded",  v)} placeholder="e.g. 2 + 3 shorts" disabled={isLocked || viewOnly} /></Td>
                                <Td>
                                    <textarea
                                        value={row.titlesChanged}
                                        onChange={(e) => setSD(idx, "titlesChanged", e.target.value)}
                                        placeholder="List titles/thumbnails that required changing..."
                                        disabled={isLocked || viewOnly}
                                        rows={3}
                                        className={[
                                            "w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded resize-y",
                                            (isLocked || viewOnly) ? "cursor-not-allowed opacity-60" : "",
                                        ].join(" ")}
                                    />
                                </Td>
                                <Td><EditInput value={row.remark} onChange={(v) => setSD(idx, "remark", v)} placeholder="Remark…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {sectionDRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeSD(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addSD} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );

    /* ── Section E: Views and Changes (YT Shorts) ── */
    const renderAndrewSectionE = () => (
        <div>
            <div className="mb-3 rounded-t-lg px-4 py-2" style={{ background: "linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%)" }}>
                <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section E - Views and Changes (YT Shorts) <span className="text-[11px] font-normal opacity-90">(To be filled by Andrew)</span></h2>
            </div>
            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                <table ref={sectionETableRef} className="border-collapse" style={{ width: "100%", tableLayout: "auto", minWidth: 900 }}>
                    <colgroup>
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 90  }} />
                        <col style={{ minWidth: 120 }} />
                        <col style={{ minWidth: 110 }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 300 }} />
                        <col style={{ minWidth: 140 }} />
                        <col style={{ minWidth: 40  }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <ResizableTh colIndex={0} widths={sectionEColWidths} setWidths={setSectionEColWidths} tableRef={sectionETableRef} colCount={8}>Month</ResizableTh>
                            <ResizableTh colIndex={1} widths={sectionEColWidths} setWidths={setSectionEColWidths}>Channel</ResizableTh>
                            <ResizableTh colIndex={2} widths={sectionEColWidths} setWidths={setSectionEColWidths}>Total Shorts Views</ResizableTh>
                            <ResizableTh colIndex={3} widths={sectionEColWidths} setWidths={setSectionEColWidths}>Subscriber Count</ResizableTh>
                            <ResizableTh colIndex={4} widths={sectionEColWidths} setWidths={setSectionEColWidths}>Number of Shorts Uploaded</ResizableTh>
                            <ResizableTh colIndex={5} widths={sectionEColWidths} setWidths={setSectionEColWidths}>Titles and Thumbnails which required changing</ResizableTh>
                            <ResizableTh colIndex={6} widths={sectionEColWidths} setWidths={setSectionEColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                            <Th>{" "}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {sectionERows.map((row, idx) => (
                            <tr key={row.id} className="group hover:bg-violet-50/60 transition-colors">
                                <Td muted>
                                    <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                        {idx === 0 ? monthName : ""}
                                    </span>
                                </Td>
                                <Td>
                                    <select
                                        value={row.channel}
                                        onChange={(e) => setSE(idx, "channel", e.target.value)}
                                        disabled={isLocked || viewOnly}
                                        className={["w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none", (isLocked || viewOnly) ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
                                    >
                                        <option value="M7">M7</option>
                                        <option value="M7CS">M7CS</option>
                                        <option value="Bodycam">Bodycam</option>
                                    </select>
                                </Td>
                                <Td><EditInput value={row.totalViews}      onChange={(v) => setSE(idx, "totalViews",      v)} placeholder="e.g. 1.2M"  disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.subscriberCount} onChange={(v) => setSE(idx, "subscriberCount", v)} placeholder="e.g. 1.3k+" disabled={isLocked || viewOnly} /></Td>
                                <Td><EditInput value={row.shortsUploaded}  onChange={(v) => setSE(idx, "shortsUploaded",  v)} placeholder="e.g. 12"    disabled={isLocked || viewOnly} /></Td>
                                <Td>
                                    <textarea
                                        value={row.titlesChanged}
                                        onChange={(e) => setSE(idx, "titlesChanged", e.target.value)}
                                        placeholder="List shorts titles/thumbnails that required changing..."
                                        disabled={isLocked || viewOnly}
                                        rows={3}
                                        className={[
                                            "w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-300 rounded resize-y",
                                            (isLocked || viewOnly) ? "cursor-not-allowed opacity-60" : "",
                                        ].join(" ")}
                                    />
                                </Td>
                                <Td><EditInput value={row.remark} onChange={(v) => setSE(idx, "remark", v)} placeholder="Remark…" disabled={isLocked || viewOnly} /></Td>
                                <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                    {sectionERows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeSE(idx)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DragScrollDiv>
            {!isLocked && !viewOnly && (
                <button onClick={addSE} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add row
                </button>
            )}
        </div>
    );


    /* ── Section A2: Abhishek — QA Video Review ── */
    const renderAbhishekA2 = () => {
        const avgRating = (() => {
            const filled = abhishekRows.filter(r => r.ratingByAbhishek.trim());
            return filled.length ? filled.reduce((s, r) => s + (parseFloat(r.ratingByAbhishek) || 0), 0) / filled.length : NaN;
        })();
        const avgEditorQ = (() => {
            const filled = abhishekRows.filter(r => r.editorQualityScore.trim());
            return filled.length ? filled.reduce((s, r) => s + (parseFloat(r.editorQualityScore) || 0), 0) / filled.length : NaN;
        })();
        return (
            <div>
                <div className="mb-3 rounded-t-lg px-4 py-2 flex items-center gap-3" style={{ background: "linear-gradient(90deg, #1a6b3a 0%, #145c30 100%)" }}>
                    <h2 className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>Section A: Detailed Analysis of the Reviewed Cases</h2>
                    <span className="text-[11px] text-green-200 font-medium">(To be filled by Abhishek)</span>
                    {!isLocked && !viewOnly && (
                        <button
                            onClick={fetchAndFillAbhishekCases}
                            disabled={refreshingAbhishek}
                            title="Re-fetch latest data from database"
                            className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-white/20 hover:bg-white/30 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <svg className={`w-3 h-3 ${refreshingAbhishek ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {refreshingAbhishek ? "Refreshing…" : "Refresh from DB"}
                        </button>
                    )}
                </div>
                <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 dark:border-white/10 shadow-sm">
                    <table ref={abTableRef} className="border-collapse" style={{ width: "100%", tableLayout: "auto", minWidth: 1800 }}>
                        <colgroup>
                            <col style={{ minWidth: 110 }} />
                            <col style={{ minWidth: 200 }} />
                            <col style={{ minWidth: 120 }} />
                            <col style={{ minWidth: 100 }} />
                            <col style={{ minWidth: 90  }} />
                            <col style={{ minWidth: 120 }} />
                            <col style={{ minWidth: 110 }} />
                            <col style={{ minWidth: 120 }} />
                            <col style={{ minWidth: 130 }} />
                            <col style={{ minWidth: 110 }} />
                            <col style={{ minWidth: 220 }} />
                            <col style={{ minWidth: 110 }} />
                            <col style={{ minWidth: 130 }} />
                            <col style={{ minWidth: 40  }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <ResizableTh colIndex={0} widths={abColWidths} setWidths={setAbColWidths} tableRef={abTableRef} colCount={14} measureTrigger={abMeasureTrigger}>Month <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={1} widths={abColWidths} setWidths={setAbColWidths}>Case Name <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={2} widths={abColWidths} setWidths={setAbColWidths}>Capsule Name <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={3} widths={abColWidths} setWidths={setAbColWidths}>Case Rating <span className="text-indigo-200 font-normal text-[10px]">(given by Nishant)</span> <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={4} widths={abColWidths} setWidths={setAbColWidths}>Case Type? <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={5} widths={abColWidths} setWidths={setAbColWidths}>Writer <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={6} widths={abColWidths} setWidths={setAbColWidths}>Writer Quality Score <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={7} widths={abColWidths} setWidths={setAbColWidths}>Editor <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={8} widths={abColWidths} setWidths={setAbColWidths}>QA Video Starting Date <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={9} widths={abColWidths} setWidths={setAbColWidths}>Rating given by Abhishek for the case? <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={10} widths={abColWidths} setWidths={setAbColWidths}>Reason for the Rating given by Abhishek <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={11} widths={abColWidths} setWidths={setAbColWidths}>Editor Quality Score <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={12} widths={abColWidths} setWidths={setAbColWidths}>Any Structural Changes observed? <span className="text-red-300">*</span></ResizableTh>
                                <ResizableTh colIndex={13} widths={abColWidths} setWidths={setAbColWidths}><span className="text-amber-200 italic text-[10px] font-medium">Remark (optional)</span></ResizableTh>
                                <Th>{" "}</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {abhishekRows.map((row, idx) => (
                                <tr key={row.id} className="group hover:bg-sky-50/60 transition-colors">
                                    <Td muted>
                                        <span className="font-medium text-slate-700 text-[13px] leading-tight block">
                                            {idx === 0 ? monthName : ""}
                                        </span>
                                    </Td>
                                    <Td highlight><EditInput value={row.caseName} onChange={(v) => setAB(idx, "caseName", v)} placeholder="Case name" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.capsuleName} onChange={(v) => setAB(idx, "capsuleName", v)} placeholder="Capsule name" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.caseRating} onChange={(v) => setAB(idx, "caseRating", v)} placeholder="e.g. 4" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td>
                                        <select
                                            value={row.caseType}
                                            onChange={(e) => setAB(idx, "caseType", e.target.value)}
                                            disabled={isLocked || viewOnly || !!row.autoFilled}
                                            className={["w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none", (isLocked || viewOnly || !!row.autoFilled) ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
                                        >
                                            <option value="Normal">Normal</option>
                                            <option value="Hero">Hero</option>
                                        </select>
                                    </Td>
                                    <Td><EditInput value={row.writer} onChange={(v) => setAB(idx, "writer", v)} placeholder="Writer name" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.writerQualityScore} onChange={(v) => setAB(idx, "writerQualityScore", v)} placeholder="e.g. 38" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.editor} onChange={(v) => setAB(idx, "editor", v)} placeholder="Editor name" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.qaVideoStartDate} onChange={(v) => setAB(idx, "qaVideoStartDate", v)} placeholder="e.g. Feb 2" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.ratingByAbhishek} onChange={(v) => setAB(idx, "ratingByAbhishek", v)} placeholder="e.g. 3" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td><EditInput value={row.ratingReason} onChange={(v) => setAB(idx, "ratingReason", v)} placeholder="Reason for rating…" disabled={isLocked || viewOnly} /></Td>
                                    <Td><EditInput value={row.editorQualityScore} onChange={(v) => setAB(idx, "editorQualityScore", v)} placeholder="e.g. 44" disabled={isLocked || viewOnly || !!row.autoFilled} /></Td>
                                    <Td>
                                        <select
                                            value={row.structuralChanges}
                                            onChange={(e) => setAB(idx, "structuralChanges", e.target.value)}
                                            disabled={isLocked || viewOnly}
                                            className={["w-full bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none", (isLocked || viewOnly) ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
                                        >
                                            <option value="">—</option>
                                            <option value="Yes">Yes</option>
                                            <option value="No">No</option>
                                            <option value="Minor">Minor</option>
                                        </select>
                                    </Td>
                                    <Td><EditInput value={row.remark} onChange={(v) => setAB(idx, "remark", v)} placeholder="Remark…" disabled={isLocked || viewOnly} /></Td>
                                    <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center align-middle">
                                        {abhishekRows.length > 1 && !isLocked && !viewOnly && <RemoveBtn onClick={() => removeAB(idx)} />}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </DragScrollDiv>
                {!isLocked && !viewOnly && (
                    <button onClick={addAB} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        Add case row
                    </button>
                )}
            </div>
        );
    };

    const sectionMap: Record<SectionKey, () => React.ReactNode> = {
        a1: isQaReport  ? renderAndrew      : renderA1,
        a2: isQaReport  ? renderAbhishekA2  : renderA2,
        a3: isResearcherReport ? renderA3          : () => null,
        b:  isQaReport  ? renderAndrewSectionB               : isResearcherReport ? renderB : renderBSimple,
        c:  isQaReport  ? renderAndrewSectionC : () => null,
        d:  isQaReport  ? renderAndrewSectionD : () => null,
        e:  isQaReport  ? renderAndrewSectionE : () => null,
    };

    /* ── Render ── */
    return (
        <>
        {weekInvalid ? (
            <div className="mx-auto max-w-md p-10 text-center space-y-4">
                <p className="text-sm text-slate-700 dark:text-slate-200">
                    Week <span className="font-semibold">{week}</span> is not valid for {monthName} {year}. This month has{" "}
                    <span className="font-semibold">{maxWeekInMonth}</span> reporting week{maxWeekInMonth === 1 ? "" : "s"}.
                </p>
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400"
                >
                    ← Back to reports
                </button>
            </div>
        ) : (
        <>
        <style>{`
          .weekly-report-page input.manual-entry:not([type="checkbox"]):not([type="radio"]):not([type="range"]) {
            color: #ef4444 !important;
          }
        `}</style>
        <div
            className="weekly-report-page mx-auto flex flex-col overflow-hidden"
            style={{ maxWidth: 1240, height: "calc(100vh - 128px)", padding: "0 8px" }}
        >
            {/* Back */}
            <button
                onClick={() => router.back()}
                className="mb-2 mt-1 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors group w-fit shrink-0"
            >
                <svg className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Reports
            </button>

            {/* View-only banner */}
            {viewOnly && isSubmitted && (
                <div className="shrink-0 mb-2 flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[13px] font-medium">
                    <svg className="w-4 h-4 text-sky-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>
                        {isCeo
                            ? "You are viewing this report as CEO — read-only mode."
                            : "You are viewing this report in read-only mode. Only the report owner can edit it."}
                    </span>
                </div>
            )}

            {/* Card */}
            <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-[#28283a] border border-slate-300 dark:border-white/10 rounded-xl shadow-md overflow-hidden">

                {/* ── Header ── */}
                <div className="px-7 py-5 border-b border-slate-200 dark:border-white/10 bg-gradient-to-r from-slate-50 to-white dark:from-[#2e2e48] dark:to-[#32324a]">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            {isQaReport ? "Weekly QA Report" : isResearcherReport ? "Researchers Weekly Report" : "Production Weekly Report"}
                        </h1>
                        {isSubmitted && (
                            <span className={[
                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
                                isLocked
                                    ? "bg-red-100 text-red-700"
                                    : "bg-green-100 text-green-700",
                            ].join(" ")}>
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    {isLocked
                                        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                        : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                    }
                                </svg>
                                {isLocked ? "Submitted & Locked" : "Unlocked — Edit & Resubmit"}
                            </span>
                        )}
                        {/* Top-right team-source pill: "Snapshot" vs "Live". */}
                        {data?.teamSource && (
                            data.teamSource === "snapshot" ? (
                                <span title="Team list is frozen from the snapshot saved when this report was submitted" className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase tracking-wider">
                                    <span className="h-1 w-1 rounded-full bg-emerald-500" /> Snapshot
                                </span>
                            ) : (
                                <span title="No snapshot saved yet — showing current team. Admin can click Refresh to freeze." className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold uppercase tracking-wider">
                                    <span className="h-1 w-1 rounded-full bg-amber-500 animate-pulse" /> Live
                                </span>
                            )
                        )}
                        {/* Admin-only refresh — match the API gate */}
                        {isLocked && (isAdmin || isCeo || sessionUser?.role === "admin") && (
                            <RefreshTeamSnapshotButton
                                managerId={String(managerId)}
                                period={{ kind: "weekly", week, month: monthIndex, year }}
                            />
                        )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-6 text-sm text-slate-600">
                        <span>
                            <span className="font-semibold text-slate-700">Manager: </span>
                            {isLoading ? "Loading…" : manager?.name ?? "—"}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="font-semibold text-slate-700">Period: </span>
                            <span className="text-amber-600 font-bold">{monthName}, Week {week} — {year}</span>
                            <span className="text-slate-500 text-[12px] font-normal ml-1">({weekDateRange})</span>
                        </span>
                    </div>
                </div>

                {/* ── Body ── */}
                <div className="flex-1 overflow-y-auto px-7 py-6">
                    {sectionMap[activeSection]()}
                </div>

                {/* ── Footer Tabs ── */}
                <div className="shrink-0 flex items-stretch border-t border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#22223a]">

                    {/* + button */}
                    <div className="flex items-center px-3 border-r border-slate-200 dark:border-white/10 text-slate-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                    </div>

                    {/* Tabs */}
                    <div className="flex items-end overflow-x-auto">
                        {SECTIONS.map((s) => {
                            const active = activeSection === s.key;
                            const accent = s.key === "a1" ? "bg-amber-500"
                                         : s.key === "a2" ? "bg-sky-500"
                                         : s.key === "a3" ? "bg-orange-500"
                                         : s.key === "c"  ? "bg-teal-500"
                                         : s.key === "d"  ? "bg-rose-500"
                                         : "bg-violet-500";
                            return (
                                <button
                                    key={s.key}
                                    onClick={() => setActiveSection(s.key)}
                                    className={[
                                        "relative flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold whitespace-nowrap border-x border-t select-none transition-colors duration-150",
                                        active
                                            ? "bg-white dark:bg-[#32324a] text-slate-900 dark:text-white border-slate-300 dark:border-white/10 border-b-white dark:border-b-[#32324a] -mb-px z-10 shadow-sm"
                                            : "bg-slate-200/70 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white",
                                    ].join(" ")}
                                >
                                    {active && <span className={`absolute top-0 inset-x-0 h-[3px] rounded-t ${accent}`} />}
                                    {s.label}
                                    <span className={[
                                        "text-[11px] font-medium px-1.5 py-0.5 rounded",
                                        active ? "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-200" : "bg-slate-300/60 dark:bg-white/5 text-slate-400 dark:text-slate-500",
                                    ].join(" ")}>
                                        {s.sub}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Submit */}
                    <div className="ml-auto flex items-center gap-2.5 px-5">
                        {viewOnly && isSubmitted && (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[12px] font-medium">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                View Only
                            </span>
                        )}
                        {!viewOnly && submitError && (
                            <p className="text-[11px] text-red-500 font-medium">{submitError}</p>
                        )}
                        {isDraftSaved && !isSubmitted && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                                Draft saved
                            </span>
                        )}
                        {!viewOnly && isLocked ? (
                            <div className="flex items-center gap-2 px-4 py-[7px] rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[13px] font-semibold">
                                <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                                Submitted
                            </div>
                        ) : !viewOnly ? (
                            <>
                                {/* Delete Draft — only visible when a draft exists */}
                                {isDraftSaved && !isLocked && (
                                    showDeleteConfirm ? (
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-red-600 font-medium">Delete draft?</span>
                                            <button
                                                onClick={handleDeleteDraft}
                                                disabled={deletingDraft}
                                                className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold disabled:opacity-50 transition-colors"
                                            >
                                                Yes, delete
                                            </button>
                                            <button
                                                onClick={() => setShowDeleteConfirm(false)}
                                                className="px-2.5 py-1 rounded-md border border-slate-300 text-slate-500 text-[11px] font-medium hover:bg-slate-50 transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setShowDeleteConfirm(true)}
                                            disabled={deletingDraft || submitting}
                                            title="Delete Draft"
                                            className="p-[7px] rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-500 shadow-sm transition-colors disabled:opacity-50"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    )
                                )}

                                {/* Save as Draft */}
                                <button
                                    onClick={handleSaveDraft}
                                    disabled={submitting || !statusLoaded}
                                    className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 text-[13px] font-medium shadow-sm transition-colors"
                                >
                                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                    </svg>
                                    Save as Draft
                                </button>

                                {/* Send to CEO */}
                                <button
                                    onClick={() => setShowConfirm(true)}
                                    disabled={submitting || !statusLoaded}
                                    className="flex items-center gap-1.5 px-4 py-[7px] rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold shadow-sm transition-colors"
                                >
                                    {submitting ? (
                                        <>
                                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                            </svg>
                                            Submitting…
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                            </svg>
                                            Send to CEO
                                        </>
                                    )}
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>

        {/* ── Confirmation Modal ── */}
        {showConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <div
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                    onClick={() => setShowConfirm(false)}
                />
                {/* Dialog */}
                <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
                    {/* Icon */}
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-indigo-50 mx-auto">
                        <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    {/* Text */}
                    <div className="text-center">
                        <h3 className="text-[15px] font-bold text-slate-900">Submit this report?</h3>
                        <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">
                            Once submitted, the report will be <span className="font-medium text-slate-700">locked</span> and cannot be edited. Make sure all data is correct before confirming.
                        </p>
                        <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                            This report will be <span className="font-semibold text-slate-800">sent to the CEO</span> for review.
                        </p>
                    </div>
                    {/* Actions */}
                    <div className="flex gap-2.5 mt-1">
                        <button
                            onClick={() => setShowConfirm(false)}
                            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[13px] font-semibold transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold transition-colors shadow-sm"
                        >
                            Yes, Submit
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
        )}
        </>
    );
}
