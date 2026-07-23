"use client";

import { useState, useRef } from "react";
import UserAvatar from "@/components/ui/user-avatar";
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from "recharts";

interface EditLog {
    fieldName: string;
    oldValue: string;
    newValue: string;
    editedAt: string;
    editor: { id: number; name: string };
}

interface MonthlyRating {
    id: number;
    month: string;
    roleType: string;
    casesCompleted: number;
    avgQualityScore: number | string | null;
    avgDeliveryScore: number | string | null;
    avgEfficiencyScore: number | string | null;
    overallRating: number | string | null;
    totalViews: number | string | null;
    rankInRole: number | null;
    isManualOverride: boolean;
    writerQualityStars?: number | string | null;
    scriptQualityStars?: number | string | null;
    ownershipStars?: number | string | null;
    monthlyTargetsStars?: number | string | null;
    ytViewsStars?: number | string | null;
    parametersJson?: any;
    manualRatingsPending?: boolean;
    editLogs?: EditLog[];
}

interface ManagerRating {
    period: string;
    periodType: string;
    overallScore: number | string | null;
    ratingsJson: Record<string, number>;
    comments: string | null;
    manager: { id: number; name: string };
    submittedAt: string;
}

interface UserInfo {
    id: number;
    name: string;
    email: string;
    role: string;
    orgLevel: string;
    profilePictureUrl: string | null;
    teamCapsule: string | null;
    manager: { id: number; name: string } | null;
}

