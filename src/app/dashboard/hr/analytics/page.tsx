"use client";
import { useState, useEffect } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { parseAttLoc, captureClockInGeo } from "@/lib/attendance-location";
import { isHRAdmin } from "@/lib/access";
import { desktopBypassHeader } from "@/lib/desktop-bypass";
import {
  ChevronLeft, ChevronRight, ChevronDown,
  Send, BarChart2, Award, Mail, Users, Calendar,
  MapPin, HardDrive, Plus
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  page:    "bg-[#f2f5f9]",
  card:    "bg-white border border-[#dbe5ef] rounded-md shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
  t1:      "text-[#1b2b3c]",
  t2:      "text-[#415a73]",
  t3:      "text-[#6e8499]",
  div:     "border-[#dbe5ef]",
  ring:    "ring-white",
} as const;

// ── Small ring for leave balance ───────────────────────────────────────────────
function BalanceRing({ avail, total, color }: { avail: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min((avail / total) * 100, 100) : 0;
  const r = 30, circum = 2 * Math.PI * r;
  return (
    <div className="relative w-[70px] h-[70px]">
      <svg viewBox="0 0 70 70" className="w-full h-full -rotate-90">
        <circle cx="35" cy="35" r={r} fill="none" strokeWidth="6"
          className="stroke-[#e8ecf0] dark:stroke-[rgba(255,255,255,0.07)]" />
        <circle cx="35" cy="35" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circum} strokeDashoffset={circum * (1 - pct / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[14px] font-bold" style={{ color }}>{avail}</span>
        <span className="text-[9px] mt-0.5 text-[#94a3b8] dark:text-[#4e5e72]">days</span>
      </div>
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
function Av({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const palette = ["#6366f1","#0891b2","#059669","#d97706","#db2777","#7c3aed","#dc2626"];
  const bg = palette[name.charCodeAt(0) % palette.length];
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name} style={{ width: size, height: size }} className={`rounded-full object-cover ring-2 ${C.ring} shrink-0`} />;
  return (
    <div style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.33) }}
      className={`rounded-full flex items-center justify-center text-white font-semibold ring-2 ${C.ring} shrink-0`}>
      {initials}
    </div>
  );
}

// Visual hues per DB holiday `type`. The seeder / admin form writes one of these.
const HOLIDAY_TYPE_COLOR: Record<string, string> = {
  public:     "#008CFF",
  company:    "#7c3aed",
  optional:   "#059669",
};
const HOLIDAY_TYPE_LABEL: Record<string, string> = {
  public:     "NATIONAL HOLIDAY",
  company:    "COMPANY HOLIDAY",
  optional:   "FLOATER HOLIDAY",
};
const isoDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {} as any);

