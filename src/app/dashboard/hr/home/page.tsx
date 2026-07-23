"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import LeaveRequestForm, { LeaveRequestKind } from "@/components/LeaveRequestForm";
import ChannelViewsTargetsPanel from "@/components/hr/ChannelViewsTargetsPanel";
import StrikeScoreCard from "@/components/hr/StrikeScoreCard";
import { fetcher } from "@/lib/swr";
import SelectField from "@/components/ui/SelectField";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { parseAttLoc } from "@/lib/attendance-location";
import { isHRAdmin, canApplyRestrictedLeave, canViewAllBrands } from "@/lib/access";
import { isMobileDevice as detectMobileDevice } from "@/lib/is-mobile-device";
import { useClockActions } from "@/lib/hr/use-clock-actions";
import PulseGateModal from "@/components/hr/PulseGateModal";
import ExitSurveyGateModal from "@/components/hr/ExitSurveyGateModal";
import DesktopGateModal from "@/components/hr/DesktopGateModal";
import { isDesktopBypassActive } from "@/lib/desktop-bypass";
import { PageShell } from "@/components/layout";
import { DateField } from "@/components/ui/date-field";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Home as HomeIcon,
  Briefcase,
  Coffee,
  Send,
  BarChart2,
  Award,
  Mail,
  Plus,
  MoreHorizontal,
  ThumbsUp,
  MessageSquare,
  AtSign,
  Image as ImageIcon,
  Smile,
  X,
  Trash2,
  Pencil,
  Link2,
  Check,
  Paperclip,
  Info,
  Star,
  ShieldCheck,
  Lightbulb,
  Search as SearchIcon,
  BookOpen,
  Scissors,
  Users as UsersIcon,
  Sparkles,
  Flame,
  Swords,
  Zap,
  Camera,
  PenTool,
  BarChart3 as BarChart3Icon,
  Rocket,
  MoreVertical,
  SmilePlus,
  Globe,
  Building2,
  CalendarDays,
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  page:    "bg-[#f5f7fb]",
  card:    "bg-white border border-[#e3e9f1] rounded-[3px] shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
  t1:      "text-[#1b2b3c]",
  t2:      "text-[#415a73]",
  t3:      "text-[#6e8499]",
  div:     "border-[#e6ebf2]",
  ring:    "ring-white",
} as const;

// ── Small ring for leave balance ───────────────────────────────────────────────
// Dark-surface variant of the balance ring — used in the navy Leave
// Balances widget. Track is a low-opacity white so it reads on the
// #001529 background; the inner number sits in pure white for contrast.
function DarkBalanceRing({ avail, total, color, size = 70 }: { avail: number; total: number; color: string; size?: number }) {
  const pct = total > 0 ? Math.min((avail / total) * 100, 100) : 0;
  const stroke = Math.max(4, Math.round(size * 0.085));
  const r      = (size / 2) - stroke;
  const circum = 2 * Math.PI * r;
  const numFs  = size <= 56 ? 12 : 14;
  const lblFs  = size <= 56 ? 8  : 9;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          stroke="rgba(255,255,255,0.08)" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circum} strokeDashoffset={circum * (1 - pct / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-bold text-white" style={{ fontSize: numFs }}>{avail}</span>
        <span className="mt-0.5 text-slate-400" style={{ fontSize: lblFs }}>days</span>
      </div>
    </div>
  );
}

function BalanceRing({ avail, total, color, size = 70 }: { avail: number; total: number; color: string; size?: number }) {
  const pct = total > 0 ? Math.min((avail / total) * 100, 100) : 0;
  // Stroke + radius scale with the wrapper so the ring stays proportional
  // at any size we ask for (52, 70, 96, …).
  const stroke = Math.max(4, Math.round(size * 0.085));
  const r      = (size / 2) - stroke;
  const circum = 2 * Math.PI * r;
  const numFs  = size <= 56 ? 12 : 14;
  const lblFs  = size <= 56 ? 8  : 9;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          className="stroke-[#e8ecf0] dark:stroke-[rgba(255,255,255,0.07)]" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circum} strokeDashoffset={circum * (1 - pct / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-bold" style={{ color, fontSize: numFs }}>{avail}</span>
        <span className="mt-0.5 text-[#94a3b8] dark:text-[#4e5e72]" style={{ fontSize: lblFs }}>days</span>
      </div>
    </div>
  );
}

// Countdown ring for the Holidays card. Draining gauge: full when the
// holiday is 90+ days out, emptying as the day nears — a "time remaining"
// read with the day count centred. The "Days To Go" label sits below it.
function HolidayRing({ days, color, numberColor, trackColor, size = 92 }: { days: number; color: string; numberColor?: string; trackColor?: string; size?: number }) {
  const frac   = Math.max(0, Math.min(1, days / 90));
  const stroke = Math.max(5, Math.round(size * 0.075));
  const r      = (size / 2) - stroke;
  const circum = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={trackColor ? undefined : "stroke-slate-200"} style={trackColor ? { stroke: trackColor } : undefined} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circum} strokeDashoffset={circum * (1 - frac)} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-extrabold leading-none tabular-nums" style={{ color: numberColor ?? color, fontSize: Math.round(size * 0.34) }}>{days}</span>
      </div>
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
// Google's CDN (`lh3.googleusercontent.com`) blocks <img> loads that send a
// Referer header — without `referrerPolicy="no-referrer"` the browser shows the
// broken-image icon instead of the photo. The onError fallback covers expired
// or deleted URLs by flipping the img out for the initials chip at runtime.
function Av({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const palette = ["#6366f1","#0891b2","#059669","#d97706","#db2777","#7c3aed","#dc2626"];
  const bg = palette[name.charCodeAt(0) % palette.length];
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className={`rounded-full object-cover ring-2 ${C.ring} shrink-0`}
      />
    );
  }
  return (
    <div style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.33) }}
      className={`rounded-full flex items-center justify-center text-white font-semibold ring-2 ${C.ring} shrink-0`}>
      {initials}
    </div>
  );
}