interface ScoreCardProps {
    user: UserInfo;
    monthlyRatings: MonthlyRating[];
    managerRatings: ManagerRating[];
    selectedMonth?: string;
    availableMonths?: string[];
    onMonthChange?: (month: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
    writer: "Writer", editor: "Editor", researcher: "Researcher",
    qa: "QA", gc: "GC", vo_artist: "VO Artist", manager: "Manager",
    admin: "Admin", production_manager: "Production Manager",
    hr_manager: "HR Manager", researcher_manager: "Research Manager", lead: "Lead", sub_lead: "Sub Lead", member: "Member",
};

function formatMonthLabel(ym: string): string {
    const [year, month] = ym.split("-").map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function formatMonthShort(ym: string): string {
    const [year, month] = ym.split("-").map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function monthKeyFromDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getScoreColor(score: number | null) {
    if (score === null) return { text: "text-slate-500", bg: "bg-slate-200 dark:bg-slate-700", gauge: "#94a3b8" };
    if (score >= 4) return { text: "text-emerald-500", bg: "bg-emerald-500", gauge: "#10b981" };
    if (score >= 3) return { text: "text-blue-500", bg: "bg-blue-500", gauge: "#3b82f6" };
    if (score >= 2) return { text: "text-amber-500", bg: "bg-amber-500", gauge: "#f59e0b" };
    return { text: "text-rose-500", bg: "bg-rose-500", gauge: "#ef4444" };
}

function getPercentage(score: number | null): number {
    if (score === null) return 0;
    return Math.round((score / 5) * 100);
}

function sumResearchManagerPipelineCases(parametersJson: unknown): number | null {
    if (!Array.isArray(parametersJson)) return null;
    for (const s of parametersJson as { breakdown?: { rtc?: { actual: number }; foia?: { actual: number }; foia_pitched?: { actual: number } } }[]) {
        const b = s.breakdown;
        if (b?.rtc != null && b?.foia != null && b?.foia_pitched != null) {
            return Number(b.rtc.actual) + Number(b.foia.actual) + Number(b.foia_pitched.actual);
        }
    }
    return null;
}

// ─── Gauge Meter Component (Speedometer style) ───
function GaugeMeter({ score, label, prevScore }: { score: number | null; label: string; prevScore?: number | null }) {
    const pct = getPercentage(score);
    const prevPct = prevScore != null ? getPercentage(prevScore) : null;
    const diff = prevPct != null ? pct - prevPct : null;

    const cx = 120;
    const cy = 110;
    const outerR = 90;
    const innerR = 55;
    const needleLen = 75;

    // Needle angle: 0% = left (180°), 100% = right (0°)
    const needleAngle = Math.PI - (pct / 100) * Math.PI;
    const nx = cx + needleLen * Math.cos(needleAngle);
    const ny = cy - needleLen * Math.sin(needleAngle);

    // Tick marks
    const ticks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    return (
        <div className="flex flex-col items-center">
            <svg viewBox="0 0 240 145" className="w-64 h-36">
                <defs>
                    {/* Gradient arc: red → yellow → green */}
                    <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#ef4444" />
                        <stop offset="30%" stopColor="#f59e0b" />
                        <stop offset="60%" stopColor="#84cc16" />
                        <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                    {/* Drop shadow for needle */}
                    <filter id="needleShadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.3" />
                    </filter>
                </defs>

                {/* Background arc (grey) */}
                <path d={describeArc(cx, cy, outerR, Math.PI, 0)} fill="none"
                    className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="28" strokeLinecap="butt" />

                {/* Colored gradient arc */}
                <path d={describeArc(cx, cy, outerR, Math.PI, 0)} fill="none"
                    stroke="url(#gaugeGrad)" strokeWidth="28" strokeLinecap="butt" />

                {/* Inner white/dark mask to create the donut effect */}
                <path d={describeArc(cx, cy, innerR, Math.PI, 0)} fill="none"
                    className="stroke-white dark:stroke-[#12122a]" strokeWidth="6" />

                {/* Tick marks */}
                {ticks.map((t) => {
                    const angle = Math.PI - (t / 100) * Math.PI;
                    const x1 = cx + (outerR + 2) * Math.cos(angle);
                    const y1 = cy - (outerR + 2) * Math.sin(angle);
                    const x2 = cx + (outerR - 12) * Math.cos(angle);
                    const y2 = cy - (outerR - 12) * Math.sin(angle);
                    return (
                        <line key={t} x1={x1} y1={y1} x2={x2} y2={y2}
                            className="stroke-white/60 dark:stroke-[#12122a]/60" strokeWidth={t % 50 === 0 ? 2.5 : 1} />
                    );
                })}

                {/* Needle */}
                <line x1={cx} y1={cy} x2={nx} y2={ny}
                    stroke="#1e293b" strokeWidth="3" strokeLinecap="round"
                    filter="url(#needleShadow)"
                    className="dark:stroke-slate-200 transition-all duration-1000 ease-out" />
                {/* Needle center cap */}
                <circle cx={cx} cy={cy} r="6" className="fill-slate-800 dark:fill-slate-200" />
                <circle cx={cx} cy={cy} r="3" className="fill-white dark:fill-[#12122a]" />

                {/* Bottom labels: RED / SCORE / GOAL */}
                <text x="35" y="138" className="fill-slate-500 dark:fill-slate-500" fontSize="9" fontWeight="600" textAnchor="middle">55%</text>
                <text x="35" y="127" className="fill-rose-500" fontSize="8" fontWeight="700" textAnchor="middle">RED</text>

                <text x={cx} y="138" className="fill-slate-500 dark:fill-slate-500" fontSize="9" fontWeight="600" textAnchor="middle">
                    {score !== null ? score.toFixed(1) : "—"}
                </text>
                <text x={cx} y="127" className="fill-slate-400 dark:fill-slate-500" fontSize="8" fontWeight="700" textAnchor="middle">SCORE</text>

                <text x="205" y="138" className="fill-slate-500 dark:fill-slate-500" fontSize="9" fontWeight="600" textAnchor="middle">85%</text>
                <text x="205" y="127" className="fill-emerald-500" fontSize="8" fontWeight="700" textAnchor="middle">GOAL</text>
            </svg>

            {/* Score + change badge */}
            <div className="flex items-center gap-3 -mt-1">
                <span className={`text-4xl font-bold ${getScoreColor(score).text}`}>{pct}%</span>
                {diff !== null && diff !== 0 && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        diff > 0
                            ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400"
                    }`}>
                        {diff > 0 ? "+" : ""}{diff}%
                    </span>
                )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
        </div>
    );
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy - r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy - r * Math.sin(endAngle);
    const largeArc = Math.abs(startAngle - endAngle) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

// ─── Custom Tooltip for Chart ───
function ChartTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-lg shadow-lg px-3 py-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</p>
            <p className="text-sm font-bold text-violet-500">{payload[0].value?.toFixed(2)} / 5</p>
            <p className="text-[10px] text-slate-500">{getPercentage(payload[0].value)}%</p>
        </div>
    );
}

// ─── Main Component ───
export default function ScoreCard({ user, monthlyRatings, managerRatings, selectedMonth, availableMonths, onMonthChange }: ScoreCardProps) {
    const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
    const monthRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // Current selected rating
    const selectedRating = selectedMonth
        ? monthlyRatings.find(r => monthKeyFromDate(r.month) === selectedMonth) || null
        : monthlyRatings[0] || null;

    const overallScore = selectedRating?.overallRating ? Number(selectedRating.overallRating) : null;

    // Chart data: all ratings sorted by month ascending
    const chartData = [...monthlyRatings]
        .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime())
        .map(r => ({
            month: formatMonthShort(monthKeyFromDate(r.month)),
            monthKey: monthKeyFromDate(r.month),
            score: r.overallRating ? Number(r.overallRating) : null,
            pct: r.overallRating ? getPercentage(Number(r.overallRating)) : null,
        }));

    // Months for the "Actual & Threshold" section: current + previous, newest first
    const recentMonths = [...monthlyRatings]
        .sort((a, b) => new Date(b.month).getTime() - new Date(a.month).getTime());

    // Previous month score for the change badge on the gauge
    const prevRating = recentMonths.length > 1 ? recentMonths[1] : null;
    const prevScore = prevRating?.overallRating ? Number(prevRating.overallRating) : null;

    const handleMonthClick = (monthKey: string) => {
        if (expandedMonth === monthKey) {
            setExpandedMonth(null);
        } else {
            setExpandedMonth(monthKey);
            // Scroll into view
            setTimeout(() => {
                monthRefs.current[monthKey]?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 100);
        }
    };

    return (
        <div className="space-y-6">
            {/* ═══ TOP: Overview Section ═══ */}
            <div className="rounded-2xl bg-white dark:bg-[#12122a] border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none overflow-hidden">
                {/* Tab-like header */}
                <div className="flex items-center gap-1 px-6 pt-5 pb-3 border-b border-slate-100 dark:border-white/5">
                    <UserAvatar name={user.name} src={user.profilePictureUrl} size="lg"
                        gradient="from-violet-500 to-fuchsia-500" className="ring-2 ring-white/10" />
                    <div className="ml-3 flex-1">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{user.name}</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/25 font-semibold uppercase tracking-wider">
                                {ROLE_LABELS[user.role] || user.role}
                            </span>
                            {user.teamCapsule && (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-500 border border-slate-200 dark:border-white/10">
                                    {user.teamCapsule}
                                </span>
                            )}
                            {user.manager && (
                                <span className="text-[10px] text-slate-500">
                                    Reports to <span className="font-medium text-slate-700 dark:text-slate-300">{user.manager.name}</span>
                                </span>
                            )}
                        </div>
                    </div>
                    {/* Month selector */}
                    {selectedMonth && availableMonths && onMonthChange && (
                        <div className="relative">
                            <select value={selectedMonth} onChange={(e) => onMonthChange(e.target.value)}
                                className="appearance-none pl-3 pr-7 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                                {Array.from(new Set(availableMonths)).map(m => (
                                    <option key={m} value={m} className="bg-white dark:bg-[#1a1a2e]">{formatMonthLabel(m)}</option>
                                ))}
                            </select>
                            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    )}
                </div>

                {/* Performance + Chart */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 lg:divide-x divide-slate-100 dark:divide-white/5">
                    {/* Left: Gauge */}
                    <div className="lg:col-span-2 p-6 flex flex-col items-center justify-center">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Performance</p>
                        <GaugeMeter score={overallScore} label={selectedMonth ? formatMonthLabel(selectedMonth) : "Overall"} prevScore={prevScore} />
                        {/* Quick stats below gauge */}
                        <div className="flex items-center gap-6 mt-4">
                            {user.role !== "hr_manager" && (
                                <div className="text-center">
                                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                                        {selectedRating
                                            ? selectedRating.roleType === "researcher_manager"
                                                ? (sumResearchManagerPipelineCases(selectedRating.parametersJson) ?? selectedRating.casesCompleted)
                                                : selectedRating.casesCompleted
                                            : "—"}
                                    </p>
                                    <p className="text-[10px] text-slate-500 uppercase">Cases</p>
                                </div>
                            )}
                            <div className="text-center">
                                <p className={`text-lg font-bold ${getScoreColor(overallScore).text}`}>
                                    {overallScore !== null ? overallScore.toFixed(2) : "—"}
                                </p>
                                <p className="text-[10px] text-slate-500 uppercase">Score</p>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-bold text-slate-900 dark:text-white">
                                    {overallScore !== null ? `${getPercentage(overallScore)}%` : "—"}
                                </p>
                                <p className="text-[10px] text-slate-500 uppercase">Goal</p>
                            </div>
                        </div>
                    </div>

                    {/* Right: Historical Performance Chart */}
                    <div className="lg:col-span-3 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Historical Performance</p>
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                        </div>
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                                    <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                                    <Tooltip content={<ChartTooltip />} />
                                    <ReferenceLine y={4} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.4} />
                                    <ReferenceLine y={3} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.3} />
                                    <Line type="monotone" dataKey="score" stroke="#8b5cf6" strokeWidth={2.5}
                                        dot={(props: any) => {
                                            const { cx, cy, payload } = props;
                                            const c = getScoreColor(payload.score);
                                            return <circle key={payload.monthKey} cx={cx} cy={cy} r={5} fill={c.gauge} stroke="#fff" strokeWidth={2} />;
                                        }}
                                        activeDot={{ r: 7, stroke: "#8b5cf6", strokeWidth: 2 }}
                                        connectNulls />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-[200px] flex items-center justify-center text-sm text-slate-500">
                                No historical data yet
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ═══ BOTTOM: Actual & Threshold Values (Month-wise Pillar Breakdown) ═══ */}
            <div className="rounded-2xl bg-white dark:bg-[#12122a] border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none p-6">
                <div className="flex items-center justify-between mb-5">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Actual and Threshold Values
                    </h3>
                </div>

                {recentMonths.length > 0 ? (
                    <div className="space-y-3">
                        {/* Month-wise table header */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 dark:border-white/5">
                                        <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-40"></th>
                                        <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Score</th>
                                        <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actual</th>
                                        <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Red</th>
                                        <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Goal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentMonths.map((rating) => {
                                        const mk = monthKeyFromDate(rating.month);
                                        const score = rating.overallRating ? Number(rating.overallRating) : null;
                                        const pct = getPercentage(score);
                                        const sc = getScoreColor(score);
                                        const isExpanded = expandedMonth === mk;

                                        return (
                                            <tr key={rating.id}
                                                ref={(el) => { monthRefs.current[mk] = el as HTMLDivElement; }}
                                                onClick={() => handleMonthClick(mk)}
                                                className={`cursor-pointer transition-colors border-b border-slate-50 dark:border-white/[0.03] ${
                                                    isExpanded ? "bg-violet-50/50 dark:bg-violet-500/5" : "hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                                                }`}>
                                                <td className="py-3 px-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-2 h-2 rounded-full ${sc.bg}`} />
                                                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            {formatMonthLabel(mk)}
                                                        </span>
                                                        <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                                            fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-3 text-center">
                                                    <span className={`text-sm font-bold ${sc.text}`}>{score?.toFixed(1) ?? "—"}</span>
                                                </td>
                                                <td className="py-3 px-3 text-center">
                                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{pct}%</span>
                                                </td>
                                                <td className="py-3 px-3 text-center">
                                                    <span className="text-sm text-rose-500 font-medium">55%</span>
                                                </td>
                                                <td className="py-3 px-3 text-center">
                                                    <span className="text-sm text-emerald-500 font-medium">85%</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Expanded month: Per-pillar breakdown */}
                        {expandedMonth && (() => {
                            const rating = recentMonths.find(r => monthKeyFromDate(r.month) === expandedMonth);
                            if (!rating?.parametersJson || !Array.isArray(rating.parametersJson)) return null;
                            const params = rating.parametersJson as any[];
                            const managerRating = managerRatings.find(mr => mr.period === expandedMonth);

                            return (
                                <div className="mt-2 border border-slate-100 dark:border-white/5 rounded-xl overflow-hidden">
                                    <div className="bg-slate-50 dark:bg-white/[0.02] px-4 py-3 border-b border-slate-100 dark:border-white/5">
                                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                            Pillar Breakdown — {formatMonthLabel(expandedMonth)}
                                        </p>
                                    </div>
                                    <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
                                        {params.map((param: any) => {
                                            const SOURCE_BADGES: Record<string, { label: string; color: string }> = {
                                                clickup: { label: "ClickUp", color: "bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20" },
                                                manager: { label: "Manager", color: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" },
                                                youtube: { label: "YouTube", color: "bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20" },
                                                formula: { label: "ClickUp x Formula", color: "bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-500/20" },
                                            };
                                            const source = SOURCE_BADGES[param.source] || { label: param.source, color: "bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10" };
                                            const isPending = param.stars === null && param.source === "manager";
                                            const stars = param.stars ? Number(param.stars) : null;
                                            const starPct = stars ? getPercentage(stars) : null;
                                            const sc = getScoreColor(stars);

                                            return (
                                                <div key={param.key || param.name} className="px-4 py-3">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{param.label}</span>
                                                            <span className={`text-[9px] px-1.5 py-0.5 rounded-md border ${source.color} font-medium`}>
                                                                {source.label}
                                                            </span>
                                                            <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider tabular-nums">
                                                                Weightage {Math.round(param.weight * 100)}%
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            {isPending ? (
                                                                <span className="text-[10px] text-amber-500 font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">Pending</span>
                                                            ) : (
                                                                <>
                                                                    <span className={`text-sm font-bold ${sc.text}`}>{stars?.toFixed(1) ?? "—"}</span>
                                                                    <span className="text-[10px] text-slate-500">{starPct ?? 0}%</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {/* Star display */}
                                                    <div className="flex items-center gap-1">
                                                        {[1, 2, 3, 4, 5].map((s) => (
                                                            <svg key={s}
                                                                className={`w-3.5 h-3.5 ${isPending ? "text-slate-300 dark:text-slate-700" : s <= (stars || 0) ? "text-amber-400" : "text-slate-300 dark:text-slate-700"}`}
                                                                fill="currentColor" viewBox="0 0 20 20">
                                                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                                            </svg>
                                                        ))}
                                                        {/* Progress bar */}
                                                        <div className="flex-1 ml-2 h-1.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                                                            <div className={`h-full rounded-full ${sc.bg} transition-all duration-500`}
                                                                style={{ width: `${starPct ?? 0}%` }} />
                                                        </div>
                                                    </div>
                                                    {param.qualityBreakdown != null && (
                                                        <p className="text-[10px] text-violet-600 dark:text-violet-400 mt-1.5 font-medium leading-snug">
                                                            RTC{" "}
                                                            {param.qualityBreakdown.rtc != null && Number.isFinite(Number(param.qualityBreakdown.rtc))
                                                                ? Number(param.qualityBreakdown.rtc).toFixed(1)
                                                                : "—"}
                                                            <span className="text-slate-400 mx-1">·</span>
                                                            FOIA{" "}
                                                            {param.qualityBreakdown.foia != null && Number.isFinite(Number(param.qualityBreakdown.foia))
                                                                ? Number(param.qualityBreakdown.foia).toFixed(1)
                                                                : "—"}
                                                            {param.qualityBreakdown.foia_pitched != null &&
                                                            Number.isFinite(Number(param.qualityBreakdown.foia_pitched)) ? (
                                                                <>
                                                                    <span className="text-slate-400 mx-1">·</span>
                                                                    Pitched{" "}
                                                                    {Number(param.qualityBreakdown.foia_pitched).toFixed(1)}
                                                                </>
                                                            ) : null}
                                                        </p>
                                                    )}
                                                    {param.breakdown?.rtc != null && (
                                                        <p className="text-[10px] text-teal-600 dark:text-teal-400 mt-1.5 font-medium leading-snug">
                                                            RTC {param.breakdown.rtc.actual}/{param.breakdown.rtc.target}
                                                            <span className="text-slate-400 mx-1">·</span>
                                                            FOIA {param.breakdown.foia.actual}/{param.breakdown.foia.target}
                                                            <span className="text-slate-400 mx-1">·</span>
                                                            Pitched {param.breakdown.foia_pitched.actual}/{param.breakdown.foia_pitched.target}
                                                        </p>
                                                    )}
                                                    {param.details && (
                                                        <p className="text-[10px] text-slate-500 mt-1.5">{param.details}</p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Manager comment for this month */}
                                    {managerRating?.comments && (
                                        <div className="px-4 py-3 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-100 dark:border-white/5">
                                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Manager Comment</p>
                                            <p className="text-xs text-slate-600 dark:text-slate-400 italic">&ldquo;{managerRating.comments}&rdquo;</p>
                                            <p className="text-[10px] text-slate-500 mt-1">— {managerRating.manager.name}</p>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                ) : (
                    <div className="text-center py-10">
                        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-3">
                            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <p className="text-sm text-slate-500">No score data available yet</p>
                        <p className="text-[11px] text-slate-500 mt-1">Scores will appear here once ratings are calculated</p>
                    </div>
                )}
            </div>
        </div>
    );
}