// ── Events widget ─────────────────────────────────────────────────────────
// Tabs: Birthdays · Work Anniversaries · New Joinees. Auto-derived from DB.
function EventsWidget({
  bTab, setBTab, C,
}: {
  bTab: "birthday" | "anniversary" | "joinees";
  setBTab: (v: "birthday" | "anniversary" | "joinees") => void;
  C: { card: string; t1: string; t2: string; t3: string; div: string; ring: string };
}) {
  const { data } = useSWR("/api/hr/events", fetcher, { refreshInterval: 60_000 });
  const birthdays     = data?.birthdays     ?? { today: [], upcoming: [], count: 0 };
  const anniversaries = data?.anniversaries ?? { thisWeek: [],             count: 0 };
  const newJoinees    = data?.newJoinees    ?? { thisMonth: [],            count: 0 };

  const tabs: { k: "birthday" | "anniversary" | "joinees"; emoji: string; count: number; label: string }[] = [
    { k: "birthday",    emoji: "🎂", count: birthdays.count,     label: birthdays.count     === 1 ? "Birthday"         : "Birthdays"          },
    { k: "anniversary", emoji: "✨", count: anniversaries.count, label: anniversaries.count === 1 ? "Work Anniversary" : "Work Anniversaries" },
    { k: "joinees",     emoji: "👤", count: newJoinees.count,    label: newJoinees.count    === 1 ? "New Joinee"       : "New Joinees"        },
  ];

  const row = (p: { userId: number; name: string; profilePictureUrl: string | null; designation: string | null; dateLabel: string }, extra?: string) => (
    <Link key={p.userId} href={`/dashboard/hr/people/${p.userId}`}
      className="flex items-center gap-2.5 py-1.5 hover:bg-slate-50 rounded-md px-1.5 -mx-1.5 transition-colors">
      <img
        src={p.profilePictureUrl || ""}
        alt={p.name}
        referrerPolicy="no-referrer"
        className="w-8 h-8 rounded-full object-cover bg-[#e8ecf0]"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-[12.5px] font-medium ${C.t1} truncate leading-tight`}>{p.name}</p>
        <p className={`text-[10.5px] ${C.t3} truncate leading-tight`}>
          {p.designation || "—"}{extra ? ` · ${extra}` : ""}
        </p>
      </div>
      <span className="text-[10.5px] font-semibold text-[#008CFF] whitespace-nowrap">{p.dateLabel}</span>
    </Link>
  );

  return (
    <div className={`${C.card} overflow-hidden`}>
      <div className={`flex items-center justify-between border-b ${C.div} px-1`}>
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => setBTab(t.k)}
              className={`px-3 py-2.5 text-[12px] border-b-2 -mb-px whitespace-nowrap transition-colors ${
                bTab === t.k
                  ? "border-[#008CFF] text-[#008CFF] font-semibold"
                  : `border-transparent ${C.t3} font-medium hover:${C.t1}`
              }`}
            >
              {t.emoji} {t.count} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-4 space-y-3">
        {bTab === "birthday" && (
          <>
            <div>
              <p className={`text-[11.5px] font-semibold ${C.t2} mb-1.5`}>Birthdays today</p>
              {birthdays.today.length === 0
                ? <p className={`text-[12px] ${C.t3}`}>No birthdays today</p>
                : <div className="space-y-1">{birthdays.today.map((p: any) => row(p, "🎉 Today"))}</div>}
            </div>
            <div>
              <p className={`text-[11.5px] font-semibold ${C.t2} mb-1.5`}>Upcoming birthdays</p>
              {birthdays.upcoming.length === 0
                ? <p className={`text-[12px] ${C.t3}`}>No upcoming birthdays in the next 14 days</p>
                : <div className="space-y-1">{birthdays.upcoming.map((p: any) => row(p, `in ${p.daysAway} day${p.daysAway === 1 ? "" : "s"}`))}</div>}
            </div>
          </>
        )}
        {bTab === "anniversary" && (
          anniversaries.thisWeek.length === 0
            ? <p className={`text-[12px] ${C.t3}`}>No work anniversaries this week</p>
            : <div className="space-y-1">{anniversaries.thisWeek.map((p: any) => row(p, `${p.years} year${p.years === 1 ? "" : "s"}`))}</div>
        )}
        {bTab === "joinees" && (
          newJoinees.thisMonth.length === 0
            ? <p className={`text-[12px] ${C.t3}`}>No new joinees this month</p>
            : <div className="space-y-1">{newJoinees.thisMonth.map((p: any) => row(p, "Joined"))}</div>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function HRHomePage() {
  const { data: session } = useSession();
  const user    = session?.user as any;
  const isAdmin = isHRAdmin(user);

  const monthKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; })();

  const { data: analyticsData }    = useSWR("/api/hr/analytics", fetcher);
  const { data: boardData }        = useSWR("/api/hr/attendance/board", fetcher);
  const { data: balanceData = [] } = useSWR("/api/hr/leaves/balance", fetcher);
  const { data: myData }           = useSWR(`/api/hr/attendance?month=${monthKey}`, fetcher);
  const { data: profile }          = useSWR("/api/hr/profile", fetcher);
  const { data: myWfh = [] }       = useSWR("/api/hr/attendance/wfh?view=my", fetcher);

  // displayName/email/photo used by the merged global header (src/components/layout/header.tsx).

  const workLoc  = (profile?.employeeProfile?.workLocation || "office").toLowerCase();
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasWfhToday = Array.isArray(myWfh) && myWfh.some((r: any) =>
    r.status === "approved" && typeof r.date === "string" && r.date.slice(0, 10) === todayKey
  );
  const isRemoteMode = workLoc === "remote" || workLoc === "hybrid" || hasWfhToday;

  const [hh, setHh] = useState("--");
  const [mm, setMm] = useState("--");
  const [ss, setSs] = useState("--");
  const [ap, setAp] = useState("AM");
  const [dl, setDl] = useState("");
  const [hidx, setHidx]   = useState(0);
  const [feedTab, setFT]  = useState<"post"|"poll"|"praise">("post");
  const [bTab, setBTab]   = useState<"birthday"|"anniversary"|"joinees">("birthday");
  const [postText, setPost] = useState("");
  const [orgTab, setOrgTab] = useState<"org"|"team">("org");
  // Two-step Clock-Out confirmation (matches home + attendance pages).
  // First click on the red Clock-out button flips this flag; the
  // button splits into a Confirm + Cancel pair so a stray click can't
  // end the day. Auto-collapses after 6s if the user walks away.
  const [confirmingClockOut, setConfirmingClockOut] = useState(false);
  // Held while the async clockOut() POST is in flight. Keeps the
  // Confirm/Cancel pair visible until the API resolves and disables
  // Confirm so a double-click can't fire two POSTs.
  const [clockingOut, setClockingOut] = useState(false);
  useEffect(() => {
    if (!confirmingClockOut || clockingOut) return;
    const t = setTimeout(() => setConfirmingClockOut(false), 6000);
    return () => clearTimeout(t);
  }, [confirmingClockOut, clockingOut]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata", hour12: false,
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(d).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
      const h24 = parseInt(parts.hour || "0", 10);
      setHh(String(h24 % 12 || 12).padStart(2, "0"));
      setMm(parts.minute || "00");
      setSs(parts.second || "00");
      setAp(h24 >= 12 ? "PM" : "AM");
      setDl(d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday:"short", day:"numeric", month:"short", year:"numeric" }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Pull holidays from the DB (seeded Indian calendar + anything HR adds via admin).
  const thisYear = new Date().getFullYear();
  const { data: holidaysData = [] } = useSWR(`/api/hr/admin/holidays?year=${thisYear}`, fetcher);
  const istTodayStr = (() => { const p = isoDay(new Date()); return `${p.year}-${p.month}-${p.day}`; })();
  const allHolidays: { id: number; name: string; date: string; type: string }[] = Array.isArray(holidaysData)
    ? holidaysData.map((h: any) => ({ id: h.id, name: h.name, date: String(h.date).slice(0, 10), type: h.type || "public" }))
    : [];
  const todaysHoliday = allHolidays.find((h) => h.date === istTodayStr) || null;
  const upcoming      = allHolidays.filter((h) => h.date >= istTodayStr);
  const holiday       = upcoming[hidx] ?? upcoming[0] ?? null;
  const todayRec = myData?.todayRecord;
  const todayLoc = parseAttLoc(todayRec?.location);

  const clockIn = async () => {
    const geo = await captureClockInGeo();
    await fetch("/api/hr/attendance/clock-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...desktopBypassHeader() },
      body: JSON.stringify(geo),
    });
    mutate(`/api/hr/attendance?month=${monthKey}`);
  };
  const clockOut = async () => { await fetch("/api/hr/attendance/clock-out", { method: "POST", headers: desktopBypassHeader() }); mutate(`/api/hr/attendance?month=${monthKey}`); };
  const onLeave  = (boardData?.board || []).filter((u: any) => u.status === "on_leave");
  // Split clocked-in employees by their actual location mode (from Attendance.location JSON).
  // "Working Remotely" lists ONLY users who applied for WFH today —
  // permanent remote / hybrid folks live under the Remote Clock-in
  // filter on the attendance dashboard, not on this card.
  const clockedIn = (boardData?.board || []).filter((u: any) => u.status === "present" || u.status === "late");
  const remote    = (boardData?.board || []).filter((u: any) => u.wfhToday === true);
  const inOffice  = clockedIn.filter((u: any) => parseAttLoc(u.location).mode !== "remote");
  const balances = (balanceData as any[]).filter(b => b.leaveType).slice(0, 3);
  const ringColors = ["#008CFF", "#00bcd4", "#9c27b0"];

  return (
    <div className={`min-h-screen ${C.page} flex flex-col`}>

      {/* ── Body ── (the welcome banner is now merged into the global Header) */}
      <div className="flex flex-1 min-h-0 relative gap-2 pl-2 pr-3 py-2.5">

        {/* ══ LEFT column ══ */}
        <div className="w-[272px] shrink-0 overflow-y-auto">
          <div className="space-y-2.5">

            <p className={`text-[13px] font-semibold ${C.t1} pb-0.5 pt-1 leading-none`}>
              Quick Access
            </p>

            {/* ── Clock widget ── */}
            <div className="rounded-lg px-4 py-3.5 overflow-hidden relative"
                 style={{ background: "#9182bf" }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] leading-none font-semibold text-white/80" suppressHydrationWarning>
                  Time Today - {dl}
                </span>
                <Link href="/dashboard/hr/attendance" className="text-[11px] text-white/70 hover:text-white transition-colors leading-none">
                  View All
                </Link>
              </div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/60">Current Time</p>
                {(() => {
                  const activeRemote = todayLoc.mode
                    ? todayLoc.mode === "remote"
                    : isRemoteMode;
                  return (
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
                          style={{ background: activeRemote ? "rgba(0,140,255,0.35)" : "rgba(255,255,255,0.18)", color: "#fff" }}>
                      {activeRemote ? "Remote" : "Office"}
                    </span>
                  );
                })()}
              </div>

              {/* ── Digital clock display ── */}
              <div className="rounded-md px-3 py-2 mb-2.5 flex items-start gap-0.5"
                   style={{ background: "rgba(0,0,0,0.32)" }}>
                <span suppressHydrationWarning
                  style={{ fontFamily:"'Courier New',Courier,monospace", fontSize:36, letterSpacing:"0.04em",
                           fontWeight:700, lineHeight:1, color:"#ffffff" }}>
                  {hh}:{mm}
                </span>
                <div style={{ display:"flex", flexDirection:"column", paddingTop:2, gap:2 }}>
                  <span suppressHydrationWarning
                    style={{ fontFamily:"'Courier New',monospace", fontSize:13, letterSpacing:"0.04em",
                             fontWeight:700, lineHeight:1, color:"rgba(255,255,255,0.75)" }}>
                    :{ss}
                  </span>
                  <span suppressHydrationWarning
                    style={{ fontFamily:"'Courier New',monospace", fontSize:12, lineHeight:1,
                             color:"rgba(255,255,255,0.85)" }}>
                    {ap}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                {!todayRec?.clockIn ? (
                  <button onClick={clockIn}
                    className="h-7 px-4 rounded-md text-[12px] font-semibold text-white transition-all hover:brightness-95 active:scale-95"
                    style={{ background: isRemoteMode ? "#008CFF" : "#ff6a6a" }}>
                    {isRemoteMode ? "Remote Clock-in" : "Clock-in"}
                  </button>
                ) : !todayRec?.clockOut ? (
                  // Two-step confirmation. Same pattern as home + attendance —
                  // first click opens Confirm + Cancel, only Confirm fires
                  // clockOut(). Prevents accidental end-of-day from a
                  // misclick on this analytics tile.
                  confirmingClockOut ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={async () => {
                          if (clockingOut) return;
                          setClockingOut(true);
                          try {
                            await clockOut();
                          } finally {
                            setClockingOut(false);
                            setConfirmingClockOut(false);
                          }
                        }}
                        disabled={clockingOut}
                        className="h-7 px-3 rounded-md text-[12px] font-semibold text-white transition-all hover:brightness-95 active:scale-95 disabled:opacity-70 disabled:cursor-wait disabled:active:scale-100"
                        style={{ background: "#dc2626" }}
                      >
                        {clockingOut ? "Clocking out…" : "Confirm Web Clock-Out"}
                      </button>
                      <button
                        onClick={() => setConfirmingClockOut(false)}
                        disabled={clockingOut}
                        className="h-7 px-3 rounded-md text-[12px] font-semibold text-white transition-all hover:brightness-95 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100"
                        style={{ background: "#475569" }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingClockOut(true)}
                      className="h-7 px-4 rounded-md text-[12px] font-semibold text-white transition-all hover:brightness-95 active:scale-95"
                      style={{ background: todayLoc.mode === "remote" ? "#008CFF" : "#ff6a6a" }}
                    >
                      {todayLoc.mode === "remote" ? "Remote Clock-out" : "Web Clock-Out"}
                    </button>
                  )
                ) : (
                  <span className="h-7 px-4 rounded-md text-[12px] font-semibold flex items-center text-white/90"
                        style={{ background: "rgba(255,255,255,0.18)" }}>
                    Done ✓
                  </span>
                )}
                <button className="h-7 px-3 rounded-md text-[11px] font-medium flex items-center gap-1 text-[#2c2c2c]"
                        style={{ background: "#ffffff" }}>
                  Other <ChevronDown className="w-3 h-3"/>
                </button>
              </div>
            </div>

            {/* ── Inbox ── */}
            <div className={`${C.card} p-3`}>
              <p className={`text-[13px] font-semibold ${C.t1} mb-3`}>Inbox</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                     style={{ background: "rgba(99,102,241,0.10)" }}>
                  <Mail style={{ color: "#6366f1", width: 18, height: 18 }}/>
                </div>
                <div>
                  <p className={`text-[13px] font-semibold ${C.t1}`}>Good job!</p>
                  <p className={`text-[12px] ${C.t3} mt-0.5`}>You have no pending actions</p>
                </div>
              </div>
            </div>

            {/* ── Holidays ── today-only widget. If nothing today, show empty state
                 regardless of whether upcoming holidays exist. */}
            {!todaysHoliday && (
              <div className="rounded-lg p-4 relative overflow-hidden border border-[#dbe5ef]" style={{ minHeight: 108, background: "#f8fafc" }}>
                <div className="flex items-start justify-between mb-2">
                  <span className={`text-[9.5px] font-bold uppercase tracking-[0.14em] ${C.t3}`}>Holidays</span>
                  <Link
                    href={isAdmin ? "/dashboard/hr/admin/holidays" : "/dashboard/hr/leaves"}
                    className="text-[11px] text-[#008CFF] hover:underline"
                  >
                    {isAdmin ? "Manage" : "View All"}
                  </Link>
                </div>
                <p className={`text-[14px] font-semibold ${C.t1} mb-1`}>No event today</p>
                <p className={`text-[11.5px] ${C.t3}`}>
                  {upcoming.length > 0
                    ? `Next: ${upcoming[0].name} · ${new Date(upcoming[0].date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                    : "No upcoming holidays on file."}
                </p>
              </div>
            )}
            {todaysHoliday && (
              <div className="rounded-lg p-4 relative overflow-hidden" style={{ minHeight: 108,
                   background: "linear-gradient(165deg, #1a6b42 0%, #0e4528 100%)" }}>
                {/* Mosque silhouette */}
                <svg viewBox="0 0 340 55" style={{ position: "absolute", bottom: 0, right: -4, width: "90%", height: 55 }}
                     preserveAspectRatio="xMaxYMax meet">
                  <g fill="rgba(0,0,0,0.28)">
                    <rect x="30" y="50" width="280" height="6"/>
                    <polygon points="52,50 52,14 55,6 58,14 58,50"/>
                    <rect x="47" y="27" width="16" height="3" rx="1"/>
                    <polygon points="282,50 282,14 285,6 288,14 288,50"/>
                    <rect x="277" y="27" width="16" height="3" rx="1"/>
                    <rect x="65" y="36" width="50" height="20"/>
                    <path d="M65,36 A25,20 0 0 1 115,36Z"/>
                    <rect x="115" y="40" width="110" height="16"/>
                    <path d="M115,40 A55,36 0 0 1 225,40Z"/>
                    <rect x="168" y="5" width="4" height="35"/>
                    <circle cx="170" cy="5" r="3"/>
                    <rect x="225" y="36" width="50" height="20"/>
                    <path d="M225,36 A25,20 0 0 1 275,36Z"/>
                  </g>
                  <path d="M295,8 A11,11 0 1,1 309,20 A8,8 0 1,0 295,8Z" fill="rgba(255,255,255,0.40)"/>
                  <circle cx="315" cy="10" r="1.8" fill="rgba(255,255,255,0.30)"/>
                </svg>
                <div className="relative z-10">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white">Holidays</span>
                      {todaysHoliday && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white text-[#0e4528]">
                          Today
                        </span>
                      )}
                    </div>
                    <Link href={isAdmin ? "/dashboard/hr/admin/holidays" : "/dashboard/hr/leaves"} className="text-[11px] text-white/80 hover:text-white transition-colors">
                      {isAdmin ? "Manage" : "View All"}
                    </Link>
                  </div>
                  <p className="text-[17px] font-bold text-white leading-snug pr-14 mb-2">{todaysHoliday.name}</p>
                  <div>
                    <p className="text-[11px] text-white/80 mb-1.5">
                      {new Date(todaysHoliday.date).toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"long", year:"numeric" })}
                    </p>
                    <span className="inline-block px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide text-white"
                          style={{ background: HOLIDAY_TYPE_COLOR[todaysHoliday.type] ?? "#008CFF" }}>
                      {HOLIDAY_TYPE_LABEL[todaysHoliday.type] ?? "PUBLIC HOLIDAY"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── On Leave Today ── */}
            <div className={`${C.card} p-3`}>
              <p className={`text-[13px] font-semibold ${C.t1} mb-3`}>On Leave Today</p>
              {onLeave.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {onLeave.slice(0, 6).map((u: any) => (
                    <div key={u.id} className="flex flex-col items-center gap-1">
                      <Av name={u.name} url={u.profilePictureUrl} size={40}/>
                      <span className={`text-[10px] ${C.t3} truncate text-center`} style={{ width: 40 }}>
                        {u.name.split(" ")[0]}
                      </span>
                    </div>
                  ))}
                  {onLeave.length > 6 && (
                    <div className="flex flex-col items-center gap-1">
                      <div className={`rounded-full flex items-center justify-center text-[10px] font-semibold ring-2 ${C.ring}`}
                           style={{ width: 40, height: 40, background: "rgba(0,140,255,0.1)", color: "#008CFF" }}>
                        +{onLeave.length - 6}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className={`text-[12px] ${C.t3}`}>No one on leave today</p>
              )}
            </div>

            {/* ── In Office ── */}
            <div className={`${C.card} p-3`}>
              <p className={`text-[13px] font-semibold ${C.t1} mb-3`}>In Office</p>
              {inOffice.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {inOffice.slice(0, 6).map((u: any) => (
                    <div key={u.id} className="flex flex-col items-center gap-1">
                      <Av name={u.name} url={u.profilePictureUrl} size={40}/>
                      <span className={`text-[10px] ${C.t3} truncate text-center`} style={{ width: 40 }}>
                        {u.name.split(" ")[0]}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-[12px] ${C.t3}`}>No one in office yet</p>
              )}
            </div>

            {/* ── Working Remotely ── */}
            <div className={`${C.card} p-3`}>
              <p className={`text-[13px] font-semibold ${C.t1} mb-3`}>Working Remotely</p>
              {remote.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {remote.slice(0, 6).map((u: any) => (
                    <div key={u.id} className="flex flex-col items-center gap-1">
                      <Av name={u.name} url={u.profilePictureUrl} size={40}/>
                      <span className={`text-[10px] ${C.t3} truncate text-center`} style={{ width: 40 }}>
                        {u.name.split(" ")[0]}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-[12px] ${C.t3}`}>No one working remotely</p>
              )}
            </div>

            {/* ── Leave Balances ── */}
            <div className={`${C.card} p-4`}>
              <p className={`text-[16px] font-semibold ${C.t1} mb-4 leading-none`}>Leave Balances</p>
              {balances.length > 0 ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex gap-5">
                    {balances.slice(0, 2).map((b: any, i: number) => {
                      const avail = Math.max(0, (b.totalDays || 0) - (b.usedDays || 0) - (b.pendingDays || 0));
                      return (
                        <div key={b.id} className="flex flex-col items-center gap-1.5">
                          <BalanceRing avail={avail} total={b.totalDays || 1} color={["#34b3d9", "#84d7ef"][i % 2]} />
                          <p className={`text-[10px] font-medium uppercase text-center leading-tight ${C.t3}`}
                             style={{ letterSpacing: "0.05em", maxWidth: 95 }}>
                            {b.leaveType?.name}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-[120px]">
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#008CFF] hover:underline leading-none">
                      Request Leave
                    </Link>
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#008CFF] hover:underline leading-none">
                      View All Balances
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p className={`text-[12px] ${C.t3}`}>No leave balances configured</p>
                  <div className="flex flex-col gap-1.5 min-w-[110px]">
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#008CFF] hover:underline">
                      Request Leave
                    </Link>
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#008CFF] hover:underline">
                      View All Balances
                    </Link>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ══ RIGHT column (feed) ══ */}
        <div className="flex-1 overflow-y-auto min-w-0">

          <div className="space-y-3 pr-1">

            {/* ── Compose card ── */}
            <div className={`${C.card} overflow-hidden`}>
              {/* Org / Team tabs */}
              <div className={`flex items-center border-b ${C.div} px-1`}>
                {[["org","Organization"],["team", user?.teamCapsule || "NB Media"]] .map(([k,l]) => (
                  <button key={k} onClick={() => setOrgTab(k as any)}
                    className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                      orgTab === k
                        ? "border-[#008CFF] text-[#008CFF]"
                        : `border-transparent ${C.t2} hover:${C.t1}`
                    }`}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="px-4 pt-3 pb-4">
                {/* Feed type tabs */}
                <div className="flex items-center gap-0.5 mb-3">
                  {[
                    { k:"post",   l:"Post",   I:<Send style={{ width:14,height:14 }}/>        },
                    { k:"poll",   l:"Poll",   I:<BarChart2 style={{ width:14,height:14 }}/>   },
                    { k:"praise", l:"Praise", I:<Award style={{ width:14,height:14 }}/>        },
                  ].map(({ k, l, I }) => (
                    <button key={k} onClick={() => setFT(k as any)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
                        feedTab === k
                          ? "bg-[#008CFF]/10 text-[#008CFF]"
                          : `${C.t2} hover:bg-white/[0.04]`
                      }`}>
                      {I}{l}
                    </button>
                  ))}
                </div>
                <textarea value={postText} onChange={e => setPost(e.target.value)}
                  placeholder="Write your post here and mention your peers"
                  rows={2}
                  className={`w-full resize-none bg-transparent text-[13px] ${C.t2} focus:outline-none placeholder-[#8a96a8] dark:placeholder-[#4e5e72]`}
                  style={{ caretColor: "#008CFF" }}/>
                {postText.trim() && (
                  <div className={`flex justify-end mt-2 pt-2 border-t ${C.div}`}>
                    <button onClick={() => setPost("")}
                      className="h-8 px-5 rounded-lg text-[12px] font-semibold text-white bg-[#008CFF] hover:bg-[#0070d4] transition-colors">
                      Post
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Announcements placeholder ── */}
            {isAdmin && (
              <div className={`${C.card} px-4 py-3 flex items-center justify-between`}>
                <span className={`text-[12.5px] ${C.t3}`}>No announcements</span>
                <button className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#008CFF]/10 hover:bg-[#008CFF]/20 transition-colors">
                  <Plus style={{ width:14,height:14,color:"#008CFF"}}/>
                </button>
              </div>
            )}

            {/* ── Birthdays / Anniversaries / New Joinees ── (auto-derived from EmployeeProfile) */}
            <EventsWidget bTab={bTab} setBTab={setBTab} C={C} />

            {/* ── HR Summary stats (admin) ── */}
            {isAdmin && analyticsData && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { lb: "Total Employees", val: analyticsData.workforce?.totalEmployees, color: "#008CFF",  Icon: Users,    href: "/dashboard/hr/people"    },
                  { lb: "Present Today",   val: analyticsData.attendance?.present,       color: "#10b981",  Icon: Calendar, href: "/dashboard/hr/attendance" },
                  { lb: "On Leave",        val: analyticsData.attendance?.onLeave,       color: "#8b5cf6",  Icon: MapPin,   href: "/dashboard/hr/leaves"     },
                ].map(m => (
                  <Link key={m.lb} href={m.href}
                    className={`${C.card} p-4 flex flex-col items-center justify-center gap-1 hover:border-[#008CFF]/25 transition-all cursor-pointer`}>
                    <p className="text-[24px] font-bold leading-none tabular-nums" style={{ color: m.color }}>
                      {m.val ?? 0}
                    </p>
                    <p className={`text-[9.5px] font-semibold uppercase tracking-[0.1em] mt-1 text-center ${C.t3}`}>
                      {m.lb}
                    </p>
                  </Link>
                ))}
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