// Small avatar overlay for the "On Leave Today" tile. Matches the WFH home
// badge's dimensions (14×14, 2px white ring) so the two badges sit at the
// same offset and look consistent across the panel.
//   full         → solid blue circle (full-day leave)
//   first_half   → left half blue   (first-half leave)
//   second_half  → right half blue  (second-half leave)
function LeaveBadge({ kind }: { kind: "full" | "first_half" | "second_half" }) {
  const BLUE = "#008CFF";
  return (
    <span
      aria-label={
        kind === "full" ? "On full-day leave" :
        kind === "first_half" ? "On first-half leave" :
        "On second-half leave"
      }
      title={
        kind === "full" ? "On full-day leave" :
        kind === "first_half" ? "On first-half leave" :
        "On second-half leave"
      }
      className="absolute -top-0.5 -right-0.5 inline-flex h-[14px] w-[14px] items-center justify-center rounded-full border-2 border-white bg-white shadow-sm overflow-hidden"
    >
      <svg viewBox="0 0 10 10" className="w-full h-full">
        {kind === "full"        && <circle cx="5" cy="5" r="5" fill={BLUE} />}
        {kind === "first_half"  && <path d="M 5 0 A 5 5 0 0 0 5 10 Z" fill={BLUE} />}
        {kind === "second_half" && <path d="M 5 0 A 5 5 0 0 1 5 10 Z" fill={BLUE} />}
      </svg>
    </span>
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

// One-line flavour text for the Holidays card. Curated for the common
// Indian-calendar holidays; anything not listed falls back to a sensible
// type-based line so the card never shows a blank description.
const HOLIDAY_DESCRIPTION: Record<string, string> = {
  "independence day":  "A national celebration of freedom and heritage.",
  "republic day":      "Marks the day the Constitution of India came into force.",
  "gandhi jayanti":    "Honouring the birth of Mahatma Gandhi.",
  "diwali":            "The festival of lights.",
  "deepavali":         "The festival of lights.",
  "holi":              "The festival of colours.",
  "raksha bandhan":    "Celebrating the bond between siblings.",
  "dussehra":          "Marking the triumph of good over evil.",
  "vijayadashami":     "Marking the triumph of good over evil.",
  "navratri":          "Nine nights honouring the divine feminine.",
  "janmashtami":       "Celebrating the birth of Lord Krishna.",
  "ganesh chaturthi":  "Honouring Lord Ganesha.",
  "christmas":         "Celebrating the birth of Jesus Christ.",
  "good friday":       "A solemn day in the Christian calendar.",
  "eid":               "Marking a joyous occasion in the Islamic calendar.",
  "eid al-fitr":       "Marking the end of Ramadan.",
  "eid ul-fitr":       "Marking the end of Ramadan.",
  "eid al-adha":       "The festival of sacrifice.",
  "bakrid":            "The festival of sacrifice.",
  "guru nanak jayanti":"Honouring the birth of Guru Nanak.",
  "baisakhi":          "Marking the harvest and the founding of the Khalsa.",
  "lohri":             "A Punjabi harvest festival of bonfires.",
  "makar sankranti":   "Welcoming the harvest and longer days.",
  "pongal":            "A South Indian harvest festival.",
  "onam":              "Kerala's harvest festival of homecoming.",
  "new year":          "Ringing in the new year.",
  "new year's day":    "Ringing in the new year.",
};
function holidayDescription(name: string, type: string): string {
  const hit = HOLIDAY_DESCRIPTION[name.trim().toLowerCase()];
  if (hit) return hit;
  if (type === "optional") return "An optional floater holiday you can choose to take.";
  if (type === "company")  return "A company holiday — our offices stay closed.";
  return "A public holiday — our offices stay closed.";
}
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

  // Avatar tile in the horizontal "upcoming" strip — circle photo on top,
  // name + small date underneath. Matches the Keka birthdays layout.
  const avatarTile = (p: { userId: number; name: string; profilePictureUrl: string | null; dateLabel: string }) => (
    <Link
      key={p.userId}
      href={`/dashboard/hr/people/${p.userId}`}
      className="flex w-[88px] flex-shrink-0 flex-col items-center gap-1 rounded-md py-1 hover:bg-slate-50"
    >
      {p.profilePictureUrl ? (
        <img
          src={p.profilePictureUrl}
          alt={p.name}
          referrerPolicy="no-referrer"
          className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f1fc] text-[14px] font-semibold text-[#0f4e93] ring-2 ring-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]">
          {(p.name || "?").trim().slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className={`mt-0.5 max-w-full truncate text-center text-[11.5px] font-medium ${C.t1}`}>
        {p.name.split(" ")[0]}{p.name.split(" ").length > 1 ? "." : ""}
      </span>
      <span className={`text-center text-[10.5px] ${C.t3}`}>{p.dateLabel}</span>
    </Link>
  );

  // Empty-state illustration: cake + bunting drawn entirely in inline SVG so it
  // matches the muted theme without shipping extra image assets.
  const emptyIllustration = (label: string) => (
    <div className="flex flex-col items-center gap-2 py-6">
      <svg viewBox="0 0 120 80" className="h-16 w-24 text-slate-300">
        {/* bunting */}
        <path d="M 8 14 Q 60 28 112 14" fill="none" stroke="currentColor" strokeWidth="1" />
        {[16, 30, 44, 58, 72, 86, 100].map((x, i) => {
          const y = 14 + Math.abs(60 - x) * -0.18 + 1;
          return <path key={i} d={`M ${x} ${y} l 3 6 l -6 0 z`} fill="currentColor" opacity="0.65" />;
        })}
        {/* cake */}
        <rect x="42" y="55" width="36" height="14" rx="1.5" fill="currentColor" opacity="0.55" />
        <rect x="38" y="60" width="44" height="3" fill="currentColor" opacity="0.4" />
        <rect x="58" y="44" width="4" height="11" fill="currentColor" opacity="0.65" />
        <path d="M 60 38 q -2 3 0 6 q 2 -3 0 -6 z" fill="#ec7e85" opacity="0.85" />
      </svg>
      <p className={`text-[12px] ${C.t3}`}>{label}</p>
    </div>
  );

  const sectionHeader = (label: string) => (
    <p className={`text-[11.5px] font-semibold ${C.t2} mb-2`}>{label}</p>
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

      <div className="px-4 py-4 space-y-4">
        {/* Birthdays */}
        {bTab === "birthday" && (
          <>
            <div>
              {sectionHeader("Birthdays today")}
              {birthdays.today.length === 0
                ? emptyIllustration("No birthdays today.")
                : <div className="flex flex-wrap gap-2">{birthdays.today.map((p: any) => avatarTile(p))}</div>}
            </div>
            <div>
              {sectionHeader("Upcoming Birthdays")}
              {birthdays.upcoming.length === 0
                ? <p className={`text-[12px] ${C.t3}`}>No upcoming birthdays in the next 10 days</p>
                : <div className="flex flex-wrap gap-2">{birthdays.upcoming.map((p: any) => avatarTile(p))}</div>}
            </div>
          </>
        )}

        {/* Work anniversaries */}
        {bTab === "anniversary" && (
          <div>
            {sectionHeader("This week")}
            {anniversaries.thisWeek.length === 0
              ? emptyIllustration("No work anniversaries this week.")
              : <div className="flex flex-wrap gap-2">
                  {anniversaries.thisWeek.map((p: any) => avatarTile({
                    ...p,
                    dateLabel: `${p.dateLabel} · ${p.years} yr${p.years === 1 ? "" : "s"}`,
                  }))}
                </div>}
          </div>
        )}

        {/* New joinees */}
        {bTab === "joinees" && (
          <div>
            {sectionHeader("This month")}
            {newJoinees.thisMonth.length === 0
              ? emptyIllustration("No new joinees this month.")
              : <div className="flex flex-wrap gap-2">{newJoinees.thisMonth.map((p: any) => avatarTile(p))}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function DecorativeTree() {
  return (
    <img
      src="/image_1b069270.png"
      alt=""
      aria-hidden="true"
      className="h-full w-full object-cover object-right select-none"
      draggable={false}
    />
  );
}

// Welcome banner — a compact animated hero spanning both columns. Deep-navy
// gradient base + the on-brand wave art (/public/image_8b71d84b.png), with a
// slow light sheen, a few drifting ambient particles, an animated brand-blue
// accent line, and a time-aware greeting that rises in on mount. Keeps the
// 72px footprint of the old banner. Honours prefers-reduced-motion so the
// motion-sensitive get a clean static version.
// Small brand glyphs for the banner's floating badges (matches the
// careers-page PlayBadges set: YouTube / Instagram / Spotify / Facebook).
function MiniGlyph({ p, size }: { p: string; size: number }) {
  // Crisp vector brand glyphs (accurate paths, render sharp at any DPI).
  if (p === "youtube") return (<svg viewBox="0 0 24 24" width={size} height={size} fill="#fff" aria-hidden shapeRendering="geometricPrecision"><path d="M9.6 7.85v8.3L16.7 12z" /></svg>);
  if (p === "facebook") return (<svg viewBox="0 0 24 24" width={size} height={size} fill="#fff" aria-hidden shapeRendering="geometricPrecision"><path d="M13.45 21v-8.1h2.72l.41-3.16h-3.13V7.72c0-.92.26-1.54 1.57-1.54h1.67V3.35c-.29-.04-1.28-.12-2.44-.12-2.42 0-4.07 1.47-4.07 4.18v2.33H7.46v3.16h2.73V21z" /></svg>);
  if (p === "instagram") { const sw = Math.max(1.8, size * 0.085); return (<svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden shapeRendering="geometricPrecision"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5.2" stroke="#fff" strokeWidth={sw} strokeLinejoin="round" /><circle cx="12" cy="12" r="4.2" stroke="#fff" strokeWidth={sw} /><circle cx="16.9" cy="7.1" r="1.25" fill="#fff" /></svg>); }
  if (p === "premiere") return (<span aria-hidden style={{ fontFamily: "Arial, Helvetica, sans-serif", fontWeight: 800, fontSize: Math.round(size * 0.98), lineHeight: 1, letterSpacing: "-0.5px", color: "#c9b3ff" }}>Pr</span>);
  return (<svg viewBox="0 0 24 24" width={size} height={size} fill="#031b0d" aria-hidden shapeRendering="geometricPrecision"><path d="M17.9 10.9C14.7 9 9.35 8.8 6.3 9.75c-.5.15-1-.15-1.15-.6-.15-.5.15-1 .6-1.15 3.55-1.05 9.4-.85 13.1 1.35.45.25.6.85.35 1.3-.25.35-.85.5-1.3.25z" /><path d="M17.8 13.7c-.25.35-.7.5-1.05.25-2.7-1.65-6.8-2.15-9.95-1.15-.4.1-.85-.1-.95-.5-.1-.4.1-.85.5-.95 3.65-1.1 8.15-.55 11.25 1.35.3.15.45.6.2 1z" /><path d="M16.6 16.45c-.2.3-.55.4-.85.2-2.35-1.45-5.3-1.75-8.8-.95-.35.1-.65-.15-.75-.45-.1-.35.15-.65.45-.75 3.8-.85 7.1-.5 9.7 1.1.35.15.4.55.25.85z" /></svg>);
}

// The floating brand badges. box = badge size in px (YouTube stays smaller
// but is wider via w); the rest are bumped up. Positions/motion are handled
// by FloatingBadges (drift + flee cursor + spring home).
const SOCIAL_BADGES = [
  { p: "youtube",   box: 30, w: 1.35, rot: -8,  rad: "9px", bg: "linear-gradient(180deg,#ff1f1f,#d90000)" },
  { p: "instagram", box: 34, w: 1,    rot: 6,   rad: "50%", bg: "radial-gradient(115% 115% at 25% 110%,#fdc468,#f5733a 25%,#d6249f 55%,#285aeb 100%)" },
  { p: "spotify",   box: 34, w: 1,    rot: 7,   rad: "50%", bg: "linear-gradient(180deg,#1ed760,#0fb84e)" },
  { p: "facebook",  box: 33, w: 1,    rot: -10, rad: "50%", bg: "linear-gradient(180deg,#1877f2,#0e5fcc)" },
  { p: "premiere",  box: 34, w: 1,    rot: 5,   rad: "9px", bg: "linear-gradient(160deg,#4b2a86 0%,#2a0d52 60%,#1b0636 100%)" },
] as const;

// Floating brand badges with a tiny physics loop: they drift continuously
// around the empty (right) part of the banner, bounce off the edges so they
// stay inside, never enter the left text zone, and flee from the mouse cursor
// when it gets close. Honours prefers-reduced-motion (static scatter).
function FloatingBadges() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Array<HTMLSpanElement | null>>([]);
  // Dedicated layer for the shatter particles. They're appended imperatively;
  // keeping them in their OWN node (empty in JSX) means a React re-render of
  // the badges can't reconcile them away.
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof window === "undefined") return;
    const dims = SOCIAL_BADGES.map((b) => ({ w: Math.round(b.box * b.w), h: b.box, rot: b.rot }));
    const N = SOCIAL_BADGES.length;

    let W = host.clientWidth || 900;
    let H = host.clientHeight || 72;
    const measure = () => { W = host.clientWidth || W; H = host.clientHeight || H; };
    measure();
    // Left edge of the play area — keeps badges clear of the greeting/name.
    const leftBound = () => Math.max(W * 0.30, 250);

    // Start already scattered across the empty area (spread x + varied
    // height) so they never appear as a clump.
    const lb0 = leftBound();
    const SLOTX = [0.04, 0.27, 0.50, 0.72, 0.94];
    const SLOTY = [0.16, 0.62, 0.18, 0.64, 0.34];
    // On load: start clustered at the centre of the play area, fired outward
    // toward each home slot, so the spring flings them out in a "grouped →
    // scatter" burst (same reveal as the careers page) before they settle
    // into the continuous float.
    const gx = (lb0 + W) / 2, gy = H / 2;
    const ps = dims.map((d, i) => {
      const homeX = lb0 + Math.max(1, W - lb0 - d.w) * SLOTX[i % SLOTX.length];
      const homeY = 4 + Math.max(1, H - d.h - 8) * SLOTY[i % SLOTY.length];
      const x0 = gx - d.w / 2 + (Math.random() - 0.5) * 14;
      const y0 = gy - d.h / 2 + (Math.random() - 0.5) * 8;
      const ddx = homeX - x0, ddy = homeY - y0, dd = Math.hypot(ddx, ddy) || 1;
      const launch = 2.6;
      return { x: x0, y: y0, vx: (ddx / dd) * launch, vy: (ddy / dd) * launch, ph: Math.random() * Math.PI * 2 };
    });
    nodeRefs.current.forEach((n, i) => {
      if (!n) return;
      n.style.transform = `translate(${ps[i].x}px, ${ps[i].y}px) rotate(${dims[i].rot}deg) scale(0.35)`;
      n.style.opacity = "0";
      requestAnimationFrame(() => { if (n) { n.style.transition = "opacity .45s ease"; n.style.opacity = "1"; } });
    });

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // No burst/float for reduced motion — drop each badge straight onto its
      // scattered home spot.
      nodeRefs.current.forEach((n, i) => {
        if (!n) return;
        const d = dims[i];
        const hx = lb0 + Math.max(1, W - lb0 - d.w) * SLOTX[i % SLOTX.length];
        const hy = 4 + Math.max(1, H - d.h - 8) * SLOTY[i % SLOTY.length];
        n.style.transform = `translate(${hx}px, ${hy}px) rotate(${d.rot}deg)`;
        n.style.opacity = "1";
      });
    }
    const mouse = { x: -9999, y: -9999 };
    const onMove = (e: MouseEvent) => { const r = host.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseout", onLeave, { passive: true });
    window.addEventListener("resize", measure);

    // ── Click to shatter into particles, reassemble after 10s ──────────
    // Clicking a badge bursts it into ~18 colored particles (CSS handles the
    // explode → scatter → implode over 10s); the badge is hidden + frozen
    // (skipped by the physics loop) until the particles converge, then it
    // fades back in. Skipped under reduced motion.
    const shattered = new Array(N).fill(false);
    const timers: number[] = [];
    const PCOLOR: Record<string, string> = {
      youtube: "#ff2b2b", instagram: "#e1306c", spotify: "#1ed760", facebook: "#1877f2", premiere: "#a07bff",
    };
    // Live particles, animated by the rAF loop so they roam the whole banner.
    const particles: Array<{ el: HTMLSpanElement; x: number; y: number; vx: number; vy: number; bi: number; born: number; sz: number }> = [];
    const shatter = (i: number) => {
      if (shattered[i]) return;
      shattered[i] = true;
      const node = nodeRefs.current[i];
      const p = ps[i], d = dims[i];
      const cx = p.x + d.w / 2, cy = p.y + d.h / 2;
      if (node) { node.style.transition = "opacity .12s ease"; node.style.opacity = "0"; }
      const color = PCOLOR[SOCIAL_BADGES[i].p] || "#8a93a6";
      const born = performance.now();
      const NUM = 18;
      for (let k = 0; k < NUM; k++) {
        const el = document.createElement("span");
        el.className = "wb-particle";
        const sz = 5 + Math.random() * 4;
        el.style.width = `${sz}px`; el.style.height = `${sz}px`;
        el.style.background = color; el.style.color = color;
        el.style.transform = `translate(${cx}px, ${cy}px)`;
        (layerRef.current ?? host).appendChild(el);
        const ang = (k / NUM) * Math.PI * 2 + Math.random() * 0.6;
        const sp = 1.8 + Math.random() * 2; // initial burst speed
        particles.push({ el, x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, bi: i, born, sz });
      }
      const t = window.setTimeout(() => {
        for (let q = particles.length - 1; q >= 0; q--) {
          if (particles[q].bi === i) { particles[q].el.remove(); particles.splice(q, 1); }
        }
        if (node) { node.style.transition = "opacity .4s ease"; node.style.opacity = "1"; }
        shattered[i] = false;
      }, 5000);
      timers.push(t);
    };
    // Click directly on an icon shatters it. We hit-test the click against
    // each badge's live rect on WINDOW (not per-node listeners): banner
    // overlays (sheen / content layer) paint over the badges and would
    // otherwise swallow a direct DOM click. A geometric test sidesteps that
    // and still requires the click to land ON an icon (+6px), so empty
    // banner does nothing.
    const onBannerClick = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mx < 0 || my < 0 || mx > r.width || my > r.height) return;
      const pad = 6;
      for (let i = 0; i < N; i++) {
        if (shattered[i]) continue;
        const p = ps[i], d = dims[i];
        if (mx >= p.x - pad && mx <= p.x + d.w + pad && my >= p.y - pad && my <= p.y + d.h + pad) {
          shatter(i);
          break;
        }
      }
    };
    if (!reduce) window.addEventListener("click", onBannerClick);

    let raf = 0;
    let tFrame = 0;
    const R = 175;     // cursor "personal space" — badges flee inside this
    const FORCE = 8;   // repulsion strength — strong, so they're slippery / hard to catch
    const tick = () => {
      tFrame += 1;
      const lb = leftBound();
      // Separation — push any two badges apart when they get close, so they
      // stay scattered instead of clumping into a pile.
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          if (shattered[i] || shattered[j]) continue;
          const a = ps[i], b = ps[j], da = dims[i], db = dims[j];
          const sx = (a.x + da.w / 2) - (b.x + db.w / 2);
          const sy = (a.y + da.h / 2) - (b.y + db.h / 2);
          const sd = Math.hypot(sx, sy) || 0.001;
          const minD = (da.w + db.w) / 2 + 18;
          if (sd < minD) {
            const f = ((minD - sd) / minD) * 0.7;
            const ux = sx / sd, uy = sy / sd;
            a.vx += ux * f; a.vy += uy * f;
            b.vx -= ux * f; b.vy -= uy * f;
          }
        }
      }
      for (let i = 0; i < N; i++) {
        if (shattered[i]) continue; // frozen + hidden while shattered
        const p = ps[i], d = dims[i];
        const cx = p.x + d.w / 2, cy = p.y + d.h / 2;
        const dx = cx - mouse.x, dy = cy - mouse.y;
        const dist2 = dx * dx + dy * dy;
        // Every badge flees the cursor.
        if (dist2 < R * R) {
          const dist = Math.sqrt(dist2) || 0.001;
          const f = ((R - dist) / R) * FORCE;
          p.vx += (dx / dist) * f;
          p.vy += (dy / dist) * f;
        }
        // Continuous float: the home target itself drifts in a slow loop, so
        // each badge perpetually floats around its scattered spot. The cursor
        // repulsion (above) still shoves them off it; they ease back to the
        // (still-moving) home when the cursor leaves.
        const baseX = lb + Math.max(1, W - lb - d.w) * SLOTX[i % SLOTX.length];
        const baseY = 4 + Math.max(1, H - d.h - 8) * SLOTY[i % SLOTY.length];
        const hx = baseX + Math.sin(tFrame * 0.018 + p.ph) * 14;
        const hy = baseY + Math.cos(tFrame * 0.023 + p.ph * 1.4) * 7;
        p.vx += (hx - p.x) * 0.04;
        p.vy += (hy - p.y) * 0.04;
        p.vx *= 0.86; p.vy *= 0.86;
        const sp = Math.hypot(p.vx, p.vy);
        const max = 18; // high cap so they dart away faster than the cursor can chase
        if (sp > max) { p.vx = (p.vx / sp) * max; p.vy = (p.vy / sp) * max; }
        p.x += p.vx; p.y += p.vy;
        const maxX = Math.max(lb, W - d.w - 2);
        if (p.x < lb) { p.x = lb; p.vx = Math.abs(p.vx); }
        if (p.x > maxX) { p.x = maxX; p.vx = -Math.abs(p.vx); }
        const maxY = Math.max(2, H - d.h - 2);
        if (p.y < 2) { p.y = 2; p.vy = Math.abs(p.vy); }
        if (p.y > maxY) { p.y = maxY; p.vy = -Math.abs(p.vy); }
        // Entrance scale-up — staggered per badge so they pop out of the
        // group one after another, then hold at full size.
        const e = Math.min(1, Math.max(0, (tFrame - i * 5) / 24));
        const scale = 0.35 + 0.65 * (e * (2 - e));
        const n = nodeRefs.current[i];
        if (n) n.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${d.rot}deg) scale(${scale})`;
      }
      // Shatter particles — wander + bounce off ALL banner edges so they roam
      // the whole banner, then (last ~1.2s) converge to their badge centre so
      // it reforms cleanly. Fade in on spawn, fade out near the end.
      if (particles.length) {
        const now = performance.now();
        for (const pt of particles) {
          const elapsed = now - pt.born;
          if (elapsed > 3800) {
            const dd = dims[pt.bi];
            const tx = ps[pt.bi].x + dd.w / 2, ty = ps[pt.bi].y + dd.h / 2;
            pt.vx += (tx - pt.x) * 0.1; pt.vy += (ty - pt.y) * 0.1;
            pt.vx *= 0.8; pt.vy *= 0.8;
          } else {
            pt.vx += (Math.random() - 0.5) * 0.18; pt.vy += (Math.random() - 0.5) * 0.18;
            pt.vx *= 0.985; pt.vy *= 0.985;
            const s = Math.hypot(pt.vx, pt.vy); if (s > 2.4) { pt.vx = (pt.vx / s) * 2.4; pt.vy = (pt.vy / s) * 2.4; }
          }
          pt.x += pt.vx; pt.y += pt.vy;
          if (pt.x < 2) { pt.x = 2; pt.vx = Math.abs(pt.vx); }
          if (pt.x > W - pt.sz - 2) { pt.x = W - pt.sz - 2; pt.vx = -Math.abs(pt.vx); }
          if (pt.y < 2) { pt.y = 2; pt.vy = Math.abs(pt.vy); }
          if (pt.y > H - pt.sz - 2) { pt.y = H - pt.sz - 2; pt.vy = -Math.abs(pt.vy); }
          const op = elapsed < 150 ? elapsed / 150 : elapsed > 4600 ? Math.max(0, (5000 - elapsed) / 400) : 1;
          pt.el.style.opacity = String(op);
          pt.el.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
        }
      }
      if (!reduce) raf = requestAnimationFrame(tick);
    };
    if (!reduce) raf = requestAnimationFrame(tick);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onLeave);
      window.removeEventListener("resize", measure);
      timers.forEach((t) => clearTimeout(t));
      window.removeEventListener("click", onBannerClick);
      (layerRef.current ?? host).querySelectorAll(".wb-particle").forEach((el) => el.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <style>{`
        .wb-particle{position:absolute;left:0;top:0;border-radius:9999px;pointer-events:none;opacity:0;
          will-change:transform,opacity;box-shadow:0 0 7px currentColor}
        @media (prefers-reduced-motion:reduce){ .wb-particle{display:none} }
      `}</style>
      {SOCIAL_BADGES.map((b, i) => (
        <span
          key={i}
          ref={(el) => { nodeRefs.current[i] = el; }}
          className="absolute left-0 top-0 inline-flex items-center justify-center"
          style={{
            width: Math.round(b.box * b.w),
            height: b.box,
            borderRadius: b.rad,
            background: b.bg,
            boxShadow: "0 6px 14px -5px rgba(15,23,42,0.4), inset 0 1px 0 rgba(255,255,255,0.4)",
            opacity: 0,
            willChange: "transform",
            pointerEvents: "auto",
            cursor: "pointer",
          }}
        >
          <MiniGlyph p={b.p} size={Math.round(b.box * 0.62)} />
        </span>
      ))}
      {/* Shatter particles are appended here imperatively (kept out of the
          badge list so React re-renders don't remove them). */}
      <div ref={layerRef} className="pointer-events-none absolute inset-0" aria-hidden />
    </div>
  );
}

function WelcomeBanner({ name }: { name?: string | null }) {
  const [greeting, setGreeting] = useState("Good morning");
  // Gate the entrance animation until after mount so it plays on the REAL
  // greeting (computed client-side) instead of starting on the placeholder
  // and swapping mid-animation — that swap was the "not smooth" reload.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
    setMounted(true);
  }, []);
  const words = (name || "back").trim().split(/\s+/);
  return (
    <section className="relative hidden h-[72px] w-full max-w-[1120px] overflow-hidden rounded-[10px] border border-slate-200/80 shadow-[0_2px_10px_rgba(15,23,42,0.06)] xl:col-span-2 xl:block">
      {/* Premium light mesh gradient — soft brand-blue / cyan / periwinkle
          blooms blended into a near-white base. Clean and airy (blends with
          the dashboard's white cards), with depth from the layered radials
          rather than a flat wash. */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(75% 160% at 12% 4%, rgba(0,140,255,0.16), transparent 58%)," +
            "radial-gradient(60% 150% at 97% -10%, rgba(45,196,247,0.16), transparent 55%)," +
            "radial-gradient(65% 150% at 82% 128%, rgba(124,108,255,0.14), transparent 60%)," +
            "linear-gradient(120deg, #f7faff 0%, #eef4ff 55%, #e9f0fe 100%)",
        }}
      />
      {/* glassy top sheen for a subtle premium highlight */}
      <div className="absolute inset-x-0 top-0 h-1/2" aria-hidden style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0))" }} />
      {/* floating brand badges — drift around the empty space + flee the cursor */}
      <FloatingBadges />
      {/* content — greeting fades in, then the name reveals word-by-word
          (same WordReveal feel as the careers hero). */}
      <div className="relative flex h-full items-center px-8">
        <div>
          <p
            className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${mounted ? "wb-greet" : ""}`}
            style={{ color: "#1f6fd0", WebkitTextFillColor: "#1f6fd0", opacity: mounted ? undefined : 0 }}
          >
            {greeting}
          </p>
          <p className="mt-1 text-[19px] font-bold leading-none tracking-[-0.01em]" style={{ color: "#0f2747", WebkitTextFillColor: "#0f2747" }}>
            {words.map((w, i) => (
              <span
                key={i}
                className={mounted ? "wb-word" : ""}
                style={{ display: "inline-block", animationDelay: `${0.1 + i * 0.12}s`, marginRight: i < words.length - 1 ? "0.28em" : 0, opacity: mounted ? undefined : 0 }}
              >
                {w}
              </span>
            ))}
          </p>
        </div>
      </div>
      {/* thin brand accent line — draws in from the left once, then static */}
      <div
        className="wb-line absolute inset-x-0 bottom-0 h-[2px]"
        aria-hidden
        style={{ background: "linear-gradient(90deg,#008CFF 0%,#38bdf8 55%,rgba(56,189,248,0) 100%)", transformOrigin: "left" }}
      />
      <style>{`
        .wb-greet{animation:wbIn .55s cubic-bezier(.2,.7,.2,1) .05s both}
        .wb-word{display:inline-block;animation:wbWord .6s cubic-bezier(.2,.7,.2,1) both}
        .wb-line{animation:wbLine .7s cubic-bezier(.2,.7,.2,1) .3s both}
        @keyframes wbIn{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes wbWord{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes wbLine{0%{transform:scaleX(0);opacity:0}100%{transform:scaleX(1);opacity:1}}
        @media (prefers-reduced-motion:reduce){
          .wb-greet,.wb-word,.wb-line{animation:none!important}
        }
      `}</style>
    </section>
  );
}

// ── Holiday banner themes ────────────────────────────────────────────────
// Each scene paints a small SVG decoration along the bottom of the green
// card. Combined with a per-theme background gradient, this gives every
// holiday a recognizable visual identity. Picked from the holiday name via
// `pickHolidayTheme` (case-insensitive word match) — falls back to the
// rolling-hills default for anything unmatched.
const SCENE_CLS = "pointer-events-none absolute inset-x-0 bottom-0 h-[62px] w-full";

function HillsScene() {
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g fill="rgba(43,94,34,0.35)">
        <rect x="0" y="76" width="340" height="12" />
        <path d="M0 76 C32 61 59 59 88 71 C112 49 143 47 173 69 C196 56 213 54 232 65 C257 43 287 42 340 76Z" />
        <rect x="44" y="48" width="8" height="28" />
        <path d="M48 48 C38 53 37 69 48 72 C58 69 58 54 48 48Z" />
        <rect x="114" y="44" width="8" height="32" />
        <path d="M118 44 C104 48 102 69 118 72 C133 69 132 48 118 44Z" />
        <rect x="210" y="42" width="8" height="34" />
        <path d="M214 42 C201 47 199 70 214 72 C229 69 227 46 214 42Z" />
        <rect x="274" y="46" width="8" height="30" />
        <path d="M278 46 C266 51 264 68 278 72 C291 68 290 50 278 46Z" />
      </g>
    </svg>
  );
}

function ChristmasScene() {
  // Snowy ground + 3 fir trees + falling snowflakes.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g fill="rgba(255,255,255,0.7)">
        <circle cx="40"  cy="20" r="1.4" />
        <circle cx="120" cy="14" r="1.2" />
        <circle cx="220" cy="22" r="1.6" />
        <circle cx="290" cy="12" r="1.2" />
        <circle cx="160" cy="10" r="1.0" />
      </g>
      <path d="M0 78 C40 70 80 72 120 76 C170 70 220 72 260 78 C300 74 320 76 340 78 L340 88 L0 88 Z"
            fill="rgba(255,255,255,0.45)" />
      {[ {x: 60, h: 0}, {x: 170, h: 8}, {x: 280, h: 4} ].map((t) => (
        <g key={t.x} fill="rgba(255,255,255,0.55)">
          <polygon points={`${t.x},${40 - t.h} ${t.x - 11},${60 - t.h} ${t.x + 11},${60 - t.h}`} />
          <polygon points={`${t.x},${52 - t.h} ${t.x - 13},${74 - t.h} ${t.x + 13},${74 - t.h}`} />
          <rect x={t.x - 3} y={74 - t.h} width="6" height="6" fill="rgba(120,60,20,0.5)" />
        </g>
      ))}
    </svg>
  );
}

function DiwaliScene() {
  // Glowing fireworks halos + a row of diyas (oil lamps).
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g fill="rgba(255,225,140,0.30)">
        <circle cx="60"  cy="20" r="9" />
        <circle cx="170" cy="14" r="7" />
        <circle cx="280" cy="22" r="10" />
      </g>
      <rect x="0" y="74" width="340" height="14" fill="rgba(50,15,40,0.35)" />
      {[50, 120, 190, 260].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="74" rx="11" ry="4" fill="rgba(60,20,20,0.6)" />
          <ellipse cx={cx} cy="68" rx="3"  ry="6" fill="rgba(255,210,90,0.95)" />
          <ellipse cx={cx} cy="65" rx="1.4" ry="2.5" fill="rgba(255,255,255,0.7)" />
        </g>
      ))}
    </svg>
  );
}

function EidScene() {
  // Mosque silhouette with a central dome, two minarets, and a crescent moon.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g>
        <circle cx="290" cy="22" r="10"  fill="rgba(255,255,255,0.85)" />
        <circle cx="294" cy="20" r="8.5" fill="rgba(45,108,37,1)" />
      </g>
      <g fill="rgba(20,60,30,0.45)">
        <rect x="0" y="78" width="340" height="10" />
        <rect x="60"  y="44" width="4" height="34" />
        <circle cx="62"  cy="42" r="3" />
        <rect x="276" y="44" width="4" height="34" />
        <circle cx="278" cy="42" r="3" />
        <rect x="100" y="58" width="140" height="20" />
        <path d="M120 58 Q170 28 220 58 Z" />
        <rect x="166" y="22" width="2" height="10" />
        <circle cx="167" cy="22" r="2" />
      </g>
    </svg>
  );
}

function HoliScene() {
  // Multi-colored powder splashes scattered across the card.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <circle cx="30"  cy="30" r="14" fill="rgba(255,200,80,0.55)" />
      <circle cx="80"  cy="20" r="10" fill="rgba(255,100,180,0.55)" />
      <circle cx="160" cy="34" r="16" fill="rgba(80,200,255,0.5)" />
      <circle cx="240" cy="22" r="11" fill="rgba(180,80,255,0.55)" />
      <circle cx="300" cy="32" r="13" fill="rgba(80,255,150,0.55)" />
      <circle cx="200" cy="50" r="9"  fill="rgba(255,180,80,0.55)" />
      <circle cx="50"  cy="60" r="8"  fill="rgba(255,100,180,0.55)" />
      <circle cx="320" cy="60" r="10" fill="rgba(80,200,255,0.5)" />
      <rect x="0" y="78" width="340" height="10" fill="rgba(120,40,80,0.35)" />
    </svg>
  );
}

function TricolorScene() {
  // Indian flag silhouette: pole + saffron/white/green stripes + Ashoka chakra.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <rect x="170" y="20" width="2"  height="58" fill="rgba(80,80,80,0.55)" />
      <rect x="172" y="22" width="60" height="10" fill="rgba(255,153,51,0.85)" />
      <rect x="172" y="32" width="60" height="10" fill="rgba(255,255,255,0.92)" />
      <rect x="172" y="42" width="60" height="10" fill="rgba(19,136,8,0.85)" />
      <circle cx="202" cy="37" r="3.4" fill="none" stroke="rgba(0,0,128,0.7)" strokeWidth="0.9" />
      <rect x="0" y="78" width="340" height="10" fill="rgba(60,60,60,0.35)" />
    </svg>
  );
}

function NewYearScene() {
  // City skyline at night with three firework bursts in the sky.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      {[
        { x: 60,  c: "rgba(255,200,80,0.75)" },
        { x: 170, c: "rgba(255,100,180,0.75)" },
        { x: 280, c: "rgba(80,200,255,0.75)" },
      ].map((b) => (
        <g key={b.x} stroke={b.c} strokeWidth="1" strokeLinecap="round">
          <line x1={b.x}     y1="14" x2={b.x}     y2="34" />
          <line x1={b.x - 10} y1="24" x2={b.x + 10} y2="24" />
          <line x1={b.x - 8}  y1="16" x2={b.x + 8}  y2="32" />
          <line x1={b.x + 8}  y1="16" x2={b.x - 8}  y2="32" />
        </g>
      ))}
      <g fill="rgba(0,0,30,0.4)">
        <rect x="0"   y="62" width="340" height="26" />
        <rect x="40"  y="48" width="20"  height="20" />
        <rect x="100" y="42" width="24"  height="26" />
        <rect x="150" y="50" width="20"  height="18" />
        <rect x="200" y="44" width="22"  height="24" />
        <rect x="260" y="46" width="20"  height="22" />
      </g>
    </svg>
  );
}

function KrishnaScene() {
  // Hanging matki (pot) with a flute and a peacock-feather hint.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <line x1="170" y1="0" x2="170" y2="40" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
      <g>
        <ellipse cx="170" cy="52" rx="20" ry="14" fill="rgba(255,200,40,0.55)" />
        <rect x="160"  y="40" width="20" height="6" fill="rgba(255,180,40,0.55)" />
        <ellipse cx="170" cy="40" rx="10" ry="2.5" fill="rgba(60,30,10,0.5)" />
      </g>
      <g stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" fill="none">
        <path d="M156 60 Q160 70 156 80" />
        <path d="M180 60 Q184 70 184 80" />
        <path d="M170 64 Q172 74 172 84" />
      </g>
      <g fill="rgba(80,180,200,0.55)">
        <ellipse cx="40" cy="40" rx="3" ry="9" />
        <ellipse cx="40" cy="38" rx="1.5" ry="3" fill="rgba(255,200,40,0.85)" />
      </g>
      <rect x="0" y="78" width="340" height="10" fill="rgba(0,30,80,0.45)" />
    </svg>
  );
}

function FestiveScene() {
  // Generic Hindu-festive scene: sun rays + a row of marigold-style dots.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g stroke="rgba(255,230,150,0.45)" strokeWidth="1" strokeLinecap="round">
        {[0, 30, 60, 90, 120, 150, 180].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 170, y1 = 78;
          const x2 = 170 + Math.cos(Math.PI + rad) * 32;
          const y2 = 78  + Math.sin(Math.PI + rad) * 32;
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      <circle cx="170" cy="78" r="14" fill="rgba(255,200,80,0.55)" />
      <g fill="rgba(255,150,80,0.6)">
        {[20, 60, 100, 220, 260, 300, 320].map((cx) => (
          <circle key={cx} cx={cx} cy="80" r="4" />
        ))}
      </g>
      <rect x="0" y="84" width="340" height="4" fill="rgba(120,40,30,0.35)" />
    </svg>
  );
}

function GoodFridayScene() {
  // Restrained scene with a small cross silhouette + faded sky line.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <rect x="167" y="32" width="6"  height="46" fill="rgba(255,255,255,0.5)" />
      <rect x="155" y="44" width="30" height="6"  fill="rgba(255,255,255,0.5)" />
      <line x1="0" y1="14" x2="340" y2="14" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />
      <rect x="0" y="78" width="340" height="10" fill="rgba(40,30,60,0.4)" />
    </svg>
  );
}

function RakhiScene() {
  // Rakhi medallion with thread streamers + a small gift box on the right.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      {/* Faded mandala on left */}
      <g transform="translate(36, 36)" fill="rgba(255,255,255,0.16)">
        {[0,45,90,135,180,225,270,315].map((deg) => (
          <ellipse key={deg} cx="0" cy="-12" rx="3.5" ry="11" transform={`rotate(${deg})`} />
        ))}
        <circle r="4" />
      </g>
      {/* Thread streamers + central rakhi */}
      <g>
        <path d="M 6 44 Q 80 30 148 44"  fill="none" stroke="rgba(255,200,80,0.75)" strokeWidth="2" />
        <path d="M 6 50 Q 80 36 148 50"  fill="none" stroke="rgba(255,160,80,0.6)"  strokeWidth="1.5" />
        <path d="M 192 44 Q 260 30 334 44" fill="none" stroke="rgba(255,200,80,0.75)" strokeWidth="2" />
        <path d="M 192 50 Q 260 36 334 50" fill="none" stroke="rgba(255,160,80,0.6)"  strokeWidth="1.5" />
      </g>
      <g transform="translate(170, 46)">
        <circle r="22" fill="rgba(255,180,100,0.85)" />
        <circle r="16" fill="rgba(255,130,80,0.95)" />
        <circle r="9"  fill="rgba(255,230,180,0.95)" />
        {[0,45,90,135,180,225,270,315].map((deg) => {
          const rad = deg * Math.PI / 180;
          return <circle key={deg} cx={20*Math.cos(rad)} cy={20*Math.sin(rad)} r="2.5" fill="rgba(255,255,255,0.92)" />;
        })}
      </g>
      {/* Gift box on the right */}
      <g transform="translate(296, 60)">
        <rect x="-16" y="-2" width="32" height="22" rx="1" fill="rgba(255,200,100,0.85)" />
        <rect x="-16" y="-8" width="32" height="6"  rx="1" fill="rgba(255,170,60,0.95)" />
        <rect x="-2"  y="-8" width="4"  height="28"        fill="rgba(180,70,40,0.8)" />
        <path d="M -10 -10 Q -2 -18 0 -8 Q 2 -18 10 -10 Q 4 -8 0 -8 Q -4 -8 -10 -10 Z" fill="rgba(180,70,40,0.9)" />
      </g>
      <rect x="0" y="80" width="340" height="8" fill="rgba(80,30,90,0.4)" />
    </svg>
  );
}

function LotusScene() {
  // Lotus blossom centred over a calm water line.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <line x1="0"  y1="68" x2="340" y2="68" stroke="rgba(255,255,255,0.25)" strokeWidth="0.6" />
      <line x1="0"  y1="74" x2="340" y2="74" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />
      <g transform="translate(170, 56)">
        {[0, 36, 72, 108, 144, 180, 216, 252, 288, 324].map((deg) => (
          <ellipse key={`o-${deg}`} cx="0" cy="-22" rx="6" ry="22"
            fill="rgba(255,255,255,0.4)"
            transform={`rotate(${deg})`} />
        ))}
        {[18, 54, 90, 126, 162, 198, 234, 270, 306, 342].map((deg) => (
          <ellipse key={`i-${deg}`} cx="0" cy="-12" rx="5" ry="14"
            fill="rgba(255,255,255,0.65)"
            transform={`rotate(${deg})`} />
        ))}
        <circle r="6" fill="rgba(255,225,140,0.95)" />
      </g>
      <rect x="0" y="80" width="340" height="8" fill="rgba(120,90,30,0.4)" />
    </svg>
  );
}

function TrishulScene() {
  // Trident silhouette with a small mountain skyline.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g fill="rgba(40,40,80,0.45)">
        <path d="M 0 78 L 60 50 L 110 70 L 170 40 L 230 70 L 290 52 L 340 78 Z" />
      </g>
      <g transform="translate(170, 46)" stroke="rgba(255,255,255,0.85)" fill="rgba(255,255,255,0.85)" strokeLinecap="round">
        <line x1="0" y1="-8" x2="0" y2="-30" strokeWidth="2.4" />
        <polygon points="-4,-30 0,-44 4,-30" stroke="none" />
        <line x1="-16" y1="-6" x2="-16" y2="-20" strokeWidth="1.8" />
        <polygon points="-20,-20 -16,-30 -12,-20" stroke="none" />
        <line x1="16" y1="-6" x2="16" y2="-20" strokeWidth="1.8" />
        <polygon points="12,-20 16,-30 20,-20" stroke="none" />
        <line x1="-20" y1="-6" x2="20" y2="-6" strokeWidth="2.6" />
        <line x1="0" y1="-6" x2="0" y2="34" strokeWidth="2.4" />
        <ellipse cx="0" cy="2" rx="6" ry="2" stroke="none" />
      </g>
      <rect x="0" y="80" width="340" height="8" fill="rgba(20,20,40,0.45)" />
    </svg>
  );
}

function SunScene() {
  // Rising sun over a small harvest band — Pongal / Sankranti / Lohri.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g stroke="rgba(255,230,150,0.7)" strokeWidth="1.2" strokeLinecap="round">
        {[0, 22, 45, 67, 90, 112, 135, 157, 180].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 170 + 28 * Math.cos(Math.PI + rad);
          const y1 = 78 + 28 * Math.sin(Math.PI + rad);
          const x2 = 170 + 44 * Math.cos(Math.PI + rad);
          const y2 = 78 + 44 * Math.sin(Math.PI + rad);
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      <circle cx="170" cy="78" r="22" fill="rgba(255,210,100,0.85)" />
      <circle cx="170" cy="78" r="14" fill="rgba(255,235,160,0.95)" />
      {/* Wheat tufts */}
      <g stroke="rgba(255,200,80,0.7)" strokeWidth="0.8" fill="none">
        {[40, 70, 100, 240, 270, 300].map((cx) => (
          <g key={cx}>
            <line x1={cx} y1="80" x2={cx} y2="58" />
            <line x1={cx} y1="64" x2={cx - 4} y2="60" />
            <line x1={cx} y1="64" x2={cx + 4} y2="60" />
            <line x1={cx} y1="70" x2={cx - 4} y2="66" />
            <line x1={cx} y1="70" x2={cx + 4} y2="66" />
          </g>
        ))}
      </g>
      <rect x="0" y="80" width="340" height="8" fill="rgba(110,60,20,0.4)" />
    </svg>
  );
}

function KhandaScene() {
  // Khanda emblem (Sikh) — central sword + chakra + crescent crossing.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g transform="translate(170, 46)" stroke="rgba(255,255,255,0.85)" fill="rgba(255,255,255,0.85)">
        {/* Centre double-edged sword */}
        <line x1="0" y1="-30" x2="0" y2="34" strokeWidth="2.5" />
        <polygon points="-4,-30 0,-44 4,-30" stroke="none" />
        <ellipse cx="0" cy="6" rx="6" ry="2" stroke="none" />
        {/* Outer crescents */}
        <path d="M -28 4 Q -28 -22 0 -28" fill="none" strokeWidth="2.2" />
        <path d="M  28 4 Q  28 -22 0 -28" fill="none" strokeWidth="2.2" />
        {/* Inner single-edged daggers */}
        <line x1="-14" y1="-22" x2="-14" y2="6" strokeWidth="1.8" />
        <polygon points="-17,-22 -14,-32 -11,-22" stroke="none" />
        <line x1="14" y1="-22" x2="14" y2="6" strokeWidth="1.8" />
        <polygon points="11,-22 14,-32 17,-22" stroke="none" />
        {/* Chakra ring */}
        <circle r="14" fill="none" strokeWidth="2.4" />
      </g>
      <rect x="0" y="80" width="340" height="8" fill="rgba(80,30,30,0.45)" />
    </svg>
  );
}

function GaneshScene() {
  // Stylised Om (Aum) with a soft halo + decorative band.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g transform="translate(170, 44)">
        <circle r="28" fill="rgba(255,225,140,0.18)" />
        <g fill="none" stroke="rgba(255,225,140,0.95)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M -28 0 C -28 -14 -10 -18 0 -10 C 10 0 6 12 -8 12 L -12 12" />
          <path d="M -8 12 C -22 12 -28 24 -10 32 C 6 36 18 28 14 12 L 14 6" />
          <path d="M 14 0 C 18 -6 28 0 28 8" />
          <path d="M 18 -22 Q 24 -28 30 -22" strokeWidth="1.8" />
        </g>
        <circle cx="30" cy="-18" r="3" fill="rgba(255,225,140,0.95)" />
      </g>
      {/* Marigold dots along the bottom */}
      <g fill="rgba(255,150,80,0.7)">
        {[20, 60, 100, 240, 280, 320].map((cx) => (
          <circle key={cx} cx={cx} cy="80" r="3.5" />
        ))}
      </g>
      <rect x="0" y="84" width="340" height="4" fill="rgba(120,40,30,0.4)" />
    </svg>
  );
}

function OnamScene() {
  // Pookalam — concentric floral rings rising from the bottom edge.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g transform="translate(170, 88)">
        <circle r="42" fill="rgba(255,150,80,0.4)" />
        <circle r="34" fill="rgba(255,200,80,0.5)" />
        <circle r="26" fill="rgba(255,255,255,0.55)" />
        <circle r="18" fill="rgba(255,150,80,0.65)" />
        <circle r="10" fill="rgba(255,225,140,0.95)" />
        {/* Petals */}
        {[200,220,240,260,280,300,320,340,200-360,220-360,240-360,260-360,280-360,300-360,320-360,340-360].slice(0, 8).map((deg) => {
          const rad = deg * Math.PI / 180;
          return <ellipse key={deg} cx={28*Math.cos(rad)} cy={28*Math.sin(rad)} rx="5" ry="3" fill="rgba(255,255,255,0.6)" transform={`rotate(${deg+90} ${28*Math.cos(rad)} ${28*Math.sin(rad)})`} />;
        })}
      </g>
      {/* Side dotted petals */}
      <g fill="rgba(255,180,80,0.55)">
        <circle cx="60" cy="68" r="3" />
        <circle cx="80" cy="56" r="2.5" />
        <circle cx="280" cy="68" r="3" />
        <circle cx="260" cy="56" r="2.5" />
      </g>
    </svg>
  );
}

function BowScene() {
  // Bow & arrow — Ram Navami / Dussehra.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g fill="rgba(60,30,10,0.5)">
        <rect x="0" y="80" width="340" height="8" />
      </g>
      <g transform="translate(170, 44)" stroke="rgba(255,255,255,0.9)" fill="none" strokeLinecap="round">
        <path d="M -50 -28 Q 30 0 -50 28" strokeWidth="2.6" />
        <line x1="-50" y1="-28" x2="-50" y2="28" strokeWidth="1" />
        <line x1="-50" y1="0" x2="60" y2="0" strokeWidth="2.2" />
        <polygon points="60,0 50,-5 50,5" fill="rgba(255,255,255,0.9)" stroke="none" />
        <line x1="-44" y1="0" x2="-38" y2="-6" strokeWidth="1.6" />
        <line x1="-44" y1="0" x2="-38" y2="6"  strokeWidth="1.6" />
      </g>
    </svg>
  );
}

function MuharramScene() {
  // Restrained — crescent + horizon line.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      {[40, 80, 120, 220, 260].map((x, i) => (
        <circle key={i} cx={x} cy={6 + (i % 3) * 4} r="0.8" fill="rgba(255,255,255,0.6)" />
      ))}
      <g>
        <circle cx="170" cy="36" r="22" fill="rgba(255,255,255,0.85)" />
        <circle cx="178" cy="32" r="20" fill="rgba(40,40,90,1)" />
      </g>
      <line x1="0" y1="62" x2="340" y2="62" stroke="rgba(255,255,255,0.2)" strokeWidth="0.6" />
      <rect x="0" y="80" width="340" height="8" fill="rgba(20,20,50,0.55)" />
    </svg>
  );
}

type HolidayTheme = {
  bg: string;
  border: string;
  scene: React.ReactNode;
  badge?: string; // optional override for badge background
};

const HOLIDAY_THEMES: Record<string, HolidayTheme> = {
  christmas:   { bg: "linear-gradient(180deg, #d4453a 0%, #6f1818 100%)", border: "#9b2222", scene: <ChristmasScene />,   badge: "#0a8a3a" },
  diwali:      { bg: "linear-gradient(180deg, #f29a35 0%, #5a1a55 100%)", border: "#a04060", scene: <DiwaliScene />,      badge: "#ffb84d" },
  eid:         { bg: "linear-gradient(180deg, #6cb454 0%, #2d6c25 100%)", border: "#1d5a28", scene: <EidScene />,         badge: "#0e6a2a" },
  holi:        { bg: "linear-gradient(180deg, #ff6f9c 0%, #5a2078 100%)", border: "#a04080", scene: <HoliScene />,        badge: "#7a1f6e" },
  tricolor:    { bg: "linear-gradient(180deg, #4fb6d8 0%, #2c7da3 100%)", border: "#1e6a8a", scene: <TricolorScene />,    badge: "#000080" },
  newyear:     { bg: "linear-gradient(180deg, #1e2a78 0%, #050828 100%)", border: "#1e2a78", scene: <NewYearScene />,     badge: "#ffb84d" },
  krishna:     { bg: "linear-gradient(180deg, #1e63b8 0%, #08234a 100%)", border: "#1e4ea0", scene: <KrishnaScene />,     badge: "#ffb84d" },
  festive:     { bg: "linear-gradient(180deg, #e87a3a 0%, #8a2a16 100%)", border: "#aa4422", scene: <FestiveScene />,     badge: "#a82c12" },
  goodfriday:  { bg: "linear-gradient(180deg, #5b4783 0%, #1c1233 100%)", border: "#3b2c5e", scene: <GoodFridayScene />,  badge: "#3b2c5e" },
  rakhi:       { bg: "linear-gradient(180deg, #8a4a9e 0%, #3d1a55 100%)", border: "#6a3380", scene: <RakhiScene />,       badge: "#0a8aff" },
  lotus:       { bg: "linear-gradient(180deg, #e0a35e 0%, #7a4a1e 100%)", border: "#aa6a2a", scene: <LotusScene />,       badge: "#ffd770" },
  trishul:     { bg: "linear-gradient(180deg, #4a6a8e 0%, #1a2a4a 100%)", border: "#2a3a5a", scene: <TrishulScene />,     badge: "#ffd770" },
  sun:         { bg: "linear-gradient(180deg, #f4a83a 0%, #a04a14 100%)", border: "#c46422", scene: <SunScene />,         badge: "#ffe1a0" },
  khanda:      { bg: "linear-gradient(180deg, #b86846 0%, #5a2014 100%)", border: "#7a3424", scene: <KhandaScene />,      badge: "#ffe1a0" },
  ganesh:      { bg: "linear-gradient(180deg, #d46c3a 0%, #6a1a14 100%)", border: "#a04022", scene: <GaneshScene />,      badge: "#ffe1a0" },
  onam:        { bg: "linear-gradient(180deg, #58a04a 0%, #1d5a28 100%)", border: "#3a7030", scene: <OnamScene />,        badge: "#ffd770" },
  bow:         { bg: "linear-gradient(180deg, #d6884a 0%, #6a2a12 100%)", border: "#a04830", scene: <BowScene />,         badge: "#ffe1a0" },
  muharram:    { bg: "linear-gradient(180deg, #404a6a 0%, #14182a 100%)", border: "#2a304a", scene: <MuharramScene />,    badge: "#aabad5" },
  default:     { bg: "linear-gradient(180deg, #83c863 0%, #5da83e 100%)", border: "#3a7030", scene: <HillsScene />,                            },
};

// Pick a theme based on the holiday name. Word-boundary matches keep us
// from confusing "Holi" with the literal word "holiday" or matching
// "Eid" inside something unrelated.
function pickHolidayTheme(name: string | null | undefined): HolidayTheme {
  const n = (name || "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(n));
  if (has("christmas", "xmas"))                                      return HOLIDAY_THEMES.christmas;
  if (has("diwali", "deepavali", "govardhan", "bhai dooj"))          return HOLIDAY_THEMES.diwali;
  if (has("eid", "bakrid", "ramadan", "ramzan"))                     return HOLIDAY_THEMES.eid;
  if (has("muharram"))                                               return HOLIDAY_THEMES.muharram;
  if (has("holi") && !has("holiday"))                                return HOLIDAY_THEMES.holi;
  if (has("independence day", "republic day", "gandhi jayanti", "ambedkar")) return HOLIDAY_THEMES.tricolor;
  if (has("labour day"))                                             return HOLIDAY_THEMES.tricolor;
  if (has("new year"))                                               return HOLIDAY_THEMES.newyear;
  if (has("janmashtami", "krishna"))                                 return HOLIDAY_THEMES.krishna;
  if (has("ram navami", "ramanavami", "dussehra", "vijayadashami"))  return HOLIDAY_THEMES.bow;
  if (has("good friday", "easter"))                                  return HOLIDAY_THEMES.goodfriday;
  if (has("raksha bandhan", "rakhi"))                                return HOLIDAY_THEMES.rakhi;
  if (has("buddha", "purnima", "mahavir"))                           return HOLIDAY_THEMES.lotus;
  if (has("shivratri", "shiva"))                                     return HOLIDAY_THEMES.trishul;
  if (has("pongal", "sankranti", "lohri"))                           return HOLIDAY_THEMES.sun;
  if (has("guru nanak", "gurpurab", "gurpurb"))                      return HOLIDAY_THEMES.khanda;
  if (has("ganesh", "ganpati"))                                      return HOLIDAY_THEMES.ganesh;
  if (has("onam"))                                                   return HOLIDAY_THEMES.onam;
  return HOLIDAY_THEMES.default;
}

// Per-event glyph that floats on the right side of the holiday card. Returns
// a tuple of [emoji, accent-color] used for the big medallion. Picked from
// the holiday name with the same word-boundary matching as the theme.
function pickHolidayGlyph(name: string | null | undefined): { emoji: string; tone: string } {
  const n = (name || "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(n));
  if (has("christmas", "xmas"))                                                          return { emoji: "🎄", tone: "rgba(255,255,255,0.18)" };
  if (has("diwali", "deepavali", "govardhan", "bhai dooj"))                              return { emoji: "🪔", tone: "rgba(255,255,255,0.18)" };
  if (has("eid", "bakrid", "ramadan", "ramzan"))                                         return { emoji: "🌙", tone: "rgba(255,255,255,0.18)" };
  if (has("muharram"))                                                                   return { emoji: "🕊️", tone: "rgba(255,255,255,0.18)" };
  if (has("holi") && !has("holiday"))                                                    return { emoji: "🎨", tone: "rgba(255,255,255,0.18)" };
  if (has("independence day"))                                                           return { emoji: "🇮🇳", tone: "rgba(255,255,255,0.18)" };
  if (has("republic day"))                                                               return { emoji: "🇮🇳", tone: "rgba(255,255,255,0.18)" };
  if (has("gandhi jayanti", "ambedkar"))                                                 return { emoji: "🕊️", tone: "rgba(255,255,255,0.18)" };
  if (has("labour day"))                                                                 return { emoji: "🛠️", tone: "rgba(255,255,255,0.18)" };
  if (has("new year"))                                                                   return { emoji: "🎆", tone: "rgba(255,255,255,0.18)" };
  if (has("janmashtami", "krishna"))                                                     return { emoji: "🪈", tone: "rgba(255,255,255,0.18)" };
  if (has("ram navami", "ramanavami"))                                                   return { emoji: "🏹", tone: "rgba(255,255,255,0.18)" };
  if (has("good friday", "easter"))                                                      return { emoji: "✝️", tone: "rgba(255,255,255,0.18)" };
  if (has("ganesh", "ganpati"))                                                          return { emoji: "🐘", tone: "rgba(255,255,255,0.18)" };
  if (has("dussehra", "vijayadashami"))                                                  return { emoji: "🏹", tone: "rgba(255,255,255,0.18)" };
  if (has("shivratri", "shiva"))                                                         return { emoji: "🔱", tone: "rgba(255,255,255,0.18)" };
  if (has("raksha bandhan", "rakhi"))                                                    return { emoji: "🪢", tone: "rgba(255,255,255,0.18)" };
  if (has("onam"))                                                                       return { emoji: "🌺", tone: "rgba(255,255,255,0.18)" };
  if (has("pongal", "sankranti", "lohri"))                                               return { emoji: "🌾", tone: "rgba(255,255,255,0.18)" };
  if (has("mahavir"))                                                                    return { emoji: "🪷", tone: "rgba(255,255,255,0.18)" };
  if (has("buddha", "purnima"))                                                          return { emoji: "🪷", tone: "rgba(255,255,255,0.18)" };
  if (has("guru nanak", "gurpurab", "gurpurb"))                                          return { emoji: "📿", tone: "rgba(255,255,255,0.18)" };
  return { emoji: "🎉", tone: "rgba(255,255,255,0.18)" };
}

// Per-festival "decoration" — picks both a soft pastel accent colour and
// the kind of corner ornament to draw. Each holiday gets a distinct visual
// motif (diya / crescent / cross / lotus / etc.) so the card feels unique
// to the event rather than wearing a generic flower for every entry.
type OrnamentKind =
  | "snowflake" | "diya" | "crescent" | "splash" | "chakra" | "fireworks"
  | "feather"   | "bow"  | "cross"    | "om"     | "trishul"| "lotus"
  | "sun"       | "rakhi"| "khanda"   | "mandala";

function pickHolidayDeco(name: string | null | undefined): { accent: string; kind: OrnamentKind } {
  const n = (name || "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(n));
  if (has("christmas", "xmas"))                                              return { accent: "#c97a7a", kind: "snowflake" };
  if (has("diwali", "deepavali", "govardhan", "bhai dooj"))                  return { accent: "#d4a85e", kind: "diya"      };
  if (has("eid", "bakrid", "ramadan", "ramzan"))                             return { accent: "#7aa86a", kind: "crescent"  };
  if (has("muharram"))                                                       return { accent: "#7a8aa8", kind: "crescent"  };
  if (has("holi") && !has("holiday"))                                        return { accent: "#c98aaf", kind: "splash"    };
  if (has("independence day", "republic day", "gandhi jayanti", "ambedkar")) return { accent: "#c89466", kind: "chakra"    };
  if (has("new year"))                                                       return { accent: "#8a8ab5", kind: "fireworks" };
  if (has("janmashtami", "krishna"))                                         return { accent: "#7a98c8", kind: "feather"   };
  if (has("ram navami", "ramanavami", "dussehra", "vijayadashami"))          return { accent: "#c89466", kind: "bow"       };
  if (has("good friday", "easter"))                                          return { accent: "#a394c2", kind: "cross"     };
  if (has("ganesh", "ganpati"))                                              return { accent: "#c47a5e", kind: "om"        };
  if (has("shivratri", "shiva"))                                             return { accent: "#7a8aa8", kind: "trishul"   };
  if (has("mahavir", "buddha", "purnima"))                                   return { accent: "#c8a55e", kind: "lotus"     };
  if (has("pongal", "sankranti", "lohri"))                                   return { accent: "#c8a35e", kind: "sun"       };
  if (has("raksha bandhan", "rakhi"))                                        return { accent: "#c98a8a", kind: "rakhi"     };
  if (has("guru nanak", "gurpurab", "gurpurb"))                              return { accent: "#a08a6a", kind: "khanda"    };
  if (has("onam"))                                                           return { accent: "#88b079", kind: "mandala"   };
  if (has("labour day"))                                                     return { accent: "#a08a6a", kind: "mandala"   };
  return { accent: "#7aa1c8", kind: "mandala" };
}

// Polar-coordinate helper used by several ornaments. Returns
// [cx + r*cos(θ), cy + r*sin(θ)] with θ measured clockwise from 12 o'clock.
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

// Decorative corner ornament for the holiday card. Renders one of the
// festival-specific SVGs sized to a 120×120 viewBox; the parent positions
// it via `className`. All artwork is drawn in the accent colour at ~18%
// opacity so it sits behind the text as a tasteful watermark.
function HolidayOrnament({ accent, kind, className }: {
  accent: string; kind: OrnamentKind; className?: string;
}) {
  const wrap = (children: React.ReactNode, opacity = 0.18) => (
    <svg
      viewBox="0 0 120 120" aria-hidden="true"
      className={`pointer-events-none absolute ${className ?? ""}`}
      style={{ color: accent }}
    >
      <g style={{ opacity }}>{children}</g>
    </svg>
  );

  switch (kind) {
    case "snowflake": return wrap(
      <>
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 60 60)`} stroke="currentColor" strokeLinecap="round" fill="none">
            <line x1="60" y1="60" x2="60" y2="14" strokeWidth="2.2" />
            <line x1="60" y1="28" x2="52" y2="22" strokeWidth="1.8" />
            <line x1="60" y1="28" x2="68" y2="22" strokeWidth="1.8" />
            <line x1="60" y1="42" x2="54" y2="38" strokeWidth="1.4" />
            <line x1="60" y1="42" x2="66" y2="38" strokeWidth="1.4" />
          </g>
        ))}
        <circle cx="60" cy="60" r="3.5" fill="currentColor" />
      </>,
    );

    case "diya": return wrap(
      <>
        {/* Bowl with rim highlight */}
        <path d="M 24 70 Q 60 100 96 70 L 88 64 Q 60 78 32 64 Z" fill="currentColor" />
        <ellipse cx="60" cy="64" rx="28" ry="3" fill="currentColor" opacity="0.7" />
        {/* Wick */}
        <line x1="60" y1="64" x2="60" y2="46" stroke="currentColor" strokeWidth="2.2" />
        {/* Flame — outer + inner */}
        <path d="M 60 46 Q 53 32 60 14 Q 67 32 60 46 Z" fill="currentColor" opacity="0.85" />
        <path d="M 60 38 Q 56 32 60 22 Q 64 32 60 38 Z" fill="white"        opacity="0.45" />
        {/* Surrounding sparkles */}
        <circle cx="20" cy="40" r="1.5" fill="currentColor" />
        <circle cx="100" cy="40" r="1.5" fill="currentColor" />
        <circle cx="14" cy="78" r="1"   fill="currentColor" />
        <circle cx="106" cy="78" r="1"  fill="currentColor" />
      </>,
    );

    case "crescent": return wrap(
      <>
        <defs>
          <mask id="crescent-mask">
            <rect width="120" height="120" fill="white" />
            <circle cx="65" cy="50" r="30" fill="black" />
          </mask>
        </defs>
        <circle cx="50" cy="50" r="34" fill="currentColor" mask="url(#crescent-mask)" />
        <polygon points="92,38 95,46 103,46 96,51 99,59 92,54 85,59 88,51 81,46 89,46"
                 fill="currentColor" opacity="0.85" />
      </>,
    );

    case "splash": return wrap(
      <>
        <circle cx="42" cy="42" r="14" fill="currentColor" opacity="0.55" />
        <circle cx="78" cy="58" r="20" fill="currentColor" opacity="0.4"  />
        <circle cx="55" cy="84" r="10" fill="currentColor" opacity="0.5"  />
        <circle cx="20"  cy="65" r="3"   fill="currentColor" />
        <circle cx="98"  cy="32" r="3"   fill="currentColor" />
        <circle cx="100" cy="86" r="2"   fill="currentColor" />
        <circle cx="30"  cy="100" r="2"  fill="currentColor" />
        <circle cx="14"  cy="40" r="1.5" fill="currentColor" />
        <circle cx="106" cy="60" r="1.5" fill="currentColor" />
      </>, 0.20,
    );

    case "chakra": return wrap(
      <g fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="60" cy="60" r="44" />
        <circle cx="60" cy="60" r="38" />
        {Array.from({ length: 24 }).map((_, i) => {
          const [x, y] = polar(60, 60, 38, i * 15);
          return <line key={i} x1="60" y1="60" x2={x} y2={y} strokeWidth="1" />;
        })}
        <circle cx="60" cy="60" r="5" fill="currentColor" stroke="none" />
      </g>,
    );

    case "fireworks": return wrap(
      <g stroke="currentColor" strokeLinecap="round">
        {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
          const [x1, y1] = polar(60, 60, 8,  deg);
          const [x2, y2] = polar(60, 60, i % 2 === 0 ? 38 : 30, deg);
          return <line key={`r-${deg}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2" />;
        })}
        {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
          const [x, y] = polar(60, 60, i % 2 === 0 ? 44 : 36, deg);
          return <circle key={`d-${deg}`} cx={x} cy={y} r="1.5" fill="currentColor" stroke="none" />;
        })}
        <circle cx="60" cy="60" r="3" fill="currentColor" stroke="none" />
      </g>,
    );

    case "feather": return wrap(
      <>
        <ellipse cx="60" cy="50" rx="22" ry="38" fill="currentColor" opacity="0.4" />
        <ellipse cx="60" cy="50" rx="14" ry="28" fill="currentColor" opacity="0.6" />
        <line x1="60" y1="42" x2="60" y2="106" stroke="currentColor" strokeWidth="2" />
        {/* Feather "eye" */}
        <ellipse cx="60" cy="48" rx="11" ry="14" fill="white"        opacity="0.8" />
        <ellipse cx="60" cy="48" rx="6"  ry="9"  fill="currentColor" />
        {/* Side filaments */}
        {[-22,-14,-6,2,10,18].map((y, i) => (
          <g key={i}>
            <line x1={45} y1={60 + y} x2={32} y2={60 + y * 1.2} stroke="currentColor" strokeWidth="0.7" />
            <line x1={75} y1={60 + y} x2={88} y2={60 + y * 1.2} stroke="currentColor" strokeWidth="0.7" />
          </g>
        ))}
      </>, 0.20,
    );

    case "bow": return wrap(
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        {/* Bow */}
        <path d="M 35 22 Q 100 60 35 98" strokeWidth="2.4" />
        <line x1="35" y1="22" x2="35" y2="98" strokeWidth="1" />
        {/* Arrow */}
        <line x1="35" y1="60" x2="105" y2="60" strokeWidth="2" />
        <polygon points="106,60 96,55 96,65" fill="currentColor" stroke="none" />
        <line x1="40" y1="60" x2="46" y2="55" strokeWidth="1.5" />
        <line x1="40" y1="60" x2="46" y2="65" strokeWidth="1.5" />
      </g>,
    );

    case "cross": return wrap(
      <>
        <rect x="55" y="14"  width="10" height="92" fill="currentColor" rx="2" />
        <rect x="30" y="38"  width="60" height="10" fill="currentColor" rx="2" />
        <circle cx="60" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </>,
    );

    case "om": return wrap(
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 30 50 C 30 35 50 30 60 40 C 70 50 65 65 50 65 L 45 65" />
        <path d="M 50 65 C 35 65 30 78 46 88 C 62 92 76 80 70 64 L 70 58" />
        <path d="M 70 50 C 76 44 88 50 88 60" />
        <path d="M 78 28 Q 85 22 92 28" strokeWidth="1.6" />
        <circle cx="92" cy="34" r="3" fill="currentColor" stroke="none" />
      </g>,
    );

    case "trishul": return wrap(
      <g stroke="currentColor" fill="currentColor" strokeLinecap="round">
        <line x1="60" y1="48" x2="60" y2="14" strokeWidth="2.5" />
        <polygon points="55,16 60,2 65,16"  stroke="none" />
        <line x1="38" y1="48" x2="38" y2="22" strokeWidth="2" />
        <polygon points="34,24 38,12 42,24" stroke="none" />
        <line x1="82" y1="48" x2="82" y2="22" strokeWidth="2" />
        <polygon points="78,24 82,12 86,24" stroke="none" />
        <line x1="34" y1="50" x2="86" y2="50" strokeWidth="3" />
        <line x1="60" y1="50" x2="60" y2="108" strokeWidth="2.5" />
        <ellipse cx="60" cy="58" rx="6" ry="2.5" stroke="none" />
      </g>,
    );

    case "lotus": return wrap(
      <>
        {[0, 36, 72, 108, 144, 180, 216, 252, 288, 324].map((deg) => (
          <ellipse key={`o-${deg}`} cx="60" cy="34" rx="6" ry="22"
            fill="currentColor" opacity="0.4"
            transform={`rotate(${deg} 60 60)`} />
        ))}
        {[18, 54, 90, 126, 162, 198, 234, 270, 306, 342].map((deg) => (
          <ellipse key={`i-${deg}`} cx="60" cy="44" rx="5" ry="14"
            fill="currentColor" opacity="0.6"
            transform={`rotate(${deg} 60 60)`} />
        ))}
        <circle cx="60" cy="60" r="6" fill="currentColor" />
      </>,
    );

    case "sun": return wrap(
      <>
        <circle cx="60" cy="60" r="22" fill="currentColor" opacity="0.4" />
        <circle cx="60" cy="60" r="14" fill="currentColor" opacity="0.7" />
        {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg) => {
          const [x1, y1] = polar(60, 60, 28, deg);
          const [x2, y2] = polar(60, 60, 42, deg);
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2}
                       stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />;
        })}
      </>,
    );

    case "rakhi": return wrap(
      <>
        <path d="M 0 60 Q 25 50 44 60"   fill="none" stroke="currentColor" strokeWidth="2"   strokeLinecap="round" />
        <path d="M 120 60 Q 95 70 76 60" fill="none" stroke="currentColor" strokeWidth="2"   strokeLinecap="round" />
        <path d="M 0 65 Q 22 56 42 64"   fill="none" stroke="currentColor" strokeWidth="1"   opacity="0.6" />
        <path d="M 120 65 Q 98 73 78 65" fill="none" stroke="currentColor" strokeWidth="1"   opacity="0.6" />
        <circle cx="60" cy="60" r="18" fill="currentColor" opacity="0.4" />
        <circle cx="60" cy="60" r="10" fill="currentColor" opacity="0.7" />
        {[0,45,90,135,180,225,270,315].map((deg) => {
          const [x, y] = polar(60, 60, 18, deg);
          return <circle key={deg} cx={x} cy={y} r="2" fill="currentColor" />;
        })}
      </>,
    );

    case "khanda": return wrap(
      <g stroke="currentColor" fill="currentColor">
        {/* Centre double-edged sword */}
        <line x1="60" y1="14" x2="60" y2="106" strokeWidth="2.5" />
        <polygon points="56,16 60,4 64,16" stroke="none" />
        <ellipse cx="60" cy="60" rx="6" ry="3" stroke="none" />
        {/* Outer crescents */}
        <path d="M 28 60 Q 28 32 60 28" fill="none" strokeWidth="2.2" />
        <path d="M 92 60 Q 92 32 60 28" fill="none" strokeWidth="2.2" />
        {/* Inner single-edged daggers */}
        <line x1="40" y1="32" x2="40" y2="64" strokeWidth="1.8" />
        <polygon points="37,34 40,24 43,34" stroke="none" />
        <line x1="80" y1="32" x2="80" y2="64" strokeWidth="1.8" />
        <polygon points="77,34 80,24 83,34" stroke="none" />
        {/* Bottom chakra ring */}
        <circle cx="60" cy="80" r="14" fill="none" strokeWidth="2.2" />
      </g>,
    );

    case "mandala":
    default: return wrap(
      <>
        {Array.from({ length: 24 }).map((_, i) => {
          const [x, y] = polar(60, 60, 54, (i * 360) / 24);
          return <circle key={`d-${i}`} cx={x} cy={y} r="0.9" fill="currentColor" />;
        })}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <ellipse key={`p-${deg}`} cx="60" cy="32" rx="9" ry="22"
            fill="currentColor" opacity="0.55"
            transform={`rotate(${deg} 60 60)`} />
        ))}
        <circle cx="60" cy="60" r="14" fill="none" stroke="currentColor" strokeWidth="0.8" />
        <circle cx="60" cy="60" r="6"  fill="currentColor" />
      </>, 0.16,
    );
  }
}

function QuickLinksCard() {
  const links = [
    { label: "Attendance", href: "/dashboard/hr/attendance" },
    { label: "Leave", href: "/dashboard/hr/leaves" },
    { label: "People", href: "/dashboard/hr/people" },
    { label: "Inbox", href: "/dashboard/hr/inbox" },
    { label: "Engage", href: "/dashboard/hr/engage" },
    { label: "Announcements", href: "/dashboard/hr/announcements" },
    { label: "Tools", href: "/dashboard/tools" },
  ];

  return (
    <div className={`${C.card} p-3.5`}>
      <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>Quick Links</p>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-[12px] font-medium text-[#008CFF] transition-colors hover:text-[#0070d4] hover:underline"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function FeedPostCard({ post, sessionUser }: { post: any; sessionUser: any }) {
  const sessionUserId = sessionUser?.dbId;
  const isAuthor   = post.author?.id === sessionUserId;
  const canDelete  = isAuthor || isHRAdmin(sessionUser);

  // Per-comment delete rule: comment author OR developer OR
  // orgLevel="hr_manager" (covers HR Manager + HR tier).
  const canDeleteComment = useCallback((c: any) => {
    if (!c) return false;
    if (c.author?.id === sessionUserId) return true;             // owner
    if (sessionUser?.isDeveloper === true) return true;          // dev
    if (sessionUser?.orgLevel === "hr_manager") return true;     // HR tier
    return false;
  }, [sessionUserId, sessionUser?.isDeveloper, sessionUser?.orgLevel]);

  // Which comment's 3-dot menu is currently open (Instagram-style,
  // one at a time). null = no menu open.
  const [openCommentMenu, setOpenCommentMenu] = useState<number | null>(null);
  // Per-comment "deleting" spinner state to disable double-click.
  const [deletingComment, setDeletingComment] = useState<number | null>(null);

  const deleteComment = async (commentId: number) => {
    if (!confirm("Delete this comment? This can't be undone.")) return;
    setDeletingComment(commentId);
    setOpenCommentMenu(null);
    try {
      const res = await fetch(`/api/hr/engage/posts/${post.id}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Delete failed (${res.status})`);
      }
      // Bust both feed scopes so the comment disappears immediately.
      mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/engage/posts"));
    } catch (e: any) {
      alert(e?.message || "Couldn't delete the comment.");
    } finally {
      setDeletingComment(null);
    }
  };

  // "2h ago" / "3d ago" / "12 Mar" formatter for the timestamp
  // beneath each comment — keeps the layout tight (Instagram-style).
  const formatCommentTime = (iso: string | Date | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const diffSec = (Date.now() - d.getTime()) / 1000;
    if (diffSec < 60)              return "just now";
    if (diffSec < 3600)            return `${Math.floor(diffSec / 60)}m`;
    if (diffSec < 86400)           return `${Math.floor(diffSec / 3600)}h`;
    if (diffSec < 86400 * 7)       return `${Math.floor(diffSec / 86400)}d`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos,  setMenuPos]  = useState<{ top: number; right: number } | null>(null);
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(post.content);
  const [saving,   setSaving]   = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const menuBtnRef   = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);

  // Inline reaction + comment state (mirrors /dashboard/hr/engage).
  // Lets HR react / comment without bouncing into the full feed page.
  // `myReactionEmoji` is the current user's emoji (null if they
  // haven't reacted yet) — drives the React-button label so the
  // user can see at a glance how they reacted.
  const myCurrentReaction = Array.isArray(post.reactions)
    ? (post.reactions.find((r: any) => r.userId === sessionUserId)?.emoji ?? null)
    : null;
  const [myReactionEmoji, setMyReactionEmoji] = useState<string | null>(myCurrentReaction);
  const [reactionCount, setReactionCount] = useState(post.reactions?.length ?? 0);
  const [showComments,  setShowComments]  = useState(false);
  const [commentText,   setCommentText]   = useState("");
  const [commentEmojiOpen, setCommentEmojiOpen] = useState(false);
  const commentInputRef = useRef<HTMLInputElement | null>(null);
  // Reaction picker popover (anchored to the React button).
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const reactionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactionPickerRef  = useRef<HTMLDivElement | null>(null);
  // Reaction set — refreshed for expressiveness. The codepoints
  // render via whichever emoji font the OS ships; on Android 14+
  // these all come from the new animated/Material-You set.
  //   Like · Love · Haha · Wow · Sad · Pray · Clap · Party · Cake · Fire
  const REACTION_EMOJIS = ["👍", "❤️", "🤣", "😮", "😢", "🙏", "👏", "🎉", "🎂", "🔥"];

  // The home feed is rendered inside cards with their own clipping. Render
  // the dropdown via a body-level portal at fixed position so the parent
  // overflow can never crop it (same pattern as the engage card).
  const openMenu = () => {
    if (!menuBtnRef.current) return;
    const r = menuBtnRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const insideBtn   = menuBtnRef.current?.contains(e.target as Node);
      const insidePanel = menuPanelRef.current?.contains(e.target as Node);
      if (!insideBtn && !insidePanel) setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menuOpen]);

  // The home page uses two SWR keys for posts (org-wide vs team-scoped),
  // so revalidate any key starting with the posts endpoint after a
  // mutation rather than only the bare URL.
  const revalidatePosts = () =>
    mutate((key: any) => typeof key === "string" && key.startsWith("/api/hr/engage/posts"));

  const saveEdit = async () => {
    if (!draft.trim() || draft === post.content) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/engage/posts/${post.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Could not save edit"); return; }
      setEditing(false);
      revalidatePosts();
    } finally { setSaving(false); }
  };

  const deletePost = async () => {
    if (!confirm("Delete this post? This can't be undone.")) return;
    const res = await fetch(`/api/hr/engage/posts/${post.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Could not delete"); return; }
    revalidatePosts();
  };

  // No per-post permalink page yet — link into the engage feed and hash
  // the post id so a future deep-link handler can scroll to the card.
  const copyLink = async () => {
    const url = `${window.location.origin}/dashboard/hr/engage#post-${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const COLLAPSE_AT = 280;
  const tooLong = post.content.length > COLLAPSE_AT || (post.content.match(/\n/g)?.length ?? 0) > 3;
  const visibleBody = !tooLong || expanded
    ? post.content
    : post.content.slice(0, COLLAPSE_AT).trimEnd() + "…";

  // Optimistic react — picks (or replaces, or removes) the user's
  // reaction emoji. Three branches, mirroring the API:
  //   • same emoji  → remove (count -1)
  //   • new emoji   → replace (count unchanged)
  //   • no prior    → add (count +1)
  const pickReaction = async (emoji: string) => {
    setReactionPickerOpen(false);
    const prior = myReactionEmoji;
    if (prior === emoji) {
      setMyReactionEmoji(null);
      setReactionCount((c: number) => Math.max(0, c - 1));
    } else if (prior) {
      setMyReactionEmoji(emoji); // replace; count unchanged
    } else {
      setMyReactionEmoji(emoji);
      setReactionCount((c: number) => c + 1);
    }
    try {
      await fetch(`/api/hr/engage/posts/${post.id}/react`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
      });
    } catch { /* SWR revalidate corrects any drift. */ }
    revalidatePosts();
  };

  // React button click: if the user already has a reaction, this
  // button TOGGLES it off (matches the "click your reaction to
  // unreact" pattern from Facebook). Otherwise it opens the emoji
  // picker so the user can pick how they want to react.
  const onReactButtonClick = () => {
    if (myReactionEmoji) { pickReaction(myReactionEmoji); return; }
    setReactionPickerOpen(true);
  };

  // Close the picker on Esc / click-outside.
  useEffect(() => {
    if (!reactionPickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReactionPickerOpen(false); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (reactionTriggerRef.current?.contains(t)) return;
      if (reactionPickerRef.current?.contains(t))  return;
      setReactionPickerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [reactionPickerOpen]);

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    setCommentText("");
    setCommentEmojiOpen(false);
    try {
      await fetch(`/api/hr/engage/posts/${post.id}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
    } catch { /* best-effort; SWR re-fetch fills the comment in on success. */ }
    revalidatePosts();
  };

  // Insert an emoji at the current caret position of the comment input.
  // Keeping the caret math local to the comment input so it doesn't
  // collide with the parent post-composer's insertAtCursor helper.
  const insertEmojiIntoComment = (emoji: string) => {
    const input = commentInputRef.current;
    if (!input) { setCommentText((t) => t + emoji); return; }
    const start = input.selectionStart ?? commentText.length;
    const end   = input.selectionEnd   ?? commentText.length;
    const next  = commentText.slice(0, start) + emoji + commentText.slice(end);
    setCommentText(next);
    // Restore focus + caret position one tick later so React's
    // controlled-value update has landed.
    requestAnimationFrame(() => {
      input.focus();
      const pos = start + emoji.length;
      input.setSelectionRange(pos, pos);
    });
  };

  const commentCount  = post.comments?.length  || 0;

  // Pull reactor display names off the post payload — the /api/hr/
  // engage/posts endpoint already includes `reactions.user.name`.
  // The "most recent" reactor is approximated as the last id in
  // the array; the schema has no createdAt on EngageReaction so
  // ascending-id is the closest proxy.
  const reactorNames: string[] = Array.isArray(post.reactions)
    ? post.reactions.map((r: any) => r.user?.name).filter(Boolean)
    : [];
  // Name + emoji pairs for the reactor popover, so HR can see WHO
  // reacted with WHICH emoji (not just a list of names).
  const reactors: Array<{ name: string; emoji: string }> = Array.isArray(post.reactions)
    ? post.reactions
        .filter((r: any) => r.user?.name)
        .map((r: any) => ({ name: r.user.name as string, emoji: (r.emoji as string) || "👍" }))
    : [];
  // Distinct emojis used on this post, ordered by frequency desc
  // then most-recent. Drives the stacked-emoji chip in the summary
  // so the surface reflects what people actually picked instead of
  // a hardcoded 👍.
  const emojiCounts = new Map<string, number>();
  if (Array.isArray(post.reactions)) {
    for (const r of post.reactions) {
      const e = (r?.emoji as string) || "👍";
      emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
    }
  }
  const topEmojis: string[] = [...emojiCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e)
    .slice(0, 3);
  const latestReactor = reactorNames.length > 0 ? reactorNames[reactorNames.length - 1] : null;
  const otherReactors = reactorNames.length > 1 ? reactorNames.length - 1 : 0;
  const initialsOf = (n: string) =>
    n.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";
  // Reactors popover — anchored just above the "+ N others" button.
  // Portal'd to body so the card's overflow / z-index can't clip it,
  // but positioned at fixed coordinates derived from the trigger's
  // bounding rect rather than centered on the viewport.
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [reactorsAnchor, setReactorsAnchor] = useState<{ top: number; left: number } | null>(null);
  const reactorsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactorsPanelRef   = useRef<HTMLDivElement | null>(null);

  const openReactorsPopover = () => {
    const btn = reactorsTriggerRef.current;
    if (!btn) { setReactorsOpen(true); return; }
    const rect = btn.getBoundingClientRect();
    const PANEL_W = 200;
    const PANEL_H_GUESS = Math.min(260, 12 + reactorNames.length * 30);
    const GAP = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const above = rect.top - GAP - PANEL_H_GUESS;
    const below = rect.bottom + GAP;
    const top = above >= 8 ? above : Math.min(below, vh - PANEL_H_GUESS - 8);
    let left = rect.right - PANEL_W;
    if (left < 8) left = 8;
    if (left + PANEL_W > vw - 8) left = vw - PANEL_W - 8;
    setReactorsAnchor({ top, left });
    setReactorsOpen(true);
  };

  // Close on Esc + click-outside. Reposition on scroll/resize so the
  // popover follows the trigger if the page shifts while open.
  useEffect(() => {
    if (!reactorsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReactorsOpen(false); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (reactorsTriggerRef.current?.contains(t)) return;
      if (reactorsPanelRef.current?.contains(t))  return;
      setReactorsOpen(false);
    };
    const onScroll = () => {
      const btn = reactorsTriggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const PANEL_W = 200;
      const PANEL_H_GUESS = Math.min(260, 12 + reactorNames.length * 30);
      const GAP = 6;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const above = rect.top - GAP - PANEL_H_GUESS;
      const below = rect.bottom + GAP;
      const top = above >= 8 ? above : Math.min(below, vh - PANEL_H_GUESS - 8);
      let left = rect.right - PANEL_W;
      if (left < 8) left = 8;
      if (left + PANEL_W > vw - 8) left = vw - PANEL_W - 8;
      setReactorsAnchor({ top, left });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [reactorsOpen, reactorNames.length]);

  return (
    // overflow-visible so the portal-fallback dropdown is never clipped
    // by the card's rounded corners (matches the engage card).
    <article id={`post-${post.id}`} className={`${C.card} overflow-visible scroll-mt-24`}>
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Av name={post.author?.name || "User"} url={post.author?.profilePictureUrl} size={34} />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-[#2e4051]">
                {post.author?.name || "Team member"}
                <span className="ml-1 font-normal text-[#8a98a8]">created a post</span>
              </p>
              <p className="mt-0.5 text-[11px] text-[#97a4b3]">{timeAgo(post.createdAt)}</p>
            </div>
          </div>
          <button
            ref={menuBtnRef}
            onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
            aria-label="More options"
            aria-expanded={menuOpen}
            className="rounded-md p-1 text-[#95a3b1] transition hover:bg-[#f5f7fb] hover:text-[#607284]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && menuPos && typeof document !== "undefined" && createPortal(
            <div
              ref={menuPanelRef}
              style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 1000 }}
              className="min-w-[160px] rounded-lg border border-[#e3e9f1] bg-white shadow-lg overflow-hidden"
            >
              {isAuthor && (
                <button
                  onClick={() => { setMenuOpen(false); setDraft(post.content); setEditing(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[#3b4a5a] hover:bg-[#f5f7fb] transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
              )}
              <button
                onClick={() => { setMenuOpen(false); copyLink(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[#3b4a5a] hover:bg-[#f5f7fb] transition-colors"
              >
                {linkCopied
                  ? (<><Check className="w-3.5 h-3.5 text-emerald-600" /> Link copied</>)
                  : (<><Link2 className="w-3.5 h-3.5" /> Copy link</>)}
              </button>
              {canDelete && (
                <button
                  onClick={() => { setMenuOpen(false); deletePost(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>,
            document.body,
          )}
        </div>

        {editing ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#e3e9f1] bg-white px-3 py-2 text-[13px] text-[#3b4a5a] focus:outline-none focus:border-[#008CFF]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setEditing(false); setDraft(post.content); }}
                disabled={saving}
                className="h-8 px-3 rounded-lg text-[12px] font-semibold text-[#5f7183] hover:bg-[#f5f7fb] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="h-8 px-4 rounded-lg bg-[#008CFF] hover:bg-[#0070d4] text-white text-[12px] font-semibold disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[13px] leading-6 text-[#526476] whitespace-pre-wrap">{visibleBody}</p>
            {tooLong && (
              <button
                onClick={() => setExpanded((p) => !p)}
                className="mt-1 text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0070d4]"
              >
                {expanded ? "View less" : "View more"}
              </button>
            )}
          </>
        )}

        {post.mediaUrl ? (
          <div className="mt-3 overflow-hidden rounded-[3px] border border-[#ecf1f5] bg-[#f8fafc]">
            <img
              src={post.mediaUrl}
              alt="Post media"
              className="block mx-auto max-h-[360px] w-auto max-w-full object-contain"
            />
          </div>
        ) : null}
      </div>

      {/* Single-row footer: Like / Comment on the left, reaction +
          comment summary on the right. Both buttons now act inline —
          Like toggles the user's reaction directly, Comment expands
          the comment panel below with a Send + emoji picker so wishes
          stay quick. */}
      <div className="flex items-center justify-between border-t border-[#eef2f6] px-2 sm:px-3 py-1.5">
        <div className="flex items-center">
          <div className="relative">
            <button
              ref={reactionTriggerRef}
              type="button"
              onClick={onReactButtonClick}
              title={myReactionEmoji ? "Click to remove" : "React"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors hover:bg-[#f5f7fb] ${
                myReactionEmoji ? "text-[#008CFF]" : "text-[#5f7183]"
              }`}
            >
              {myReactionEmoji ? (
                <span className="text-[16px] leading-none">{myReactionEmoji}</span>
              ) : (
                <SmilePlus className="h-4 w-4" />
              )}
              React
            </button>
            {/* Emoji picker — thin pill anchored above the React
                button. Click any emoji to add / replace / remove.
                Click-outside / Esc closes. */}
            {reactionPickerOpen && (
              <div
                ref={reactionPickerRef}
                role="dialog"
                className="absolute bottom-full left-0 mb-1.5 z-50 flex items-center gap-0.5 px-1 py-1 rounded-full border border-slate-200 bg-white shadow-[0_6px_18px_-4px_rgba(15,23,42,0.18)] animate-in fade-in zoom-in-95 duration-100"
              >
                {REACTION_EMOJIS.map((e) => {
                  const isMine = e === myReactionEmoji;
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => pickReaction(e)}
                      title={isMine ? "Click to remove" : "React"}
                      className={`h-7 w-7 flex items-center justify-center rounded-full text-[16px] transition-transform hover:scale-110 ${isMine ? "bg-[#e6f3ff]" : "hover:bg-slate-50"}`}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowComments((p) => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors hover:bg-[#f5f7fb] ${
              showComments ? "text-[#008CFF]" : "text-[#5f7183]"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            {/* LinkedIn / Facebook pattern: prepend the count with
                pluralised label. Cleaner than a separate badge pill —
                reads as a single coherent phrase. */}
            <span>
              {commentCount === 0 && "Comment"}
              {commentCount === 1 && "1 Comment"}
              {commentCount > 1 && `${commentCount} Comments`}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-1.5 pr-2 text-[12px] text-[#8393a3]">
          {reactionCount > 0 && (
            // Compact reactor summary — Instagram-style. Stacked
            // emojis reflect the distinct reactions used (top 3 by
            // count), latest reactor name inline, clickable +N for
            // the full list popover.
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex items-center -space-x-1">
                {topEmojis.map((e, i) => (
                  <span
                    key={e}
                    className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-white text-[12px] ring-1 ring-slate-200 shadow-sm leading-none"
                    style={{ zIndex: topEmojis.length - i }}
                  >
                    {e}
                  </span>
                ))}
              </span>
              <span className="truncate max-w-[180px]" title={latestReactor || ""}>{latestReactor}</span>
              {otherReactors > 0 && (
                <button
                  ref={reactorsTriggerRef}
                  type="button"
                  onClick={openReactorsPopover}
                  className="font-semibold text-[#008CFF] hover:underline"
                >
                  and +{otherReactors} {otherReactors === 1 ? "other" : "others"}
                </button>
              )}
            </span>
          )}
          {/* Comment count moved to the Comment button itself — the
              right-side aggregate now only carries the reactor names.
              Drop the duplicate badge here. */}
        </div>
      </div>

      {/* Inline comment panel — same structure as the engage page's
          composer, plus an emoji picker. Existing comments render
          above the composer. */}
      {showComments && (
        <div className="border-t border-[#eef2f6] bg-white px-3 sm:px-4 py-3 space-y-3">
          {Array.isArray(post.comments) && post.comments.length > 0 && (
            <div className="space-y-3.5">
              {post.comments.map((c: any) => {
                const showDelete = canDeleteComment(c);
                const isMenuOpen = openCommentMenu === c.id;
                const isDeleting = deletingComment === c.id;
                return (
                  <div
                    key={c.id}
                    className={`group relative flex items-start gap-3 -mx-2 px-2 py-1.5 rounded-lg transition-all ${
                      isDeleting ? "opacity-50" : "hover:bg-[#f7f9fc]"
                    }`}
                  >
                    {/* Avatar — slightly smaller for tighter rhythm */}
                    <div className="shrink-0 pt-0.5">
                      <Av name={c.author?.name || "User"} url={c.author?.profilePictureUrl} size={30} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12.5px] text-[#3b4a5a] leading-relaxed break-words min-w-0">
                          <span className="font-semibold text-[#1e2a38] mr-1.5">{c.author?.name || "Team member"}</span>
                          <span className="text-[#52647a] whitespace-pre-wrap">{c.content}</span>
                        </p>

                        {showDelete && (
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => setOpenCommentMenu(isMenuOpen ? null : c.id)}
                              disabled={isDeleting}
                              aria-label="Comment options"
                              className={`h-6 w-6 inline-flex items-center justify-center rounded-full text-[#8393a3] transition-all ${
                                isMenuOpen
                                  ? "bg-[#eef2f6] text-[#3b4a5a] opacity-100"
                                  : "opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[#eef2f6] hover:text-[#3b4a5a]"
                              }`}
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                            {isMenuOpen && (
                              <>
                                <button
                                  type="button"
                                  aria-hidden="true"
                                  tabIndex={-1}
                                  onClick={() => setOpenCommentMenu(null)}
                                  className="fixed inset-0 z-30 cursor-default"
                                  style={{ background: "transparent" }}
                                />
                                <div className="absolute right-0 top-7 z-40 rounded-lg border border-[#e2e8f0] bg-white shadow-[0_8px_24px_-6px_rgba(15,23,42,0.18)] overflow-hidden py-1">
                                  <button
                                    type="button"
                                    onClick={() => deleteComment(c.id)}
                                    className="w-full px-3 py-1.5 text-left text-[12px] font-medium text-rose-600 hover:bg-rose-50 inline-flex items-center gap-2 whitespace-nowrap"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                                    <span>Delete comment</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mt-0.5 text-[10.5px] font-medium text-[#97a4b3]">
                        {formatCommentTime(c.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className={`flex items-center gap-3 ${Array.isArray(post.comments) && post.comments.length > 0 ? "pt-1" : ""}`}>
            <div className="shrink-0">
              <Av name={sessionUser?.name || "You"} url={sessionUser?.profilePictureUrl} size={30} />
            </div>
            <div className="relative flex-1">
              <div className="flex items-center gap-1 bg-[#f5f7fb] border border-transparent rounded-full pl-4 pr-1 py-1 focus-within:bg-white focus-within:border-[#008CFF] focus-within:shadow-[0_0_0_3px_rgba(0,140,255,0.08)] transition-all">
                <input
                  ref={commentInputRef}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); }
                  }}
                  placeholder="Write a comment…"
                  className="flex-1 bg-transparent text-[12.5px] text-[#1e2a38] placeholder-[#8393a3] focus:outline-none py-1.5"
                />
                <button
                  type="button"
                  onClick={() => setCommentEmojiOpen((v) => !v)}
                  title="Insert emoji"
                  className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full transition ${
                    commentEmojiOpen ? "bg-[#f5f9ff] text-[#008CFF]" : "text-[#5c6b80] hover:bg-[#f5f9ff] hover:text-[#008CFF]"
                  }`}
                >
                  <Smile className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={submitComment}
                  disabled={!commentText.trim()}
                  title="Send"
                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-[#008CFF] hover:bg-[#f5f9ff] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
              {commentEmojiOpen && (
                <div className="absolute right-0 z-20 mt-1 flex flex-wrap gap-1 rounded-md border border-[#dbe4ed] bg-white p-2 shadow-lg w-[260px]">
                  {["😀","😂","😍","🥳","🙏","👏","👍","🔥","💯","🎉","🚀","💡","✅","❤️","☕","☀️","🌟","🤝","💪","🙌","😊","😎","✨","📌","📷","🎯","💼","📝","🎂","🏆"].map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => insertEmojiIntoComment(e)}
                      className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f9ff] text-[16px]"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reactors popover — minimal anchored card. No header, no
          close button (click-outside / Esc); just the list. */}
      {reactorsOpen && reactorsAnchor && typeof document !== "undefined" && createPortal(
        <div
          ref={reactorsPanelRef}
          role="dialog"
          aria-modal="false"
          style={{ position: "fixed", top: reactorsAnchor.top, left: reactorsAnchor.left, width: 200, zIndex: 10000 }}
          className="rounded-lg border border-slate-200 bg-white shadow-[0_6px_18px_-4px_rgba(15,23,42,0.15)] animate-in fade-in duration-100"
        >
          <ul className="max-h-[220px] overflow-y-auto py-1.5">
            {reactors.map((r, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-[15px] leading-none shrink-0">{r.emoji}</span>
                <span className="truncate text-[12px] text-slate-700">{r.name}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </article>
  );
}

// "Other ▾" dropdown next to the Clock-in button on the Quick Access tile.
// Surfaces the most common non-clock-in actions: Work From Home, On Duty,
// and Apply Leave. Selecting an item invokes `onSelect(kind)` so the host
// page can open the apply modal in-place — no navigation away from home.
//
// The menu portals to document.body and uses fixed positioning so the
// parent card's `overflow-hidden` doesn't clip it (the Quick Access tile
// has rounded corners + clipping that would otherwise crop the popover).
function OtherActionsMenu({ onSelect, showWfh = true }: { onSelect: (kind: LeaveRequestKind) => void; showWfh?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState<{ top: number; right: number } | null>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t))   return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        const vw = typeof window !== "undefined" ? window.innerWidth : 0;
        setPos({ top: r.bottom + 6, right: Math.max(8, vw - r.right) });
      }
    }
    setOpen((v) => !v);
  };

  // Remote / hybrid employees already work from home as their baseline —
  // surfacing a "Work From Home" leave action for them would be
  // redundant. Caller flips `showWfh=false` for those workers.
  const items: { label: string; Icon: typeof HomeIcon; kind: LeaveRequestKind }[] = [
    ...(showWfh ? [{ label: "Work From Home", Icon: HomeIcon,  kind: "wfh" as LeaveRequestKind }] : []),
    { label: "On Duty",        Icon: Briefcase, kind: "on_duty" },
    { label: "Apply Leave",    Icon: Coffee,    kind: "leave"   },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="flex h-[24px] items-center gap-1 rounded-[3px] bg-white px-2.5 text-[11px] font-medium text-[#4d5864] transition hover:bg-[#f4f6f8]"
        aria-expanded={open}
      >
        Other <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] w-[200px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18)] dark:border-white/[0.08] dark:bg-[#0a1526]"
          style={{ top: pos.top, right: pos.right }}
        >
          {items.map(({ label, Icon, kind }) => (
            <button
              key={label}
              type="button"
              onClick={() => { setOpen(false); onSelect(kind); }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-slate-700 transition-colors hover:bg-[#008CFF]/[0.08] hover:text-[#008CFF] dark:text-slate-200 dark:hover:bg-[#008CFF]/[0.12] dark:hover:text-[#4a9cff]"
            >
              <Icon size={15} strokeWidth={2} className="shrink-0 text-[#008CFF] dark:text-[#4a9cff]" />
              {label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// Modal: full year list of holidays with year-paging chevrons. Triggered
// from the holiday card's "View All" link so users can browse the
// calendar without leaving /dashboard/hr/home.
function HolidaysModal({ initialYear, onClose }: { initialYear: number; onClose: () => void }) {
  const [year, setYear] = useState(initialYear);
  const { data: holidaysData = [] } = useSWR(`/api/hr/admin/holidays?year=${year}`, fetcher);
  const list: { id: number; name: string; date: string; type: string }[] = Array.isArray(holidaysData)
    ? holidaysData.map((h: any) => ({ id: h.id, name: h.name, date: String(h.date).slice(0, 10), type: h.type || "public" }))
    : [];
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));

  // Soft pastel tiles that match the rest of the dashboard's white card
  // surfaces — uses the same hue family the leave-balance rings and
  // ApprovalsPanel pills draw from.
  const PALETTE = [
    { bg: "bg-sky-50 ring-sky-100",        digit: "text-sky-700",        month: "text-sky-600"     },
    { bg: "bg-rose-50 ring-rose-100",      digit: "text-rose-700",       month: "text-rose-600"    },
    { bg: "bg-amber-50 ring-amber-100",    digit: "text-amber-700",      month: "text-amber-600"   },
    { bg: "bg-violet-50 ring-violet-100",  digit: "text-violet-700",     month: "text-violet-600"  },
    { bg: "bg-emerald-50 ring-emerald-100",digit: "text-emerald-700",    month: "text-emerald-600" },
    { bg: "bg-orange-50 ring-orange-100",  digit: "text-orange-700",     month: "text-orange-600"  },
    { bg: "bg-pink-50 ring-pink-100",      digit: "text-pink-700",       month: "text-pink-600"    },
    { bg: "bg-cyan-50 ring-cyan-100",      digit: "text-cyan-700",       month: "text-cyan-600"    },
    { bg: "bg-yellow-50 ring-yellow-100",  digit: "text-yellow-700",     month: "text-yellow-600"  },
    { bg: "bg-fuchsia-50 ring-fuchsia-100",digit: "text-fuchsia-700",    month: "text-fuchsia-600" },
    { bg: "bg-teal-50 ring-teal-100",      digit: "text-teal-700",       month: "text-teal-600"    },
    { bg: "bg-indigo-50 ring-indigo-100",  digit: "text-indigo-700",     month: "text-indigo-600"  },
  ];
  const tintFor = (idx: number) => PALETTE[idx % PALETTE.length];

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-16px_rgba(15,23,42,0.25)] ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold text-[#1b2b3c]">Holidays</h2>
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
              <button
                type="button"
                onClick={() => setYear((y) => y - 1)}
                aria-label="Previous year"
                className="flex h-5 w-5 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-[#008CFF]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[36px] text-center text-[13px] font-semibold tabular-nums text-[#1b2b3c]">{year}</span>
              <button
                type="button"
                onClick={() => setYear((y) => y + 1)}
                aria-label="Next year"
                className="flex h-5 w-5 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-[#008CFF]"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-[#1b2b3c]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sorted.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-[#6e8499]">
              No holidays on file for {year}.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
              {sorted.map((h, i) => {
                const d = new Date(h.date);
                const day     = d.toLocaleDateString("en-IN", { day: "2-digit", timeZone: "UTC" });
                const month   = d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }).toUpperCase();
                const weekday = d.toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
                const isOptional = h.type === "optional";
                const t = tintFor(i);
                return (
                  <div key={h.id} className="flex items-start gap-3 rounded-lg py-2.5 px-1 transition-colors hover:bg-slate-50">
                    <div className={`flex h-[60px] w-[60px] flex-shrink-0 flex-col items-center justify-center rounded-lg ring-1 ring-inset ${t.bg} ${t.month.replace("text-", "ring-").replace("-600", "-100")}`}>
                      <span className={`text-[9.5px] font-bold uppercase tracking-[0.14em] leading-none ${t.month}`}>{month}</span>
                      <span className={`mt-1 text-[20px] font-bold leading-none ${t.digit}`}>{day}</span>
                    </div>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13.5px] font-semibold text-[#1b2b3c] leading-snug">{h.name}</p>
                        {isOptional && (
                          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#415a73]">
                            Floater Leave
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11.5px] text-[#6e8499]">{weekday}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function HRHomePage() {
  const { data: session } = useSession();
  const user    = session?.user as any;
  const isAdmin = isHRAdmin(user);
  const canCompose = isAdmin;

  const monthKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; })();

  const { data: analyticsData }    = useSWR("/api/hr/analytics", fetcher);
  const { data: boardData }        = useSWR("/api/hr/attendance/board", fetcher);
  const { data: balanceData = [] } = useSWR("/api/hr/leaves/balance", fetcher);
  // Poll every 3s so a machine (biometric) scan reflects on the clock widget
  // near-instantly without a manual reload. SWR dedupes in-flight requests and
  // pauses polling when the tab is hidden, so it only refetches while the
  // dashboard is actually open.
  const { data: myData }           = useSWR(`/api/hr/attendance?month=${monthKey}`, fetcher, { refreshInterval: 3_000 });
  const { data: profile }          = useSWR("/api/hr/profile", fetcher);
  const { data: myWfh = [] }       = useSWR("/api/hr/attendance/wfh?view=my", fetcher);

  // Live push: open an SSE stream so a biometric-machine scan reflects on the
  // clock widget the INSTANT it's recorded (no 3s wait). On each push we just
  // revalidate the attendance data. EventSource auto-reconnects if dropped;
  // the 3s poll above is the fallback when the stream isn't available.
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/realtime/attendance");
    es.addEventListener("punch", () => { mutate(`/api/hr/attendance?month=${monthKey}`); });
    return () => es.close();
  }, [monthKey]);

  // displayName/email/photo used by the merged global header (src/components/layout/header.tsx).

  const workLoc  = (profile?.employeeProfile?.workLocation || "office").toLowerCase();
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasWfhToday = Array.isArray(myWfh) && myWfh.some((r: any) =>
    (r.status === "approved" || r.status === "pending") && typeof r.date === "string" && r.date.slice(0, 10) === todayKey
  );
  const isRemoteMode = workLoc === "remote" || workLoc === "hybrid" || hasWfhToday;
  // Clock button label flips to "WFH …" when the user is working from home
  // today (a remote/hybrid worker, or an approved WFH for today).
  const clockInLabel         = isRemoteMode ? "WFH Clock-In"  : "Web Clock-In";
  const clockOutLabel        = isRemoteMode ? "WFH Clock-Out" : "Web Clock-Out";
  const confirmClockOutLabel = isRemoteMode ? "Confirm WFH Clock-Out" : "Confirm Web Clock-Out";

  const [hh, setHh] = useState("--");
  const [mm, setMm] = useState("--");
  const [ss, setSs] = useState("--");
  const [ap, setAp] = useState("AM");
  const [dl, setDl] = useState("");
  const [feedTab, setFT]  = useState<"post"|"poll"|"praise">("post");
  const [bTab, setBTab]   = useState<"birthday"|"anniversary"|"joinees">("birthday");
  const [postText, setPost] = useState("");
  const [orgTab, setOrgTab] = useState<"org"|"team">("org");
  const [submittingPost, setSubmittingPost] = useState(false);
  // Expanded composer state — controls the Post / Poll / Praise editor card
  // that opens when the user clicks the collapsed prompt.
  const [composerOpen, setComposerOpen] = useState(false);
  const [postMedia, setPostMedia]       = useState<string | null>(null); // base64 data URL
  const [emojiOpen, setEmojiOpen]       = useState(false);
  const [postScope, setPostScope]       = useState<"org"|"team">("org");
  // Mention picker — null = closed, "" or "abc" = open with that filter prefix.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const composerTextareaRef             = useRef<HTMLTextAreaElement>(null);

  // Poll-tab state — question + variable-length option list + meta flags.
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions]   = useState<string[]>(["", "", ""]);
  const [pollExpires, setPollExpires]   = useState("");
  const [pollNotify, setPollNotify]     = useState(false);
  const [pollAnon, setPollAnon]         = useState(false);

  // Praise-tab state — recipient picker + description (reuses postText) +
  // badge + project + multiple attachments.
  const [praiseToId, setPraiseToId]     = useState<number | null>(null);
  const [praiseToName, setPraiseToName] = useState("");
  const [praiseSearch, setPraiseSearch] = useState("");
  const [praiseSearchOpen, setPraiseSearchOpen] = useState(false);
  const [praiseBadge, setPraiseBadge]   = useState<string | null>(null);
  const [praiseBadgeOpen, setPraiseBadgeOpen] = useState(false);
  const [praiseProject, setPraiseProject] = useState("");
  const [praiseFiles, setPraiseFiles]   = useState<{ name: string; data: string }[]>([]);

  // Badge palette — id, label, ring color (background of the circle), and the
  // lucide icon that sits inside. The praise renderer can map id → visual
  // later; here we just pass the label as the stored badge string.
  type Badge = { id: string; label: string; bg: string; Icon: any };
  const PRAISE_BADGES: Badge[] = [
    { id: "top-performer",       label: "Top Performer",        bg: "#f5b800", Icon: Star          },
    { id: "leadership-impact",   label: "Leadership Impact",    bg: "#3b82f6", Icon: ShieldCheck   },
    { id: "values-champion",     label: "Values Champion",      bg: "#ef4444", Icon: Lightbulb     },
    { id: "insightful-investigator", label: "Insightful Investigator", bg: "#22c1c3", Icon: SearchIcon },
    { id: "master-storyteller",  label: "Master Storyteller",   bg: "#9b8aca", Icon: BookOpen      },
    { id: "editing-maestro",     label: "Editing Maestro",      bg: "#ec7e85", Icon: Scissors      },
    { id: "team-champion",       label: "Team Champion",        bg: "#73c043", Icon: UsersIcon     },
    { id: "rising-star",         label: "Rising star",          bg: "#f5b800", Icon: Sparkles      },
    { id: "channel-champion",    label: "Channel Champion",     bg: "#a78bfa", Icon: Flame         },
    { id: "narrative-ninja",     label: "Narrative Ninja",      bg: "#22c1c3", Icon: Swords        },
    { id: "innovation-catalyst", label: "Innovation Catalyst",  bg: "#9b6bd1", Icon: Zap           },
    { id: "production-powerhouse", label: "Production Powerhouse", bg: "#5b8def", Icon: Camera     },
    { id: "creative-genius",     label: "Creative Genius",      bg: "#5b8def", Icon: PenTool       },
    { id: "analytics-ace",       label: "Analytics Ace",        bg: "#a8a29e", Icon: BarChart3Icon },
    { id: "extra-mile-champion", label: "Extra Mile Champion",  bg: "#ec4899", Icon: Rocket        },
  ];

  const activeBadge = praiseBadge ? PRAISE_BADGES.find(b => b.id === praiseBadge || b.label === praiseBadge) : null;

  // Award medal silhouette: a coloured disc with a faint ring + two angled
  // cloth ribbons trailing below it. The icon is overlaid in white. Pure CSS
  // — no SVG / images — so it scales cleanly at any size.
  const BadgeMedal = ({ b, size = 56 }: { b: Badge; size?: number }) => {
    const ribbonW = Math.round(size * 0.32);
    const ribbonH = Math.round(size * 0.55);
    const iconSize = Math.round(size * 0.42);
    return (
      <span
        className="relative inline-flex flex-shrink-0 items-start justify-center"
        style={{ width: size, height: Math.round(size * 1.32) }}
      >
        {/* Left ribbon */}
        <span
          className="absolute"
          style={{
            background: b.bg,
            width: ribbonW,
            height: ribbonH,
            left: Math.round(size * 0.18),
            top: Math.round(size * 0.55),
            clipPath: "polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 70%)",
            opacity: 0.85,
            transform: "rotate(-8deg)",
            transformOrigin: "top center",
          }}
        />
        {/* Right ribbon */}
        <span
          className="absolute"
          style={{
            background: b.bg,
            width: ribbonW,
            height: ribbonH,
            right: Math.round(size * 0.18),
            top: Math.round(size * 0.55),
            clipPath: "polygon(0 0, 100% 0, 100% 70%, 50% 100%, 0 60%)",
            opacity: 0.85,
            transform: "rotate(8deg)",
            transformOrigin: "top center",
          }}
        />
        {/* Disc with ring */}
        <span
          className="absolute flex items-center justify-center rounded-full text-white shadow-[0_4px_10px_rgba(15,23,42,0.12)]"
          style={{
            background: b.bg,
            width: size,
            height: size,
            top: 0,
            boxShadow: `inset 0 0 0 3px rgba(255,255,255,0.18), 0 4px 10px rgba(15,23,42,0.10)`,
          }}
        >
          <b.Icon size={iconSize} strokeWidth={2.2} />
        </span>
      </span>
    );
  };

  // Lazy-loaded employee directory for the @ mention picker. Pulled once when
  // the composer opens — cached by SWR for the rest of the session.
  const { data: directory = [] } = useSWR<any[]>(
    composerOpen ? "/api/hr/employees?isActive=true" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  const insertAtCursor = (snippet: string) => {
    const el = composerTextareaRef.current;
    if (!el) { setPost(t => t + snippet); return; }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const next  = el.value.slice(0, start) + snippet + el.value.slice(end);
    setPost(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Detect whether the cursor is inside an active @-token and update the
  // mention-picker filter to match. Called from textarea onChange.
  const handleComposerChange = (value: string) => {
    setPost(value);
    const el = composerTextareaRef.current;
    if (!el) { setMentionQuery(null); return; }
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const m = before.match(/@([\w.\-]*)$/); // @ followed by word chars / dot / hyphen
    setMentionQuery(m ? m[1] : null);
  };

  // Replace the current @-token with `@Name` (no spaces in handle).
  const insertMention = (name: string) => {
    const el = composerTextareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? postText.length;
    const before = postText.slice(0, cursor);
    const after  = postText.slice(cursor);
    const m = before.match(/@([\w.\-]*)$/);
    const handle = `@${name.replace(/\s+/g, "")} `;
    const newBefore = m ? before.slice(0, before.length - m[0].length) + handle : before + handle;
    const next = newBefore + after;
    setPost(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = newBefore.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const mentionMatches = mentionQuery !== null
    ? (directory as any[])
        .filter((u) => (u.name || "").toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 6)
    : [];

  // Client-side image compressor — runs in the browser via <canvas>.
  // Downscales any side > maxDim and re-encodes as JPEG at the
  // tightest quality that keeps the base64 payload under the cap.
  // Server cap is 3 MB encoded (validated in /api/hr/engage/posts);
  // we target 2.5 MB so a base64 padding bump doesn't push us over.
  //
  // The function ALWAYS resolves with a data URL — if compression
  // fails (very old browser, broken file), it falls back to the
  // raw FileReader result and lets the server's 3 MB gate decide.
  async function compressImage(file: File, opts?: { maxDim?: number; maxBytes?: number }): Promise<string> {
    const maxDim   = opts?.maxDim   ?? 1920;
    const maxBytes = opts?.maxBytes ?? 2.5 * 1024 * 1024;
    const dataUrl  = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(typeof fr.result === "string" ? fr.result : "");
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
    if (!dataUrl) return "";

    // If it's already under the cap AND ≤ maxDim, skip the canvas
    // round-trip entirely (PNG with text/logo would re-encode worse
    // as JPEG; small images don't need it).
    if (dataUrl.length <= maxBytes && file.size <= maxBytes) return dataUrl;

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload  = () => resolve(i);
        i.onerror = () => reject(new Error("Image decode failed"));
        i.src     = dataUrl;
      });
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      let w = Math.round(img.width  * scale);
      let h = Math.round(img.height * scale);
      let quality = 0.85;
      let out = "";
      for (let i = 0; i < 6; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) break;
        ctx.drawImage(img, 0, 0, w, h);
        out = canvas.toDataURL("image/jpeg", quality);
        if (out.length <= maxBytes) break;
        // Step down: drop quality first, then dimensions.
        if (quality > 0.55) quality -= 0.10;
        else { w = Math.round(w * 0.85); h = Math.round(h * 0.85); }
      }
      return out || dataUrl;
    } catch {
      return dataUrl;
    }
  }

  const handlePickImage = async (file: File | null) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert("Image too large (max 25 MB)."); return; }
    try {
      const compressed = await compressImage(file);
      if (!compressed) { alert("Couldn't read that image. Try a different file."); return; }
      setPostMedia(compressed);
      const origKb = Math.round(file.size / 1024);
      const newKb  = Math.round(compressed.length / 1024);
      if (newKb < origKb * 0.85) {
        console.log(`[post] compressed image from ${origKb}KB → ${newKb}KB`);
      }
    } catch (e: any) {
      alert(e?.message || "Failed to process image.");
    }
  };

  const resetComposer = () => {
    setPost("");
    setPostMedia(null);
    setEmojiOpen(false);
    setComposerOpen(false);
    setMentionQuery(null);
    setPollQuestion("");
    setPollOptions(["", "", ""]);
    setPollExpires("");
    setPollNotify(false);
    setPollAnon(false);
    setPraiseToId(null);
    setPraiseToName("");
    setPraiseSearch("");
    setPraiseSearchOpen(false);
    setPraiseBadge(null);
    setPraiseBadgeOpen(false);
    setPraiseProject("");
    setPraiseFiles([]);
  };

  const addPraiseFile = async (file: File | null) => {
    if (!file) return;
    if (praiseFiles.length >= 5) { alert("Max 5 attachments."); return; }
    if (file.size > 25 * 1024 * 1024) { alert(`"${file.name}" is over 25 MB.`); return; }
    try {
      // Compress images; non-image files pass through as-is (PDF,
      // doc, etc.) — same upper bound, just no canvas re-encode.
      const data = file.type.startsWith("image/")
        ? await compressImage(file)
        : await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload  = () => resolve(typeof fr.result === "string" ? fr.result : "");
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(file);
          });
      if (!data) { alert(`Couldn't read "${file.name}".`); return; }
      setPraiseFiles(prev => [...prev, { name: file.name, data }]);
    } catch (e: any) {
      alert(e?.message || `Failed to read "${file.name}".`);
    }
  };

  const praiseMatches = praiseSearchOpen
    ? (directory as any[])
        .filter((u) => (u.name || "").toLowerCase().includes(praiseSearch.toLowerCase()))
        .slice(0, 8)
    : [];
  // Index into the upcoming-holidays list for the green Holidays card. The
  // arrows below cycle through this; resets if the list shrinks.
  const [holidayIdx, setHolidayIdx] = useState(0);
  const [showHolidaysModal, setShowHolidaysModal] = useState(false);

  // "Other ▾" quick-action modal — opened in-place from the dropdown so the
  // user stays on /dashboard/hr/home instead of being routed to the
  // attendance page.
  const [otherForm, setOtherForm] = useState<LeaveRequestKind | null>(null);
  const { data: leaveTypesData = [] } = useSWR(`/api/hr/admin/leave-types`, fetcher);
  // Drop balance-only types (e.g. legacy non-applicable buckets) and
  // restricted-admin types (e.g. Carry Over Leave) when the viewer
  // isn't CEO / HR Manager / developer — server enforces the same
  // gate so a hand-crafted POST still 403s.
  const canApplyRestricted = canApplyRestrictedLeave(user);
  const otherLeaveTypes: { id: number; name: string }[] = Array.isArray(leaveTypesData)
    ? leaveTypesData
        .filter((t: any) => t.applicable !== false)
        .filter((t: any) => t.adminOnly !== true || canApplyRestricted)
        .map((t: any) => ({ id: t.id, name: t.name }))
    : [];
  const otherTitle: Record<LeaveRequestKind, string> = {
    wfh:        "Request Work From Home",
    on_duty:    "Apply for On Duty",
    half_day:   "Apply for Half Day",
    leave:      "Request Leave",
    regularize: "Request Regularization",
  };
  const otherPolicy: Record<LeaveRequestKind, string | undefined> = {
    wfh:        "As per the policy, only Mon–Sat are considered for WFH. Clock in is necessary on WFH days to avoid being marked absent.",
    on_duty:    "On-duty time counts as working hours. Log the purpose clearly — your manager will review before approval.",
    half_day:   "Half day leave covers either the first (9:00 AM – 2:00 PM) or second half (2:00 PM – 6:00 PM) of the day.",
    leave:      undefined,
    regularize: "Use this to fix missed punches or incorrect clock-in/out. Attach a clear reason so approval is quick.",
  };

  // Browser geolocation permission state. Attendance needs location, so we
  // check this up-front and show a banner + disable the clock-in button when
  // permission has been permanently blocked. "prompt" is fine — clicking the
  // button will trigger the browser's native ask.
  type LocPerm = "granted" | "denied" | "prompt" | "unsupported" | "checking";
  const [locPerm, setLocPerm] = useState<LocPerm>("checking");
  // `clockingIn` lives in the useClockActions hook (declared later).
  // Two-step clock-out confirmation — mirrors the Attendance page. First
  // click splits the single Clock-Out into a red Confirm + dark Cancel
  // pair so a stray click doesn't end the day. Auto-cancels after 6s.
  const [confirmingClockOut, setConfirmingClockOut] = useState(false);
  // `clockingOut` is owned by the useClockActions hook now (real
  // in-flight tracking, retry-capable). Pulled into scope below.

  // Mobile clock-in is policy-blocked by default (attendance is meant
  // to be captured from the workstation). Two escape hatches:
  //   1. Developers (`DEVELOPER_EMAILS` in env → `user.isDeveloper`) —
  //      stable bypass for the platform team; tied to identity, not
  //      knowledge of a URL trick.
  //   2. `?desktop=13` query param — short-term emergency override for
  //      anyone whose laptop is unavailable. NOT a secret; treat it
  //      as "I know what I'm doing, let me through" and follow up
  //      with regularization if used.
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  useEffect(() => {
    const isDev = user?.isDeveloper === true;
    // isDesktopBypassActive() persists `?desktop=13` for the session, so the
    // override survives navigation that drops the query string.
    setIsMobileDevice(detectMobileDevice() && !isDev && !isDesktopBypassActive());
  }, [user]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      setLocPerm("unsupported");
      return;
    }
    let status: PermissionStatus | null = null;
    const check = () => {
      navigator.permissions.query({ name: "geolocation" as PermissionName })
        .then((s) => {
          if (status) status.onchange = null;
          status = s;
          setLocPerm(s.state as LocPerm);
          s.onchange = () => setLocPerm(s.state as LocPerm);
        })
        .catch(() => setLocPerm("unsupported"));
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      window.removeEventListener("focus", check);
      if (status) status.onchange = null;
    };
  }, []);

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
      const dateParts = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).formatToParts(d).reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
      setDl(`${dateParts.weekday || "Thu"}, ${dateParts.day || "23"} ${dateParts.month || "Apr"} ${dateParts.year || "2026"}`);
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
  // Upcoming holidays (today + future), sorted ascending by date so the arrow
  // navigation walks the calendar in order. `upcoming[0]` is today's holiday
  // when one exists (filter is `>= today`).
  const upcoming = allHolidays
    .filter((h) => h.date >= istTodayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  // Keep the index inside bounds when the list size changes (data refresh,
  // year rollover, etc.).
  useEffect(() => {
    if (holidayIdx >= upcoming.length && upcoming.length > 0) setHolidayIdx(0);
  }, [upcoming.length, holidayIdx]);
  const todayRec = myData?.todayRecord;
  // Mobile clock-in/out is blocked by default; ANY On-Duty for today
  // (pending / partially_approved / approved) unlocks it — same rule
  // the server enforces. Pre-computed server-side in
  // /api/hr/attendance so the UI doesn't need a second fetch. The
  // legacy `hasApprovedOdToday` field is read as a fallback during
  // the deploy window in case an old client receives a fresh server
  // response (or vice-versa).
  const hasOdToday: boolean = !!(myData?.hasOdToday ?? myData?.hasApprovedOdToday);
  const mobileBlocked = isMobileDevice && !hasOdToday;
  const todayLoc = parseAttLoc(todayRec?.location);
  // Pull the caller's profile so we can read the department — used to label
  // the "team" tab + "Posting to" option with the actual team name (e.g.
  // "NB_Artificial Intelligence") instead of a hardcoded fallback.
  const { data: meProfile } = useSWR<any>("/api/hr/profile", fetcher);
  const myDepartment: string = (meProfile?.employeeProfile?.department || "").trim();
  // Hide "Work From Home" from remote/hybrid workers — it's already
  // their default mode, applying for it would be a no-op.
  const myWorkLocation = String(meProfile?.employeeProfile?.workLocation ?? "office").toLowerCase();
  const canApplyWfh = myWorkLocation !== "remote" && myWorkLocation !== "hybrid";
  const teamScope: string = user?.teamCapsule || myDepartment || "team";
  const teamLabel: string = myDepartment || user?.teamCapsule || "My team";
  const postsUrl = orgTab === "org"
    ? "/api/hr/engage/posts"
    : `/api/hr/engage/posts?scope=${encodeURIComponent(teamScope)}`;
  const { data: posts = [], isLoading: postsLoading } = useSWR(postsUrl, fetcher, {
    // Keep the previous tab's posts on screen while the new tab's
    // payload is in flight — otherwise switching Organization ↔
    // My team flashes the empty state for one frame before the
    // spinner appears. SWR returns the still-cached `data` and
    // flips `isValidating`, so we render the spinner overlay only
    // when there's no data yet for the active URL.
    keepPreviousData: true,
  });
  const { data: announcements = [] } = useSWR("/api/hr/announcements", fetcher);

  // Clock-in / clock-out actions are owned by a shared hook. See
  // src/lib/hr/use-clock-actions.ts for the full rationale — short
  // version: handles re-entry guards, network-error surfacing, and
  // one automatic retry on transient failures, all of which were
  // silently dropped in the previous inline handlers (hence the
  // "click 3-4 times before it works" reports).
  const { clockIn, clockOut, clockingIn, clockingOut, error: clockError, clearError: clearClockError, pulseGate, dismissPulseGate, exitSurveyGate, dismissExitSurveyGate, desktopGate, dismissDesktopGate } = useClockActions({
    mutateKeys: [`/api/hr/attendance?month=${monthKey}`],
  });
  // Auto-collapse the Confirm/Cancel pair after 6s of idle.
  useEffect(() => {
    if (!confirmingClockOut || clockingOut) return;
    const t = setTimeout(() => setConfirmingClockOut(false), 6000);
    return () => clearTimeout(t);
  }, [confirmingClockOut, clockingOut]);
  // Viewer brand for the leave/wfh lists below. Default behavior:
  // brand-scoped — CEOs see only their own brand (Kunal → YT Labs,
  // Nikit → NB Media), HR Members see only their brand, every
  // employee sees only their brand. Legacy users with no businessUnit
  // bucket as NB Media (parent-brand default).
  //
  // Two tiers get a full cross-brand view via canViewAllBrands():
  //   • Developers
  //   • role="hr_manager" (Tanvi etc.) — distinct from orgLevel-only HR
  // For those viewers the filter becomes a no-op so the On Leave Today
  // / Working Remotely / Clocked-In lists show everyone in the org.
  const viewerBrand: "NB Media" | "YT Labs" =
    user?.businessUnit === "YT Labs" ? "YT Labs" : "NB Media";
  const seeAllBrands = canViewAllBrands(user as any);
  const matchesViewerBrand = (u: any): boolean =>
    seeAllBrands || (u.businessUnit || "NB Media") === viewerBrand;
  // On Leave Today — anyone whose attendance record is `on_leave` today, OR
  // who has an applied leave (pending / partially_approved / approved) that
  // covers today. Approval isn't required to appear here — the moment a
  // colleague applies, they show up so others know they intend to be away.
  // Brand-scoped to the viewer.
  const onLeave = (boardData?.board || []).filter((u: any) =>
    (u.status === "on_leave" || u.leaveToday === true) && matchesViewerBrand(u)
  );
  // Split clocked-in employees by their actual location mode (from Attendance.location JSON).
  const clockedIn = (boardData?.board || []).filter((u: any) => (u.status === "present" || u.status === "late") && matchesViewerBrand(u));
  // Working Remotely — ONLY employees who explicitly applied for WFH
  // today. Permanent remote / hybrid folks who clock in from home as
  // their default mode show up under the "Remote Clock-in" filter on
  // the attendance dashboard, not here. This card flags exception
  // cases: office-default people who took WFH for a day. Brand-scoped.
  const remote = ((boardData?.board || []) as any[]).filter((u: any) => u.wfhToday === true && matchesViewerBrand(u));
  // Show only leave types the user actually has a quota or in-flight
  // activity for — drop fully-zero rows (no quota AND nothing used or
  // pending) so the card doesn't render six "0 days" tiles for every
  // catalogue entry the user was auto-seeded with.
  const balances = (balanceData as any[]).filter((b) => {
    if (!b.leaveType) return false;
    const total = parseFloat(b.totalDays   ?? "0");
    const used  = parseFloat(b.usedDays    ?? "0");
    const pend  = parseFloat(b.pendingDays ?? "0");
    return total > 0 || used > 0 || pend > 0;
  });
  // `upcoming` already includes today (filter is `>= today`), so indexing
  // into it covers both "today's holiday" and the future ones the arrows
  // page through.
  const activeHoliday = upcoming[holidayIdx] ?? null;
  const canPrevHoliday = holidayIdx > 0;
  const canNextHoliday = holidayIdx < upcoming.length - 1;

  const submitPost = async () => {
    let content: string;
    let praiseTo: number | null = null;
    let media: string | null = null;
    if (feedTab === "poll") {
      const cleanOptions = pollOptions.map(o => o.trim()).filter(Boolean);
      if (!pollQuestion.trim()) { alert("Add a poll question first."); return; }
      if (cleanOptions.length < 2) { alert("Polls need at least two options."); return; }
      content = `__POLL__${JSON.stringify({
        question: pollQuestion.trim(),
        options: cleanOptions,
        expiresAt: pollExpires || null,
        notify: pollNotify,
        anonymous: pollAnon,
      })}`;
    } else if (feedTab === "praise") {
      if (!praiseToId) { alert("Pick the employee you're praising."); return; }
      if (!postText.trim()) { alert("Add a short reason for the praise."); return; }
      // EngagePost has no badge/project/multi-attachment columns. Encode the
      // extras inline with a sentinel so the feed can render them later.
      content = `__PRAISE__${JSON.stringify({
        text: postText.trim(),
        badge: praiseBadge,
        project: praiseProject || null,
        attachments: praiseFiles.map(f => ({ name: f.name, data: f.data })),
      })}`;
      praiseTo = praiseToId;
      media = praiseFiles[0]?.data ?? null;
    } else {
      if (!postText.trim() && !postMedia) return;
      content = postText.trim();
      media = postMedia;
    }
    setSubmittingPost(true);
    // Wrap in try/catch + check res.ok so the composer doesn't
    // silently clear on a failure. Previously: fetch threw or
    // returned 4xx, code immediately reset + mutated → user
    // thought it posted but nothing landed (the silent-fail bug
    // HR Manager + HR were hitting). Now we surface the server
    // error AND keep their draft so they can fix + retry.
    try {
      const res = await fetch("/api/hr/engage/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          type: feedTab,
          scope: postScope === "org" ? "org" : teamScope,
          mediaUrl: media,
          praiseToId: praiseTo,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const fallback =
          res.status === 403 ? "You don't have permission to post." :
          res.status === 413 ? "Image is too large (max 3 MB)." :
          res.status === 400 ? "Content or image is required." :
                               `Post failed (${res.status}).`;
        alert(j?.error || fallback);
        return;                              // keep composer state on failure
      }
      resetComposer();
      mutate(postsUrl);
    } catch (e: any) {
      alert(e?.message || "Network error — post not sent. Check your connection and try again.");
    } finally {
      setSubmittingPost(false);
    }
  };

  return (
    <PageShell className={`h-[calc(100vh-68px)] overflow-hidden flex flex-col ${C.page}`}>
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          className="pointer-events-none absolute inset-y-0 -right-[120px] hidden w-full max-w-[600px] lg:block"
          style={{
            backgroundImage: "url('/image_1b069270.png')",
            backgroundRepeat: "no-repeat",
            backgroundSize: "contain",
            backgroundPosition: "right bottom",
            mixBlendMode: "darken",
          }}
          aria-hidden="true"
        />
        {/* DecorativeTree kept for legacy references but no longer rendered. */}

        {/* Grid columns flex with viewport: at our 1280px laptop floor
            (content area = 1188px after the 92px sidebar) the right
            column shrinks instead of overflowing. Inner padding scales
            with breakpoint so we don't burn 80px of horizontal space at
            the floor. The banner spans both columns and uses
            max-w instead of a fixed 1180px so it shrinks with the
            content area on smaller laptops. */}
        <div className="grid w-full flex-1 min-h-0 gap-5 px-4 py-3 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)] xl:grid-rows-[auto_minmax(0,1fr)] xl:justify-start xl:px-6 2xl:px-10">
          <WelcomeBanner name={user?.name} />

          <div className="no-scrollbar space-y-3 min-h-0 overflow-y-auto pr-1">
            {/* Employee's own strike score out of the limit (e.g. 2 / 3) —
                sits ABOVE Quick Access so it's the first thing they see.
                Self-only via /api/me/strike-score. */}
            <StrikeScoreCard />

            <p className={`pb-0.5 pt-1 text-[13px] font-semibold leading-none ${C.t1}`}>
              Quick Access
            </p>

            <div
              className="relative overflow-hidden rounded-[2px] px-[14px] py-[11px] shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
              style={{ background: "#9b8aca", color: "#ffffff" }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className="text-[11px] leading-none"
                  style={{ color: "rgba(255,255,255,0.86)", WebkitTextFillColor: "rgba(255,255,255,0.86)" }}
                  suppressHydrationWarning
                >
                  Time Today - {dl}
                </span>
                <Link
                  href="/dashboard/hr/attendance"
                  className="text-[11px] font-medium transition-colors hover:opacity-100"
                  style={{ color: "rgba(255,255,255,0.78)", WebkitTextFillColor: "rgba(255,255,255,0.78)" }}
                >
                  View All
                </Link>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <p
                  className="text-[9px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: "rgba(255,255,255,0.68)", WebkitTextFillColor: "rgba(255,255,255,0.68)" }}
                >Current Time</p>
                <span
                  className="rounded-[2px] bg-black/12 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
                >
                  {(todayLoc.mode ? todayLoc.mode : isRemoteMode ? "remote" : "office").toUpperCase()}
                </span>
              </div>

              {/* Location permission warning — attendance requires location. */}
              {!todayRec?.clockIn && locPerm === "denied" && (
                <div className="mb-2 rounded-[3px] border border-red-300 bg-red-50 px-2 py-1.5 text-[10.5px] leading-snug text-red-700">
                  <strong>Location access blocked.</strong> Enable location in your browser settings to clock in.
                </div>
              )}
              {!todayRec?.clockIn && locPerm === "unsupported" && (
                <div className="mb-2 rounded-[3px] border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10.5px] leading-snug text-amber-700">
                  <strong>Location unavailable.</strong> Your browser can't share location. Clock-in needs location.
                </div>
              )}

              {/* Clock display + action buttons on the same row, vertically
                  centered. The clock keeps its inner purple box; buttons sit
                  parallel to it on the right. */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-[1px] rounded-[2px] bg-[#6d5f99]/68 px-[10px] py-[9px]">
                  <span
                    suppressHydrationWarning
                    style={{
                      fontFamily: "var(--font-mulish)",
                      fontSize: 30,
                      letterSpacing: "-0.03em",
                      fontWeight: 400,
                      lineHeight: 1,
                      color: "#ffffff",
                    }}
                  >
                    {hh}:{mm}
                  </span>
                  <div className="flex flex-col gap-[1px] pt-[2px]">
                    <span
                      suppressHydrationWarning
                      style={{
                        fontFamily: "var(--font-mulish)",
                        fontSize: 13,
                        lineHeight: 1,
                        color: "rgba(255,255,255,0.9)",
                      }}
                    >
                      :{ss}
                    </span>
                    <span
                      suppressHydrationWarning
                      style={{
                        fontFamily: "var(--font-mulish)",
                        fontSize: 11,
                        lineHeight: 1,
                        color: "rgba(255,255,255,0.88)",
                      }}
                    >
                      {ap}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {!todayRec?.clockIn ? (
                    // ── Not clocked in yet → green "Web Clock-In" ──
                    //    Colors + labels match the attendance page: always
                    //    green regardless of office/remote mode.
                    <div className="flex flex-col items-center gap-1">
                      {clockError && (
                        <div className="flex items-start gap-1 max-w-[340px] px-2 py-1 rounded bg-rose-500/20 border border-rose-500/40 text-rose-100 text-[10px] leading-tight">
                          <span className="flex-1">{clockError.message}</span>
                          <button onClick={clearClockError} className="shrink-0 text-rose-200 hover:text-white" aria-label="Dismiss">✕</button>
                        </div>
                      )}
                      <button
                        onClick={mobileBlocked ? undefined : clockIn}
                        disabled={clockingIn || mobileBlocked}
                        className="h-[24px] whitespace-nowrap rounded-[3px] px-3.5 bg-green-600 text-white text-[11px] font-semibold transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: "linear-gradient(180deg, #22c55e 0%, #15803d 100%)",
                          boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px -4px rgba(34,197,94,0.55), 0 1px 2px rgba(0,0,0,0.08)",
                        }}
                      >
                        {clockingIn ? "Getting location…" : clockInLabel}
                      </button>
                      {mobileBlocked && (
                        <span className="text-center text-[9.5px] leading-tight text-white/70">
                          Only accessible on Laptop &amp; Desktop
                        </span>
                      )}
                      {isMobileDevice && hasOdToday && (
                        <span className="text-center text-[9.5px] leading-tight text-emerald-300">
                          Mobile enabled — On-Duty today
                        </span>
                      )}
                    </div>
                  ) : !todayRec?.clockOut ? (
                    // ── Clocked in, no clock-out yet → red "Web Clock-Out"
                    //    with two-step confirm (matches the attendance page).
                    confirmingClockOut ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={async () => {
                            // Hook owns the in-flight guard.
                            await clockOut();
                            setConfirmingClockOut(false);
                          }}
                          disabled={clockingOut || mobileBlocked}
                          className="h-[24px] whitespace-nowrap rounded-[3px] px-3 bg-red-600 text-white text-[11px] font-semibold transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            background: "linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)",
                            boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px -4px rgba(239,68,68,0.55), 0 1px 2px rgba(0,0,0,0.08)",
                          }}
                        >
                          {clockingOut ? "Clocking out…" : confirmClockOutLabel}
                        </button>
                        <button
                          onClick={() => setConfirmingClockOut(false)}
                          disabled={clockingOut}
                          className="h-[24px] whitespace-nowrap rounded-[3px] px-2.5 bg-slate-700 text-white text-[11px] font-semibold transition hover:brightness-110 disabled:opacity-50"
                          style={{
                            background: "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
                            boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 2px rgba(0,0,0,0.10)",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        {clockError && (
                          <div className="flex items-start gap-1 max-w-[340px] px-2 py-1 rounded bg-rose-500/20 border border-rose-500/40 text-rose-100 text-[10px] leading-tight">
                            <span className="flex-1">{clockError.message}</span>
                            <button onClick={clearClockError} className="shrink-0 text-rose-200 hover:text-white" aria-label="Dismiss">✕</button>
                          </div>
                        )}
                        <button
                          onClick={mobileBlocked ? undefined : () => setConfirmingClockOut(true)}
                          disabled={mobileBlocked}
                          className="h-[24px] whitespace-nowrap rounded-[3px] px-3.5 bg-red-600 text-white text-[11px] font-semibold transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            background: "linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)",
                            boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px -4px rgba(239,68,68,0.55), 0 1px 2px rgba(0,0,0,0.08)",
                          }}
                        >
                          {clockOutLabel}
                        </button>
                        {mobileBlocked && (
                          <span className="text-center text-[9.5px] leading-tight text-white/70">
                            Only accessible on Laptop &amp; Desktop
                          </span>
                        )}
                        {isMobileDevice && hasOdToday && (
                          <span className="text-center text-[9.5px] leading-tight text-emerald-300">
                            Mobile enabled — On-Duty today
                          </span>
                        )}
                      </div>
                    )
                  ) : (
                    // ── Clocked out (multi-session day) → another Web
                    //    Clock-In so users on break can resume. Same green
                    //    gradient as the first clock-in.
                    <div className="flex flex-col items-center gap-1">
                      {clockError && (
                        <div className="flex items-start gap-1 max-w-[340px] px-2 py-1 rounded bg-rose-500/20 border border-rose-500/40 text-rose-100 text-[10px] leading-tight">
                          <span className="flex-1">{clockError.message}</span>
                          <button onClick={clearClockError} className="shrink-0 text-rose-200 hover:text-white" aria-label="Dismiss">✕</button>
                        </div>
                      )}
                      <button
                        onClick={mobileBlocked ? undefined : clockIn}
                        disabled={clockingIn || mobileBlocked}
                        className="h-[24px] whitespace-nowrap rounded-[3px] px-3.5 bg-green-600 text-white text-[11px] font-semibold transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: "linear-gradient(180deg, #22c55e 0%, #15803d 100%)",
                          boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px -4px rgba(34,197,94,0.55), 0 1px 2px rgba(0,0,0,0.08)",
                        }}
                      >
                        {clockingIn ? "Getting location…" : clockInLabel}
                      </button>
                      {mobileBlocked && (
                        <span className="text-center text-[9.5px] leading-tight text-white/70">
                          Only accessible on Laptop &amp; Desktop
                        </span>
                      )}
                      {isMobileDevice && hasOdToday && (
                        <span className="text-center text-[9.5px] leading-tight text-emerald-300">
                          Mobile enabled — On-Duty today
                        </span>
                      )}
                    </div>
                  )}
                  <OtherActionsMenu onSelect={(kind) => setOtherForm(kind)} showWfh={canApplyWfh} />
                </div>
              </div>
            </div>

            <div className={`${C.card} p-3.5`}>
              <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>Inbox</p>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f2ecff]">
                  <Mail className="h-[18px] w-[18px] text-[#8a79da]" />
                </div>
                <div>
                  <p className={`text-[13px] font-semibold ${C.t1}`}>Good job!</p>
                  <p className={`mt-0.5 text-[11.5px] ${C.t3}`}>You have no pending actions</p>
                </div>
              </div>
            </div>

            {/* Holidays card — vertical layout matching the approved design:
                a type-coloured date chip + full date, a one-line description,
                NATIONAL / OFFICE-CLOSED badges, and a draining countdown ring
                with a gift accent + arrows to browse upcoming holidays. */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 shadow-[0_2px_12px_-2px_rgba(15,23,42,0.08)]">
              {(() => {
                const d = activeHoliday ? new Date(activeHoliday.date) : null;
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const days = d ? Math.round((d.getTime() - today.getTime()) / 86_400_000) : null;
                const typeColor = activeHoliday ? (HOLIDAY_TYPE_COLOR[activeHoliday.type] ?? "#008CFF") : "#008CFF";
                const officeClosed = activeHoliday ? activeHoliday.type !== "optional" : false;
                return (
                  <>
                    {/* soft identity glow in the holiday-type colour */}
                    <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full" style={{ background: `radial-gradient(closest-side, ${typeColor}26, transparent)` }} />

                    <div className="relative p-3">
                      {/* Header */}
                      <div className="mb-2.5 flex items-center justify-between">
                        <span className="text-[12.5px] font-bold uppercase tracking-[0.14em]" style={{ color: typeColor }}>Holidays</span>
                        <button type="button" onClick={() => setShowHolidaysModal(true)} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500 transition hover:text-slate-800">
                          View all Holidays
                          <CalendarDays className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {activeHoliday && d ? (
                        <div className="space-y-2">
                          {/* Top row: date chip + name/date, with the countdown
                              ring tucked into the right-hand blank space. */}
                          <div className="flex items-start gap-3">
                            <div className="relative flex h-[62px] w-[58px] flex-shrink-0 flex-col items-center justify-center overflow-hidden rounded-2xl shadow-sm" style={{ background: typeColor }}>
                              <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                              <span className="relative text-[21px] font-bold leading-none" style={{ color: "#ffffff" }}>{d.toLocaleDateString("en-IN", { day: "2-digit", timeZone: "UTC" })}</span>
                              <span className="relative mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.92)" }}>{d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}</span>
                              <span className="relative text-[8px] font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.78)" }}>{d.toLocaleDateString("en-IN", { year: "numeric", timeZone: "UTC" })}</span>
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <p className="text-[15.5px] font-bold leading-tight text-slate-800" title={activeHoliday.name}>{activeHoliday.name}</p>
                              <p className="mt-1 text-[12px] text-slate-500">
                                {d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
                              </p>
                            </div>

                            {/* Browse arrows (the countdown number was removed per request) */}
                            {upcoming.length > 1 && (
                              <div className="flex flex-shrink-0 items-center gap-1.5 self-center">
                                <button type="button" onClick={() => setHolidayIdx((i) => Math.max(0, i - 1))} disabled={!canPrevHoliday} aria-label="Previous holiday" className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent">
                                  <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button type="button" onClick={() => setHolidayIdx((i) => Math.min(upcoming.length - 1, i + 1))} disabled={!canNextHoliday} aria-label="Next holiday" className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent">
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Badges */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ background: `${typeColor}14`, color: typeColor }}>
                              <Globe className="h-3 w-3" />
                              {HOLIDAY_TYPE_LABEL[activeHoliday.type] ?? "PUBLIC HOLIDAY"}
                            </span>
                            {officeClosed && (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                <Building2 className="h-3 w-3" />
                                Corporate office closed
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className={`text-[13px] ${C.t3}`}>No upcoming holidays on file.</p>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className={`${C.card} p-3.5`}>
              <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>
                On Leave Today
                {onLeave.length > 0 && (
                  <span className={`ml-1.5 text-[11px] font-normal ${C.t3}`}>({onLeave.length})</span>
                )}
              </p>
              {onLeave.length > 0 ? (
                // Show EVERY user with a leave application covering today —
                // regardless of whether they've clocked in. Half-day users
                // who came in for the working half still belong here because
                // they're partially absent. flex-wrap handles overflow into
                // multiple rows when the day's list is long.
                <div className="flex flex-wrap gap-3">
                  {onLeave.map((u: any) => (
                    <div key={u.id} className="flex flex-col items-center gap-1">
                      <span className="relative inline-flex">
                        <Av name={u.name} url={u.profilePictureUrl} size={36} />
                        <LeaveBadge kind={u.leaveKind ?? "full"} />
                      </span>
                      <span className={`w-11 truncate text-center text-[9.5px] ${C.t3}`}>{u.name.split(" ")[0]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-[11.5px] ${C.t3}`}>No one on leave today</p>
              )}
            </div>

            <div className={`${C.card} p-3.5`}>
              <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>Working Remotely</p>
              {remote.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {remote.slice(0, 4).map((u: any) => (
                    <div key={u.id} className="flex flex-col items-center gap-1">
                      <span className="relative inline-flex">
                        <Av name={u.name} url={u.profilePictureUrl} size={36} />
                        {/* Home-icon badge — marks this avatar as a Work-From-Home user. */}
                        <span
                          aria-label={u.wfhKind === "first_half" ? "Working from home (first half)" : u.wfhKind === "second_half" ? "Working from home (second half)" : "Working from home"}
                          title={u.wfhKind === "first_half" ? "Working from home (first half)" : u.wfhKind === "second_half" ? "Working from home (second half)" : "Working from home"}
                          className="absolute -top-0.5 -right-0.5 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[#008CFF] ring-2 ring-white shadow-sm"
                        >
                          <HomeIcon size={10} strokeWidth={2.5} color="#ffffff" />
                        </span>
                      </span>
                      <span className={`w-11 truncate text-center text-[9.5px] ${C.t3}`}>{u.name.split(" ")[0]}</span>
                      {(u.wfhKind === "first_half" || u.wfhKind === "second_half") && (
                        <span className="text-[8.5px] font-semibold leading-none text-[#008CFF]">
                          {u.wfhKind === "first_half" ? "1st half" : "2nd half"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-[11.5px] ${C.t3}`}>No one working remotely</p>
              )}
            </div>

            <div className={`${C.card} p-4`}>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className={`text-[13px] font-semibold ${C.t1}`}>Leave Balances</p>
                  {balances.length > 0 && (
                    <p className={`mt-0.5 text-[10.5px] uppercase tracking-[0.08em] ${C.t3}`}>
                      Available across all types
                    </p>
                  )}
                </div>
                <Link href="/dashboard/hr/leaves" className="text-[11px] font-medium text-[#0891b2] hover:underline">
                  View all
                </Link>
              </div>
              {balances.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-y-5 gap-x-3 place-items-center py-2">
                    {balances.map((b: any) => {
                      const total = parseFloat(b.totalDays ?? "0");
                      const used  = parseFloat(b.usedDays ?? "0");
                      const pend  = parseFloat(b.pendingDays ?? "0");
                      const avail = Math.max(0, total - used - pend);
                      // Cyan ring tone (cyan-500) — same family as the
                      // reference screenshot but kept on the dashboard's
                      // light surface so it stays in the existing theme.
                      const color = "#06b6d4";
                      return (
                        <div key={b.id} className="flex w-full flex-col items-center">
                          <BalanceRing avail={avail} total={total > 0 ? total : 1} color={color} size={76} />
                          <p className={`mt-2.5 max-w-full truncate text-center text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-700 dark:text-slate-200`}>
                            {b.leaveType?.name}
                          </p>
                          <p className={`mt-0.5 text-center text-[10.5px] tabular-nums text-slate-400 dark:text-slate-500`}>
                            {avail} of {total > 0 ? total : "—"} {total === 1 ? "day" : "days"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className={`mt-2 border-t ${C.div} pt-3`}>
                    <Link
                      href="/dashboard/hr/leaves"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_2px_8px_-2px_rgba(8,145,178,0.5)] transition-all hover:-translate-y-px hover:bg-cyan-700 hover:shadow-[0_5px_14px_-3px_rgba(8,145,178,0.6)]"
                    >
                      <CalendarDays className="h-3.5 w-3.5 opacity-90" />
                      Request Leave
                    </Link>
                  </div>
                </>
              ) : (
                <div>
                  <p className={`text-[11.5px] ${C.t3}`}>No leave balances configured</p>
                  <div className="mt-3 flex flex-col gap-2">
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#0891b2] hover:underline">
                      Request Leave
                    </Link>
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#0891b2] hover:underline">
                      View All Balances
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <QuickLinksCard />
          </div>

          <div className="no-scrollbar min-w-0 min-h-0 overflow-y-auto pr-1">
            <div className="max-w-[700px] space-y-3">
              <ChannelViewsTargetsPanel />
              <div className={`${C.card} overflow-hidden`}>
                <div className={`flex items-center border-b ${C.div} px-1`}>
                  {[["org", "Organization"], ["team", teamLabel]].map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setOrgTab(k as "org" | "team")}
                      className={`px-4 py-2.5 text-[12.5px] font-medium border-b-2 -mb-px transition-colors ${
                        orgTab === k ? "border-[#008CFF] text-[#008CFF]" : `border-transparent ${C.t2}`
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {canCompose && (
                <div className="px-4 pt-3 pb-4">
                  {!composerOpen ? (
                    /* Collapsed prompt — clicking opens the full composer */
                    <button
                      type="button"
                      onClick={() => { setComposerOpen(true); setPostScope(orgTab); requestAnimationFrame(() => composerTextareaRef.current?.focus()); }}
                      className={`w-full rounded-[6px] border ${C.div} bg-transparent px-4 py-3 text-left text-[13px] ${C.t3} transition hover:bg-[#f7f9fc]`}
                    >
                      Write your post here and mention your peers
                    </button>
                  ) : (
                    <div className={`rounded-[6px] border ${C.div} p-3`}>
                      {/* Type tabs */}
                      <div className={`mb-3 flex items-center gap-0.5 border-b ${C.div} pb-2`}>
                        {[
                          { k: "post", l: "Post", I: <Send style={{ width: 14, height: 14 }} /> },
                          { k: "poll", l: "Poll", I: <BarChart2 style={{ width: 14, height: 14 }} /> },
                          { k: "praise", l: "Praise", I: <Award style={{ width: 14, height: 14 }} /> },
                        ].map(({ k, l, I }) => (
                          <button
                            key={k}
                            onClick={() => setFT(k as "post" | "poll" | "praise")}
                            className={`flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[12px] font-medium transition-colors ${
                              feedTab === k ? "bg-[#f5f9ff] text-[#008CFF]" : `${C.t2} hover:bg-[#f7f9fc]`
                            }`}
                          >
                            {I}
                            {l}
                          </button>
                        ))}
                      </div>

                      {feedTab === "praise" ? (
                        /* ── Praise form ────────────────────────────────── */
                        <div className="space-y-5">
                          {/* Search Employee */}
                          <div className="relative">
                            <input
                              type="text"
                              value={praiseToName ? praiseToName : praiseSearch}
                              onChange={(e) => {
                                setPraiseSearch(e.target.value);
                                setPraiseSearchOpen(true);
                                if (praiseToName) { setPraiseToName(""); setPraiseToId(null); }
                              }}
                              onFocus={() => setPraiseSearchOpen(true)}
                              placeholder="Search Employee"
                              className={`w-full border-b ${C.div} bg-transparent px-1 pb-2 text-[14px] ${C.t1} placeholder-[#8a96a8] focus:border-[#008CFF] focus:outline-none`}
                            />
                            {praiseToName ? (
                              <button
                                type="button"
                                onClick={() => { setPraiseToName(""); setPraiseToId(null); setPraiseSearch(""); setPraiseSearchOpen(true); }}
                                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[#5c6b80] hover:bg-[#f5f9ff]"
                                aria-label="Clear"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {praiseSearchOpen && praiseMatches.length > 0 ? (
                              <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-[6px] border border-[#dbe4ed] bg-white shadow-lg overflow-hidden">
                                <ul className="max-h-[220px] overflow-y-auto">
                                  {praiseMatches.map((u: any) => (
                                    <li key={u.id}>
                                      <button
                                        type="button"
                                        onClick={() => { setPraiseToId(u.id); setPraiseToName(u.name); setPraiseSearchOpen(false); setPraiseSearch(""); }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-[#f5f9ff]"
                                      >
                                        {u.profilePictureUrl ? (
                                          <img src={u.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full object-cover" />
                                        ) : (
                                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f1fc] text-[10px] font-semibold text-[#0f4e93]">
                                            {(u.name || "?").trim().slice(0, 1).toUpperCase()}
                                          </span>
                                        )}
                                        <span className="truncate font-medium">{u.name}</span>
                                        {u.employeeProfile?.designation ? (
                                          <span className="ml-auto truncate text-[11px] text-slate-400">
                                            {u.employeeProfile.designation}
                                          </span>
                                        ) : null}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>

                          {/* Reason */}
                          <textarea
                            value={postText}
                            onChange={(e) => setPost(e.target.value)}
                            placeholder="What did the employee do to deserve the praise"
                            rows={3}
                            className={`w-full resize-none bg-transparent text-[13px] ${C.t2} placeholder-[#8a96a8] focus:outline-none`}
                          />

                          {/* Select badge */}
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setPraiseBadgeOpen(v => !v)}
                              className="flex h-14 w-14 items-center justify-center rounded-md border border-[#dbe4ed] bg-[#f7f9fc] hover:bg-[#eef4fb]"
                              title={activeBadge?.label || "Pick a badge"}
                            >
                              {activeBadge ? (
                                <BadgeMedal b={activeBadge} size={36} />
                              ) : (
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#cbd5e1]">
                                  <Award className="h-4 w-4 text-white" />
                                </span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPraiseBadgeOpen(v => !v)}
                              className="text-[13px] font-semibold text-[#008CFF] hover:text-[#0070d4]"
                            >
                              {activeBadge ? `Change badge — ${activeBadge.label}` : "Select badge"}
                            </button>
                          </div>
                          {praiseBadgeOpen ? (
                            <div className="rounded-[6px] border border-[#dbe4ed] bg-white p-4">
                              <div className="grid grid-cols-4 gap-y-5 gap-x-3">
                                {PRAISE_BADGES.map((b) => {
                                  const selected = praiseBadge === b.id;
                                  return (
                                    <button
                                      key={b.id}
                                      type="button"
                                      onClick={() => { setPraiseBadge(b.id); setPraiseBadgeOpen(false); }}
                                      title={b.label}
                                      className={`flex flex-col items-center gap-1.5 rounded-md p-2 transition ${
                                        selected ? "bg-[#e8f1fc] ring-1 ring-[#0f4e93]" : "hover:bg-[#f5f9ff]"
                                      }`}
                                    >
                                      <BadgeMedal b={b} size={50} />
                                      <span className="mt-1 max-w-[88px] text-center text-[10.5px] font-medium leading-tight text-slate-700">
                                        {b.label}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {/* Project (optional) */}
                          <div className="space-y-1.5">
                            <p className={`text-[12.5px] font-semibold ${C.t2}`}>Projects (optional)</p>
                            <input
                              type="text"
                              value={praiseProject}
                              onChange={(e) => setPraiseProject(e.target.value)}
                              placeholder="Select project"
                              className={`w-full rounded-[4px] border ${C.div} bg-transparent px-3 py-2 text-[13px] ${C.t2} placeholder-[#8a96a8] focus:border-[#008CFF] focus:outline-none focus:ring-1 focus:ring-[#008CFF]/20`}
                            />
                          </div>

                          {/* Add Attachment */}
                          <div className="space-y-2">
                            <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] font-semibold text-[#008CFF] hover:text-[#0070d4]">
                              <Paperclip className="h-4 w-4" />
                              Add Attachment
                              <span title="Max 5 files, 10 MB each" className="text-[#8a96a8]">
                                <Info className="h-3.5 w-3.5" />
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                  const files = Array.from(e.target.files ?? []);
                                  files.forEach(addPraiseFile);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                            <p className="text-[11.5px] text-[#8a96a8]">Max number of files allowed is 5</p>
                            {praiseFiles.length > 0 ? (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {praiseFiles.map((f, i) => (
                                  <div key={i} className="relative">
                                    <img src={f.data} alt={f.name} className="h-16 w-16 rounded-[4px] border border-[#dbe4ed] object-cover" />
                                    <button
                                      type="button"
                                      onClick={() => setPraiseFiles(prev => prev.filter((_, idx) => idx !== i))}
                                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#1f2937] text-white shadow-md hover:bg-[#0f172a]"
                                      aria-label="Remove"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : feedTab === "poll" ? (
                        /* ── Poll form ─────────────────────────────────── */
                        <div className="space-y-4">
                          <input
                            type="text"
                            value={pollQuestion}
                            onChange={(e) => setPollQuestion(e.target.value)}
                            placeholder="What this poll is about"
                            className={`w-full border-b ${C.div} bg-transparent px-1 pb-2 text-[14px] ${C.t1} placeholder-[#8a96a8] focus:border-[#008CFF] focus:outline-none`}
                          />

                          <div className="space-y-2">
                            {pollOptions.map((opt, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => {
                                    setPollOptions(prev => prev.map((o, idx) => idx === i ? e.target.value : o));
                                  }}
                                  placeholder="Add option here"
                                  className={`flex-1 rounded-[4px] border ${C.div} bg-transparent px-3 py-2 text-[13px] ${C.t2} placeholder-[#8a96a8] focus:border-[#008CFF] focus:outline-none focus:ring-1 focus:ring-[#008CFF]/20`}
                                />
                                <button
                                  type="button"
                                  onClick={() => setPollOptions(prev => prev.filter((_, idx) => idx !== i))}
                                  disabled={pollOptions.length <= 2}
                                  title={pollOptions.length <= 2 ? "Need at least 2 options" : "Remove this option"}
                                  className="flex h-8 w-8 items-center justify-center rounded text-[#5c6b80] transition hover:bg-[#fef2f2] hover:text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#5c6b80]"
                                  aria-label="Remove option"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => setPollOptions(prev => [...prev, ""])}
                            className="text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0070d4]"
                          >
                            + Add Option
                          </button>

                          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-[12.5px] ${C.t3}`}>Poll Expires on</span>
                              <DateField
                                value={pollExpires}
                                onChange={setPollExpires}
                              />
                            </div>
                            <label className={`flex items-center gap-2 text-[12.5px] ${C.t2} cursor-pointer`}>
                              <input
                                type="checkbox"
                                checked={pollNotify}
                                onChange={(e) => setPollNotify(e.target.checked)}
                                className="h-4 w-4 accent-[#008CFF]"
                              />
                              Notify employees
                            </label>
                            <label className={`flex items-center gap-2 text-[12.5px] ${C.t2} cursor-pointer`}>
                              <input
                                type="checkbox"
                                checked={pollAnon}
                                onChange={(e) => setPollAnon(e.target.checked)}
                                className="h-4 w-4 accent-[#008CFF]"
                              />
                              Anonymous poll
                            </label>
                          </div>
                        </div>
                      ) : (
                      <>
                      {/* Textarea */}
                      <div className="relative">
                        <textarea
                          ref={composerTextareaRef}
                          value={postText}
                          onChange={(e) => handleComposerChange(e.target.value)}
                          onKeyUp={(e) => {
                            // Re-evaluate mention state on cursor moves so arrow-keys / mouse-clicks
                            // correctly close the picker when the cursor leaves an @-token.
                            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
                              handleComposerChange(postText);
                            }
                            if (e.key === "Escape") setMentionQuery(null);
                          }}
                          placeholder="Write your post here and mention your peers"
                          rows={5}
                          className={`w-full resize-none bg-transparent text-[13.5px] ${C.t2} placeholder-[#8a96a8] focus:outline-none`}
                          style={{ caretColor: "#008CFF" }}
                        />

                        {mentionQuery !== null && mentionMatches.length > 0 ? (
                          <div className="absolute left-0 top-full z-30 mt-1 w-[260px] rounded-[6px] border border-[#dbe4ed] bg-white shadow-lg overflow-hidden">
                            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-[#eef2f6]">
                              Tag a teammate
                            </p>
                            <ul className="max-h-[220px] overflow-y-auto">
                              {mentionMatches.map((u: any) => (
                                <li key={u.id}>
                                  <button
                                    type="button"
                                    onClick={() => insertMention(u.name)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-[#f5f9ff]"
                                  >
                                    {u.profilePictureUrl ? (
                                      <img src={u.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full object-cover" />
                                    ) : (
                                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f1fc] text-[10px] font-semibold text-[#0f4e93]">
                                        {(u.name || "?").trim().slice(0, 1).toUpperCase()}
                                      </span>
                                    )}
                                    <span className="truncate font-medium">{u.name}</span>
                                    {u.employeeProfile?.designation ? (
                                      <span className="ml-auto truncate text-[11px] text-slate-400">
                                        {u.employeeProfile.designation}
                                      </span>
                                    ) : null}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>

                      {/* Image preview */}
                      {postMedia ? (
                        <div className="relative mt-2 inline-block">
                          <img src={postMedia} alt="attachment" className="max-h-40 rounded-[6px] border border-[#dbe4ed]" />
                          <button
                            type="button"
                            onClick={() => setPostMedia(null)}
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#1f2937] text-white shadow-md hover:bg-[#0f172a]"
                            aria-label="Remove image"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}

                      {/* Action row — @ mention, photo, emoji */}
                      <div className="mt-3 flex items-center gap-2 relative">
                        <button
                          type="button"
                          onClick={() => {
                            insertAtCursor("@");
                            // Open the picker with an empty filter so the
                            // user sees the full directory immediately.
                            setMentionQuery("");
                          }}
                          title="Mention someone"
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#dbe4ed] text-[#5c6b80] transition hover:bg-[#f5f9ff] hover:text-[#008CFF]"
                        >
                          <AtSign className="h-4 w-4" />
                        </button>
                        <label
                          title="Attach photo"
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#dbe4ed] text-[#5c6b80] transition hover:bg-[#f5f9ff] hover:text-[#008CFF]"
                        >
                          <ImageIcon className="h-4 w-4" />
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => { handlePickImage(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setEmojiOpen(v => !v)}
                          title="Insert emoji"
                          className={`flex h-8 w-8 items-center justify-center rounded-full border border-[#dbe4ed] transition ${
                            emojiOpen ? "bg-[#f5f9ff] text-[#008CFF]" : "text-[#5c6b80] hover:bg-[#f5f9ff] hover:text-[#008CFF]"
                          }`}
                        >
                          <Smile className="h-4 w-4" />
                        </button>

                        {emojiOpen ? (
                          <div className="absolute left-0 top-10 z-20 flex flex-wrap gap-1 rounded-[6px] border border-[#dbe4ed] bg-white p-2 shadow-lg w-[260px]">
                            {["😀","😂","😍","🥳","🙏","👏","👍","🔥","💯","🎉","🚀","💡","✅","❤️","☕","☀️","🌟","🤝","💪","🙌","😊","😎","✨","📌","📷","🎯","💼","📝","🎂","🏆"].map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => { insertAtCursor(e); setEmojiOpen(false); }}
                                className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f9ff] text-[16px]"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      </>
                      )}

                      {/* Bottom row — Posting to + Cancel + Post */}
                      <div className={`mt-4 flex items-center justify-between border-t ${C.div} pt-3`}>
                        <div className="flex items-center gap-2 text-[12px]">
                          <span className={C.t3}>Posting to</span>
                          <SelectField
                            value={postScope}
                            onChange={(v) => setPostScope(v as "org"|"team")}
                            options={[
                              { value: "org",  label: "Organization" },
                              { value: "team", label: teamLabel },
                            ]}
                            className={`h-7 w-[140px] rounded-[4px] border ${C.div} bg-white px-2 text-[12px] ${C.t2}`}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={resetComposer}
                            className={`h-8 rounded-[4px] border ${C.div} px-4 text-[12px] font-medium ${C.t2} hover:bg-[#f7f9fc]`}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={submitPost}
                            disabled={
                              submittingPost ||
                              (feedTab === "poll"
                                ? !pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2
                                : feedTab === "praise"
                                ? !praiseToId || !postText.trim()
                                : !postText.trim() && !postMedia)
                            }
                            className="h-8 rounded-[4px] bg-[#008CFF] px-5 text-[12px] font-semibold text-white transition hover:bg-[#0070d4] disabled:opacity-60"
                          >
                            {submittingPost ? "Posting..." : feedTab === "praise" ? "Send Praise" : "Post"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                )}
              </div>

              {canCompose && (
              <div className={`${C.card} flex items-center justify-between px-4 py-3`}>
                <div className="min-w-0">
                  <p className={`truncate text-[12.5px] ${C.t3}`}>
                    {announcements.length > 0 ? announcements[0].title : "No announcements"}
                  </p>
                </div>
                {isAdmin ? (
                  <Link
                    href="/dashboard/hr/announcements"
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[#008CFF] text-white transition hover:bg-[#0070d4]"
                  >
                    <Plus className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
              )}

              <EventsWidget bTab={bTab} setBTab={setBTab} C={C} />

              <div className="space-y-3">
                {posts.length > 0 ? (
                  posts.slice(0, 4).map((post: any) => <FeedPostCard key={post.id} post={post} sessionUser={user} />)
                ) : postsLoading ? (
                  // Loading state — keeps the visual area populated
                  // while the feed payload is in flight, instead of
                  // flashing the empty state before posts arrive.
                  <div className={`${C.card} px-5 py-10 flex flex-col items-center justify-center gap-3`}>
                    <span
                      className="inline-block h-8 w-8 rounded-full border-[3px] border-[#008CFF]/20 border-t-[#008CFF] animate-spin"
                      role="status"
                      aria-label="Loading posts"
                    />
                    <p className={`text-[12px] ${C.t3}`}>Loading posts…</p>
                  </div>
                ) : analyticsData ? (
                  <div className={`${C.card} px-5 py-8 text-center`}>
                    <p className="text-[13px] font-semibold text-[#334455]">No posts yet</p>
                    <p className={`mt-1 text-[12px] ${C.t3}`}>Your home feed is ready and will fill as soon as the team starts posting.</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick-action modal opened from the "Other ▾" menu — kept here so
          submitting WFH / On-Duty / Leave doesn't pull the user away
          from /dashboard/hr/home. */}
      {otherForm && (
        <LeaveRequestForm
          kind={otherForm}
          title={otherTitle[otherForm]}
          policyText={otherPolicy[otherForm]}
          leaveTypes={otherLeaveTypes}
          onClose={() => setOtherForm(null)}
        />
      )}
      {showHolidaysModal && (
        <HolidaysModal
          initialYear={thisYear}
          onClose={() => setShowHolidaysModal(false)}
        />
      )}
      <PulseGateModal gate={pulseGate} onDismiss={dismissPulseGate} />
      <ExitSurveyGateModal gate={exitSurveyGate} onDismiss={dismissExitSurveyGate} />
      <DesktopGateModal gate={desktopGate} onDismiss={dismissDesktopGate} />
    </PageShell>
  );
}
