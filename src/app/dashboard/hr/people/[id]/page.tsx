"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getUserRoleLabel } from "@/lib/user-role-options";
import { parseAttLoc, type AttLoc } from "@/lib/attendance-location";
import {
  brandFromBusinessUnit,
  jobTitleSource,
  departmentSource,
} from "@/lib/company-taxonomy";
import {
  Mail, Phone, MapPin, Briefcase, Calendar, Building2, IdCard, FileText, Laptop,
  Users as UsersIcon, Home, Search, User as UserIcon, ShieldCheck, X, Plus, Pencil,
  MoreVertical, UserMinus, TreePine, Coffee, ClipboardList,
  CheckCircle2, AlertCircle, Circle, Upload as UploadIcon, Eye, Trash2, RefreshCw,
  Clock, ArrowDownLeft, ArrowUpRight, LogOut, ChevronDown, History,
} from "lucide-react";
import { DatePicker as SharedDatePicker } from "@/components/ui/date-picker";
import { DateField } from "@/components/ui/date-field";
import PerformancePlanModal from "@/components/hr/PerformancePlanModal";
import { isHRAdmin as canViewAsHRAdmin, canViewSalary, canViewEmployeeDocuments, canViewExitBadge } from "@/lib/access";
import { isGaganDeveloper } from "@/lib/gagan-dev";
import ExitSurveyTab from "@/components/hr/ExitSurveyTab";
import { can } from "@/lib/permissions/can";
import { isWorkingDay } from "@/lib/hr/shift-working-days";
import EditProfilePanel from "@/components/hr/EditProfilePanel";
import EmployeeFinancesPanel from "@/components/hr/EmployeeFinancesPanel";
import EmployeeLeavePanel from "@/components/hr/EmployeeLeavePanel";
import SelectField from "@/components/ui/SelectField";
import HandoffSection from "@/components/hr/HandoffSection";
import type { PickerUser } from "@/components/hr/EmployeePicker";

// "Edit Profile" is HR-admin-only — the canonical place to update any
// employee field, including salary (which the panel embeds). The
// previous standalone "Salary" tab and the inline edit pencils on the
// Profile tab have been retired so there's exactly one canonical edit
// surface.
const TABS = ["About", "Profile", "Job", "Attendance", "Documents", "Assets", "Finances", "Exit Survey", "Edit Profile"] as const;
type Tab = typeof TABS[number];

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;

const prettyEmp = (v: string | null | undefined) => v ? v.replace(/_/g, " ") : null;

function Initials({ name, size = 80, fontSize = 22 }: { name?: string; size?: number; fontSize?: number }) {
  const initials = (name ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      style={{ width: size, height: size, fontSize }}
      className="rounded-full bg-gradient-to-br from-[#008CFF] to-[#0066cc] text-white font-bold flex items-center justify-center"
    >
      {initials}
    </div>
  );
}

function Avatar({ url, name, size = 80, fontSize = 22 }: { url?: string | null; name?: string; size?: number; fontSize?: number }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return (
    <img
      src={url}
      alt={name ?? ""}
      style={{ width: size, height: size }}
      className="rounded-full object-cover"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
  return <Initials name={name} size={size} fontSize={fontSize} />;
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon size={14} className="text-slate-400 mt-0.5 shrink-0" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.1em] text-slate-500 font-semibold">{label}</p>
        <p className="text-[13px] text-slate-800 truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

// Inline dropdown for HR to assign / change a user's leave policy. Reads
// the active policy list via SWR, PATCHes the user PUT endpoint on change,
// and triggers a revalidation of the person page so the leave-balances UI
// reflects the new assignment immediately.
function LeavePolicyAssignment({
  userId,
  current,
}: {
  userId: number;
  current: { id: number; name: string; isActive: boolean } | null;
}) {
  const { data: policies = [] } = useSWR<Array<{ id: number; name: string; isActive: boolean }>>(
    "/api/hr/admin/leave-policies",
    fetcher,
  );
  const [saving, setSaving] = useState(false);
  const onChange = async (value: string) => {
    const next = value === "" ? null : Number(value);
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leavePolicyId: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Failed to assign policy.");
        return;
      }
      // Refresh this user's page data and any leave-balance views.
      mutate(`/api/hr/people/${userId}`);
    } finally { setSaving(false); }
  };
  return (
    <div className="mt-3 flex items-center gap-2">
      <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 shrink-0">Leave Policy</label>
      <select
        value={current?.id ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving}
        className="flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30 disabled:opacity-60"
      >
        <option value="">— None (manual balances) —</option>
        {policies.filter((p) => p.isActive || p.id === current?.id).map((p) => (
          <option key={p.id} value={p.id}>{p.name}{!p.isActive ? " (inactive)" : ""}</option>
        ))}
      </select>
      {saving && <span className="text-[11px] text-slate-500">Saving…</span>}
    </div>
  );
}

function Field({ label, value, capitalize = false }: { label: string; value?: string | null; capitalize?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
      <p className="text-[10px] text-slate-500 uppercase tracking-[0.1em] font-semibold mb-1">{label}</p>
      <p className={`text-[13px] text-slate-800 ${capitalize ? "capitalize" : ""}`}>{value || "—"}</p>
    </div>
  );
}

/** Per-employee attendance counting toggle. Flips the
 *  EmployeeNotificationPolicy.attendanceEnabled field via the existing
 *  PUT /api/hr/admin/notification-policy endpoint. Payroll continues to
 *  count the cycle as normal (payrollEnabled stays TRUE) — so disabled
 *  attendance = paid notice / paid leave use case.
 *
 *  Visible only to developers + orgLevel="hr_manager" users. The page
 *  gates the JSX before mounting this so we don't need an extra check
 *  here, but the endpoint also enforces isHRAdmin server-side. */
function AttendanceCountingToggle({ userId, userName }: { userId: number; userName: string }) {
  type PolicyRow = {
    id: number;
    attendanceEnabled: boolean;
    payrollEnabled: boolean;
    source: "override" | "default";
    updatedAt: string | null;
    updatedById: number | null;
    updatedByName: string | null;
  };
  const { data, isLoading, mutate: mutatePolicy } = useSWR<{ users: PolicyRow[] }>(
    "/api/hr/admin/notification-policy",
    fetcher,
    { revalidateOnFocus: false },
  );
  const me = data?.users.find((u) => u.id === userId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = me?.attendanceEnabled ?? true;

  const flip = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/hr/admin/notification-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, attendanceEnabled: !enabled }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to toggle (${res.status})`);
      }
      mutatePolicy();
    } catch (e: any) {
      setError(e?.message || "Toggle failed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mb-5 rounded-xl border border-slate-200 bg-white px-5 py-4 text-[12.5px] text-slate-500 inline-flex items-center gap-2">
        <span className="h-4 w-4 border-2 border-slate-300 border-t-[#008CFF] rounded-full animate-spin" />
        Loading attendance settings…
      </div>
    );
  }

  // Pretty-print the audit timestamp in IST short form, e.g.
  // "8 Jun 2026, 3:42 PM".
  const stamp = me?.updatedAt ? new Date(me.updatedAt) : null;
  const stampStr = stamp ? stamp.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }) : null;

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="px-5 py-4 flex items-start justify-between gap-5 flex-wrap">
        {/* Left — label + description */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-semibold text-slate-900">Attendance tracking</h3>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
              enabled
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                : "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-amber-500"}`} />
              {enabled ? "Active" : "Paused"}
            </span>
          </div>
          <p className="text-[12.5px] text-slate-600 leading-snug max-w-2xl">
            {enabled
              ? `Late marks, absent flags, and missed-clockout emails are recorded for ${userName}.`
              : `Late marks, absent flags, and missed-clockout emails are paused for ${userName}. Payroll continues to count this cycle as full pay.`}
          </p>
          {error && (
            <p className="mt-2 text-[12px] text-rose-700 font-medium inline-flex items-center gap-1.5">
              <AlertCircle size={13} /> {error}
            </p>
          )}
        </div>

        {/* Right — proper toggle switch */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={enabled ? "Pause attendance tracking" : "Resume attendance tracking"}
            onClick={flip}
            disabled={saving}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#008CFF]/40 disabled:opacity-50 disabled:cursor-not-allowed ${
              enabled ? "bg-emerald-500" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-1 ring-black/5 transition-transform duration-200 ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
            {saving ? "Saving…" : enabled ? "ON" : "OFF"}
          </span>
        </div>
      </div>

      {/* Audit-trail footer — only when there's an explicit override
          row with updater metadata. Default policies have no
          history so the footer hides. */}
      {me?.source === "override" && stampStr && (
        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center gap-2 text-[11.5px] text-slate-500">
          <Clock size={11} className="text-slate-400" />
          <span>
            Last changed by{" "}
            <span className="font-semibold text-slate-700">
              {me.updatedByName || "Unknown"}
            </span>
            {" "}· {stampStr} IST
          </span>
        </div>
      )}
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const userId = Number(id);
  const { data: user, isLoading, error: userError } = useSWR(`/api/hr/people/${id}`, fetcher);
  // Probation extension modal — opens automatically when the URL
  // carries ?extendProbation=1m | 2m | custom (deep-link from the
  // probationEndingReminderEmail). HR can also open it from the Edit
  // Profile → Job Details modal, but this flow keeps the email →
  // one-click extension path tight.
  const searchParamsObj = useSearchParams();
  const extendParam = searchParamsObj?.get("extendProbation");
  const [probationModalOpen, setProbationModalOpen] = useState(false);
  const [probationModalDefault, setProbationModalDefault] = useState<"1m" | "2m" | "custom" | null>(null);
  useEffect(() => {
    if (!extendParam) return;
    const mode = extendParam === "1m" ? "1m"
              : extendParam === "2m" ? "2m"
              : extendParam === "custom" ? "custom"
              : null;
    if (mode) {
      setProbationModalDefault(mode);
      setProbationModalOpen(true);
    }
    // Strip the param from the URL so refreshing doesn't keep re-
    // opening the modal. Keep other params intact.
    const url = new URL(window.location.href);
    url.searchParams.delete("extendProbation");
    window.history.replaceState({}, "", url.toString());
  }, [extendParam]);
  // Tab state is URL-backed (?tab=edit / ?tab=assets / etc.) so:
  //   1. Refresh keeps you on the tab you were on.
  //   2. Search from the header carries the tab over to the new
  //      person's profile (see header-search.tsx).
  //   3. The tab can be deep-linked / bookmarked.
  // Mapping uses lowercase URL tokens; Edit Profile maps to "edit"
  // for brevity. Unknown / missing token falls back to About.
  const TAB_FROM_SLUG: Record<string, Tab> = {
    "about":       "About",
    "profile":     "Profile",
    "job":         "Job",
    "attendance":  "Attendance",
    "documents":   "Documents",
    "assets":      "Assets",
    "finances":    "Finances",
    "exit-survey": "Exit Survey",
    "edit":        "Edit Profile",
  };
  const SLUG_FROM_TAB: Record<Tab, string> = {
    "About":        "about",
    "Profile":      "profile",
    "Job":          "job",
    "Attendance":   "attendance",
    "Documents":    "documents",
    "Assets":       "assets",
    "Finances":     "finances",
    "Exit Survey":  "exit-survey",
    "Edit Profile": "edit",
  };
  const urlTab = (searchParamsObj?.get("tab") ?? "").toLowerCase();
  const [activeTab, setActiveTab] = useState<Tab>(TAB_FROM_SLUG[urlTab] ?? "About");
  // Sync activeTab ⇄ URL. Whenever the user clicks a tab we replace
  // the URL silently (no extra back-button entry). Whenever the URL
  // changes externally — e.g. the header search carried a tab over
  // from another profile — we react and update activeTab to match.
  useEffect(() => {
    const expected = SLUG_FROM_TAB[activeTab];
    const current = (searchParamsObj?.get("tab") ?? "").toLowerCase();
    if (expected === "about" && !current) return; // default tab, leave URL clean
    if (current === expected) return;
    const url = new URL(window.location.href);
    if (expected === "about") url.searchParams.delete("tab");
    else url.searchParams.set("tab", expected);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab, searchParamsObj]);
  // Bring activeTab in line when the URL changes from outside (e.g.
  // header search navigated to a different person but kept ?tab=edit).
  useEffect(() => {
    const slug = (searchParamsObj?.get("tab") ?? "").toLowerCase();
    const next = TAB_FROM_SLUG[slug] ?? "About";
    if (next !== activeTab) setActiveTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsObj?.get("tab")]);
  // Sub-view inside the Attendance tab: the employee's clock-in/log panel,
  // or a read-only mirror of their personal Leave page (balances + history).
  const [attendanceView, setAttendanceView] = useState<"attendance" | "leave">("attendance");
  const [teamQuery, setTeamQuery] = useState("");
  // Header kebab popover (HR-admin only). "Initiate Offboarding" pushes
  // to the offboard page with this user pre-selected; "Apply Leave"
  // jumps to the Attendance tab and tells EmployeeTimePanel to open
  // its existing leave-on-behalf modal via a window event so we don't
  // duplicate the form here.
  const router = useRouter();
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  // Which PROFILE-tab section is currently being edited. null = closed.
  // Each section opens its own focused modal with just that card's fields.
  const [editSection, setEditSection] = useState<null | "primary" | "contact" | "family" | "address" | "identity" | "job" | "time" | "other" | "org" | "bios" | "education">(null);
  useEffect(() => {
    if (!headerMenuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest("[data-hr-header-menu]")) setHeaderMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [headerMenuOpen]);
  const { data: session } = useSession();
  const me = session?.user as any;
  // Manager list for the Edit Profile → Job & Work section. Only fetched
  // when the viewer can actually open that tab to avoid an extra round
  // trip for non-admin viewers.
  // `?all=true` returns every active employee (not just manager-tier
  // roles) so HR can pick any colleague as the reporting line — even
  // if that person isn't tagged as a manager themselves.
  const { data: managers = [] } = useSWR<Array<{ id: number; name: string }>>(
    () => (canViewAsHRAdmin(me) ? "/api/managers?all=true" : null),
    fetcher,
  );
  // Same gate the PUT endpoint enforces — anyone in this set can edit other
  // employees' profiles via the people detail page. Includes ceo / dev /
  // special_access / role=admin / hr_manager.
  const isHRAdmin = canViewAsHRAdmin(me);
  const canEdit = isHRAdmin;
  // Salary visibility (Finances tab, Compensation section inside Edit
  // Profile) is narrower than HR-admin: only HR Manager / CEO / developer.
  // See feedback-salary-visibility memory + canViewSalary in src/lib/access.ts.
  const canSeeSalary = canViewSalary(me);
  // Edit Profile tab is available to the full HR-admin tier — HR
  // Managers / CEO / developer / special_access / role=admin can all
  // open it. (Broadened from developer-only so HR Managers can self-
  // serve profile edits instead of routing every change through
  // engineering. Resolves a parallel commit on origin/main that only
  // included developer + hr_manager — `isHRAdmin` covers both and is
  // the same gate the PUT endpoint enforces.)
  const showEditTab = isHRAdmin || can(me as never, "EDIT_EMPLOYEE_PROFILES");
  // Finances tab: salary tier only — payslips, salary, bonuses are
  // compensation data, not the broader HR-admin surface. See
  // canViewSalary in src/lib/access.ts.
  const showFinancesTab = canSeeSalary;
  // Attendance is sensitive per-employee data — only the owner of the
  // profile, their direct manager (NOT inline manager, to keep scope
  // tight) and the HR-admin tier should see it. Peers don't see each
  // other's daily clock-ins.
  const isSelfView = me?.dbId != null && Number(me.dbId) === userId;
  const isMyManager = user?.manager?.id != null && me?.dbId != null && user.manager.id === Number(me.dbId);
  const showAttendanceTab = isSelfView || isMyManager || isHRAdmin;
  // Documents tab — PAN / Aadhaar / education / employee letters are
  // PII. Strict access per HR policy: only the profile owner, HR
  // team (orgLevel=hr_manager — covers HR Manager + HR team), CEO,
  // and developers. Excludes special_access and role=admin, even
  // though they pass isHRAdmin elsewhere. See canViewEmployeeDocuments
  // in src/lib/access.ts.
  const showDocumentsTab = canViewEmployeeDocuments(me, isSelfView);
  const visibleTabs = TABS.filter((t) => {
    if (t === "Edit Profile" && !showEditTab)       return false;
    if (t === "Finances"     && !showFinancesTab)   return false;
    if (t === "Attendance"   && !showAttendanceTab) return false;
    if (t === "Documents"    && !showDocumentsTab)  return false;
    if (t === "Exit Survey"  && !(canViewExitBadge(me, isSelfView) && (user as any)?.activeExit)) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  // The API returns 403 for anyone who isn't HR / the profile owner / the
  // target's direct manager. Show an explicit access message rather than a
  // misleading "not found" so a member who lands here via a stale link knows
  // it's a permission boundary, not a missing record.
  if (userError) {
    const forbidden = /\b403\b/.test(String((userError as any)?.message ?? ""));
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <ShieldCheck className="h-8 w-8 text-slate-300" />
        <p className="text-slate-600 font-medium">
          {forbidden ? "You don't have access to this profile." : "Couldn't load this profile."}
        </p>
        <Link href="/dashboard/hr/home" className="text-[13px] text-[#008CFF] hover:underline">Back to home</Link>
      </div>
    );
  }
  if (!user) return <p className="text-center text-slate-500 py-20">Employee not found</p>;

  const p = user.profile || {};
  const isActive = user.isActive !== false;
  const directReports = user.directReports ?? [];
  const filteredReports = teamQuery.trim()
    ? directReports.filter((m: any) => m.name?.toLowerCase().includes(teamQuery.trim().toLowerCase()))
    : directReports;

  return (
    <div className="-mx-6 -mt-6 min-h-screen bg-[#f4f7fb]">
      <PerformancePlanModal
        open={pipOpen}
        onClose={() => setPipOpen(false)}
        employee={{
          id: userId,
          name: user.name,
          designation: user.designationLabel || p.designation || null,
          employeeCode: p.employeeId || null,
          managerName: user.manager?.name || null,
        }}
        brand={p.businessUnit === "YT Labs" ? "YT Labs" : "NB Media"}
        defaultReportedById={me?.dbId != null ? Number(me.dbId) : null}
        onSaved={() => mutate(`/api/hr/people/${id}`)}
      />
      {/* ── Identity card — banner + avatar + identity + contact + dept + tabs all in one rounded card ── */}
      <div className="px-6 pt-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.06)]">
          {/* Identity panel — clean white with a thin brand accent stripe up top */}
          <div className="relative">
            {/* Thin brand-blue accent stripe at the very top of the card */}
            <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#0f6ecd] via-[#008CFF] to-[#0f6ecd]" />

            <div className="flex items-center gap-6 px-8 pb-6 pt-8">
              <div className="rounded-full bg-white p-1 shadow-[0_4px_18px_rgba(15,23,42,0.10)] ring-1 ring-slate-200">
                <Avatar url={user.profilePictureUrl} name={user.name} size={104} fontSize={32} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-[24px] font-bold leading-none tracking-[-0.01em] text-slate-800">
                    {user.name}
                  </h1>
                  {/* Live presence — driven by today's Attendance row + any
                      currently-open session. "IN" only when there's an
                      unfinished session right now; "OUT" once today is
                      closed out; "ON LEAVE" if today is a leave day;
                      "OFFLINE" when there's no clock-in for today at all. */}
                  {(() => {
                    const t = user.todayAttendance as
                      | { status: string; clockIn: string | null; clockOut: string | null; hasOpenSession: boolean }
                      | null;
                    let label: string, dot: string, ring: string, bg: string, text: string, title: string;
                    if (t?.status === "on_leave") {
                      label = "On Leave"; dot = "bg-violet-500"; ring = "ring-violet-200"; bg = "bg-violet-50"; text = "text-violet-700"; title = "On leave today";
                    } else if (t && t.hasOpenSession) {
                      label = "In"; dot = "bg-emerald-500"; ring = "ring-emerald-200"; bg = "bg-emerald-50"; text = "text-emerald-700"; title = "Currently clocked in";
                    } else if (t?.clockIn) {
                      label = "Out"; dot = "bg-slate-400"; ring = "ring-slate-200"; bg = "bg-slate-100"; text = "text-slate-600"; title = "Clocked out for the day";
                    } else {
                      label = "Offline"; dot = "bg-slate-300"; ring = "ring-slate-200"; bg = "bg-slate-100"; text = "text-slate-500"; title = "Not clocked in today";
                    }
                    return (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full ${bg} px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${text} ring-1 ring-inset ${ring}`}
                        title={title}
                      >
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
                        {label}
                      </span>
                    );
                  })()}
                  {/* Probation badge (blue) — shown while the new hire is
                      still inside their probation window (probationEndDate
                      today-or-future, not yet confirmed, active, not exiting).
                      probationConfirmedAt may be undefined until the prisma
                      client is regenerated — the `!` check is future-proof. */}
                  {(() => {
                    // The API returns the profile under `profile` (employeeProfile
                    // is destructured + re-keyed), so read it from there — not
                    // user.employeeProfile, which is always undefined here.
                    const ep = (user.profile ?? {}) as any;
                    if (!ep?.probationEndDate || ep.probationConfirmedAt) return null;
                    if (!isActive || user.activeExit) return null;
                    const endMs = new Date(`${String(ep.probationEndDate).slice(0, 10)}T00:00:00Z`).getTime();
                    if (!(endMs >= Date.now() - 86_400_000)) return null; // window already passed
                    const endLabel = new Date(endMs).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
                    return (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200"
                        title={`Probation ends ${endLabel}`}
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                        On Probation
                      </span>
                    );
                  })()}
                  {/* PIP badge (rose) — shown while the employee is on a
                      performance plan: pipStartedAt set, plan not ended
                      (pipEndDate today-or-future, or null = open-ended),
                      active, not exiting. */}
                  {(() => {
                    const ep = (user.profile ?? {}) as any;
                    if (!ep?.pipStartedAt) return null;
                    if (!isActive || user.activeExit) return null;
                    if (ep.pipEndDate) {
                      const endMs = new Date(`${String(ep.pipEndDate).slice(0, 10)}T00:00:00Z`).getTime();
                      if (!(endMs >= Date.now() - 86_400_000)) return null;
                    }
                    return (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-700 ring-1 ring-inset ring-rose-200"
                        title="On Performance Improvement Plan"
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
                        On PIP
                      </span>
                    );
                  })()}
                  {/* Exit-lifecycle badge — "On Notice Period"
                      (amber) while the employee is still serving
                      notice; "Exited" (slate) once HR finalises the
                      status OR the LWD has passed. See
                      exitBadgeState helper inlined below. */}
                  {(() => {
                    const ex = user.activeExit as any;
                    if (!ex) return null;
                    if (!canViewExitBadge(me, isSelfView)) return null;
                    const finalised = ex.status === "exited" || ex.status === "offboarded";
                    const lwdMs = ex.lastWorkingDay ? new Date(`${ex.lastWorkingDay}T00:00:00Z`).getTime() : 0;
                    // Past LWD (UTC date compare) ⇒ effectively exited.
                    const lwdPassed = lwdMs > 0 && Date.now() > lwdMs + 86400000;
                    const isExited = finalised || lwdPassed;
                    return isExited ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700 ring-1 ring-inset ring-slate-300"
                        title={ex.lastWorkingDay ? `Exited on ${ex.lastWorkingDay}` : "Exited"}
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />
                        Exited
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                        title={ex.lastWorkingDay ? `Last working day: ${ex.lastWorkingDay}` : "On notice"}
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                        On Notice Period
                      </span>
                    );
                  })()}
                  {!isActive ? (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-inset ring-slate-200">
                      Inactive
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
                  <Briefcase className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
                  {user.designationLabel || p.designation || getUserRoleLabel(user.role) || "Employee"}
                </p>
                {p.employeeId ? (
                  <p className="mt-1 ml-3 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-slate-400">
                    <IdCard className="h-3 w-3" />
                    {p.employeeId}
                  </p>
                ) : null}
              </div>

              {/* Right-side micro action bar (kebab + status) — keeps the right side from feeling empty */}
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                  isActive
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-slate-50 text-slate-500 ring-slate-200"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                  {isActive ? "Active" : "Inactive"}
                </span>
                {isHRAdmin && (
                  <div className="relative" data-hr-header-menu>
                    <button
                      type="button"
                      onClick={() => setHeaderMenuOpen((v) => !v)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="More"
                      aria-label="More actions"
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="5" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="19" cy="12" r="1.6" />
                      </svg>
                    </button>
                    {headerMenuOpen && (
                      <div
                        data-hr-header-menu
                        className="absolute right-0 top-9 z-30 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setHeaderMenuOpen(false);
                            // Switch to Attendance tab so the leave modal
                            // shows up in the user's flow, then dispatch
                            // a window event the EmployeeTimePanel listens
                            // for. The slight delay lets the tab content
                            // mount before we toggle the modal.
                            setActiveTab("Attendance");
                            // The on-behalf leave modal lives in EmployeeTimePanel,
                            // which only mounts in the "attendance" sub-view — make
                            // sure we're there before dispatching the event.
                            setAttendanceView("attendance");
                            setTimeout(() => {
                              window.dispatchEvent(new CustomEvent("hr:apply-leave-on-behalf"));
                            }, 50);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                        >
                          <TreePine className="h-4 w-4 text-violet-500" />
                          Apply Leave
                        </button>
                        {isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              setHeaderMenuOpen(false);
                              setPipOpen(true);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                          >
                            <ClipboardList className="h-4 w-4 text-amber-500" />
                            Place on Performance Plan
                          </button>
                        )}
                        {isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              setHeaderMenuOpen(false);
                              router.push(`/dashboard/hr/offboard?userId=${userId}`);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                          >
                            <UserMinus className="h-4 w-4 text-rose-500" />
                            Initiate Offboarding
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contact strip */}
          <div className="border-t border-slate-100 px-7 py-4">
            <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5">
              {user.email ? (
                <a href={`mailto:${user.email}`} className="inline-flex items-center gap-2 text-[12.5px] text-[#008CFF] hover:underline">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <span>{user.email}</span>
                </a>
              ) : null}
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 hover:text-[#008CFF]">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  <span>{p.phone}</span>
                </a>
              ) : null}
              {(p.city || p.workLocation) ? (
                <span className="inline-flex items-center gap-2 text-[12.5px] text-slate-700">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <span>{p.city || p.workLocation}</span>
                </span>
              ) : null}
              {p.employeeId ? (
                <span className="inline-flex items-center gap-2 font-mono text-[12.5px] text-slate-700">
                  <IdCard className="h-3.5 w-3.5 text-slate-400" />
                  {p.employeeId}
                </span>
              ) : null}
            </div>
          </div>

          {/* Department strip */}
          <div className="border-t border-slate-100 px-7 py-4">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Business Unit</p>
                {/* Always shows a value — falls back to "NB Media" so
                    the read-only profile never displays "—" for the
                    org's only business unit even if the row's column
                    is still NULL (legacy rows pre-backfill). */}
                <p className="mt-1 text-[13px] font-medium text-slate-800">{user.profile?.businessUnit || user.teamCapsule || "NB Media"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Department</p>
                <p className="mt-1 text-[13px] font-medium text-slate-800">{p.department || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Reporting Manager</p>
                {user.manager ? (
                  <Link href={`/dashboard/hr/people/${user.manager.id}`}
                    className="mt-1 inline-flex items-center gap-2 text-[13px] font-medium text-[#008CFF] hover:underline">
                    <Avatar url={user.manager.profilePictureUrl} name={user.manager.name} size={22} fontSize={9} />
                    <span>{user.manager.name}</span>
                  </Link>
                ) : (
                  <p className="mt-1 text-[13px] font-medium text-slate-400">—</p>
                )}
              </div>
            </div>
          </div>

          {/* Tab bar — sits at the bottom of the identity card */}
          <div className="border-t border-slate-100 px-7">
            <div className="flex gap-0 flex-wrap">
              {visibleTabs.map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`relative px-4 py-3.5 text-[11.5px] font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
                    activeTab === tab
                      ? "text-[#008CFF]"
                      : "text-slate-500 hover:text-slate-800"
                  }`}>
                  {tab}
                  {activeTab === tab && (
                    <>
                      <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#008CFF]" />
                      <span className="pointer-events-none absolute left-1/2 -bottom-[5px] -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#008CFF]" />
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* About sub-tabs (decorative — single Summary view backed by data) */}
        {activeTab === "About" ? (
          <div className="mb-5 flex items-center gap-4 border-b border-slate-200">
            <span className="border-b-2 border-slate-700 pb-2.5 text-[13px] font-semibold text-slate-800">Summary</span>
            <span className="pb-2.5 text-[13px] font-medium text-slate-400">Timeline</span>
            <span className="pb-2.5 text-[13px] font-medium text-slate-400">Wall Activity</span>
          </div>
        ) : null}

        <div className={`grid grid-cols-1 gap-5 ${directReports.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
          <main className="min-w-0 space-y-5">
            {activeTab === "About" && (
              <>
                {/* About card */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold text-slate-800">About</h3>
                    {canEdit && (
                      <button onClick={() => setEditSection("bios")} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#008CFF] hover:underline">
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                  </div>
                  <p className="text-[13px] leading-relaxed text-slate-600 whitespace-pre-wrap">
                    {p.about || `Hi I am ${user.name}.`}
                  </p>

                  <h4 className="mt-5 text-[14px] font-semibold text-slate-800">
                    What I love about my job?
                  </h4>
                  <p className="mt-1 text-[12.5px] text-slate-600 whitespace-pre-wrap">{p.jobLove || "—"}</p>

                  <h4 className="mt-5 text-[14px] font-semibold text-slate-800">
                    My interests and hobbies
                  </h4>
                  <p className="mt-1 text-[12.5px] text-slate-600 whitespace-pre-wrap">{p.hobbies || "N/A"}</p>
                </section>

                {/* Primary Details card */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <h3 className="mb-4 text-[15px] font-semibold text-slate-800">Primary Details</h3>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                    <Compact label="First Name"   value={p.firstName || (user.name?.split(" ")[0] ?? user.name)} />
                    <Compact label="Last Name"    value={p.lastName  || user.name?.split(" ").slice(1).join(" ")} />
                    <Compact label="Gender"       value={p.gender} capitalize />
                    <Compact label="Date of Birth" value={fmtDate(p.dateOfBirth)} />
                    <Compact label="Marital Status" value={p.maritalStatus} capitalize />
                    <Compact label="Physically Handicapped" value={p.physicallyHandicapped} />
                    <Compact label="Nationality"  value={p.nationality} />
                    <Compact label="Blood Group"  value={p.bloodGroup} />
                  </div>
                </section>

                {/* Contact card */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <h3 className="mb-4 text-[15px] font-semibold text-slate-800">Contact</h3>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                    <Compact label="Email"             value={user.email} />
                    <Compact label="Phone"             value={p.phone} />
                    <Compact label="Emergency Phone"   value={p.emergencyPhone} />
                    <div className="col-span-2">
                      <Compact label="Address" value={[p.address, p.city, p.state].filter(Boolean).join(", ")} />
                    </div>
                  </div>
                </section>

                {/* Family card — self-edited by the employee from their
                    own ABOUT tab. Always rendered (with empty-state hint)
                    so HR sees the section the moment they open the
                    profile, not only on the PROFILE sub-tab. */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold text-slate-800">Family</h3>
                    {canEdit && (
                      <button onClick={() => setEditSection("family")} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#008CFF] hover:underline">
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                    <Compact label="Father's Name"  value={p.parentName} />
                    <Compact label="Mother's Name"  value={p.motherName} />
                    <Compact label="Spouse's Name"  value={p.spouseName} />
                    <Compact label="Children"       value={p.childrenNames} />
                  </div>
                  {!(p.parentName || p.motherName || p.spouseName || p.childrenNames) && (
                    <p className="mt-3 text-[11.5px] text-slate-400">
                      Not yet filled in by the employee — they can add these from their own profile (ABOUT tab).
                    </p>
                  )}
                </section>

                {/* Emergency Contact card */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold text-slate-800">Emergency Contact</h3>
                    {canEdit && (
                      <button onClick={() => setEditSection("contact")} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#008CFF] hover:underline">
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                    <Compact label="Relationship"   value={p.emergencyRelationship} capitalize />
                    <Compact label="Contact Phone"  value={p.emergencyPhone} />
                  </div>
                  {!(p.emergencyRelationship || p.emergencyPhone) && (
                    <p className="mt-3 text-[11.5px] text-slate-400">
                      Not yet filled in by the employee.
                    </p>
                  )}
                </section>
              </>
            )}

            {activeTab === "Profile" && (
              <div className="space-y-5">
                {/* ── Primary Details ── */}
                <DetailCard title="Primary Details" onEdit={canEdit ? () => setEditSection("primary") : undefined}>
                  <Grid3>
                    <KV label="HRM No."               value={p.employeeId} />
                    <KV label="First Name"            value={p.firstName ?? user.name?.split(" ")[0]} />
                    <KV label="Middle Name"           value={p.middleName} />
                    <KV label="Last Name"             value={p.lastName ?? user.name?.split(" ").slice(1).join(" ")} />
                    <KV label="Display Name"          value={user.name} />
                    <KV label="Date of Birth"         value={fmtDate(p.dateOfBirth)} />
                    <KV label="Gender"                value={p.gender} capitalize />
                    <KV label="Blood Group"           value={p.bloodGroup} />
                    <KV label="Marital Status"        value={p.maritalStatus} capitalize />
                    <KV label="Nationality"           value={p.nationality} />
                    <KV label="Physically Handicapped" value={p.physicallyHandicapped} />
                  </Grid3>
                </DetailCard>

                {/* ── Contact Details ── */}
                <DetailCard title="Contact Details" onEdit={canEdit ? () => setEditSection("contact") : undefined}>
                  <Grid3>
                    <KV label="Work Email"      value={user.email} />
                    <KV label="Personal Email"  value={p.personalEmail} />
                    <KV label="Mobile Number"   value={p.phone} />
                    <KV label="Work Number"     value={p.workPhone} />
                    <KV label="Home Phone"      value={p.homePhone} />
                    <KV label="Emergency Phone" value={p.emergencyPhone} />
                    <KV label="Emergency Relationship" value={p.emergencyRelationship} capitalize />
                  </Grid3>
                </DetailCard>

                {/* ── Family ── always shown so HR can see the section
                    even when the employee hasn't filled it in yet. The
                    employee self-edits this from their own profile
                    (ABOUT tab). KV renders "—" for missing values. */}
                <DetailCard title="Family" onEdit={canEdit ? () => setEditSection("family") : undefined}>
                  <Grid3>
                    <KV label="Father's Name"   value={p.parentName} />
                    <KV label="Mother's Name"   value={p.motherName} />
                    <KV label="Spouse's Name"   value={p.spouseName} />
                    <KV label="Children"        value={p.childrenNames} />
                  </Grid3>
                  {!(p.parentName || p.motherName || p.spouseName || p.childrenNames) && (
                    <p className="mt-3 text-[11.5px] text-slate-400">
                      Not yet filled in by the employee — they can add these from their own profile (ABOUT tab).
                    </p>
                  )}
                </DetailCard>

                {/* ── Addresses ── */}
                <DetailCard title="Addresses" onEdit={canEdit ? () => setEditSection("address") : undefined}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400 font-semibold mb-1.5">Current Address</p>
                      <p className="text-[13px] text-slate-800 leading-relaxed">
                        {[p.address, p.addressLine2].filter(Boolean).join(", ") || "—"}
                      </p>
                      {(p.city || p.state || p.addressPincode || p.addressCountry) && (
                        <p className="text-[12.5px] text-slate-600 mt-1">
                          {[p.city, p.state, p.addressPincode, p.addressCountry].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400 font-semibold mb-1.5">Permanent Address</p>
                      <p className="text-[13px] text-slate-800 leading-relaxed">
                        {[p.permanentLine1, p.permanentLine2].filter(Boolean).join(", ") || "—"}
                      </p>
                      {(p.permanentCity || p.permanentState || p.permanentPincode || p.permanentCountry) && (
                        <p className="text-[12.5px] text-slate-600 mt-1">
                          {[p.permanentCity, p.permanentState, p.permanentPincode, p.permanentCountry].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                </DetailCard>

                {/* ── Identity Information (PAN / Aadhaar / statutory IDs) ── */}
                <DetailCard title="Identity Information" onEdit={canEdit ? () => setEditSection("identity") : undefined}>
                  <Grid3>
                    <KV label="PAN Number"          value={maskPan(p.panNumber)} />
                    <KV label="Aadhaar Number"      value={maskAadhaar(p.aadhaarNumber)} />
                    <KV label="Aadhaar Enrollment"  value={p.aadhaarEnrollment ? "•••• " + String(p.aadhaarEnrollment).slice(-4) : null} />
                    <KV label="PF Number"           value={p.pfNumber} />
                    <KV label="UAN Number"          value={p.uanNumber} />
                    <KV label="Biometric ID"        value={p.biometricId} />
                  </Grid3>
                  {isHRAdmin ? (
                    <LeavePolicyAssignment userId={user.id} current={user.leavePolicy ?? null} />
                  ) : user.leavePolicy ? (
                    <div className="mt-3 text-[12px] text-slate-500">
                      Leave Policy: <span className="font-semibold text-slate-700">{user.leavePolicy.name}</span>
                    </div>
                  ) : null}
                </DetailCard>
              </div>
            )}

            {activeTab === "Job" && (() => {
              // Keka-style 2-column layout — main job/time/other cards on
              // the left, the Organization sidebar (manager + reports
              // chain) on the right. Theme stays slate-on-white to match
              // the rest of the app.
              // "In Probation" badge — uses probationEndDate to show
              // whether probation is currently active and when it ends.
              // Interns reuse their internship window; everyone else
              // uses the explicit probationEndDate column. "No" once
              // the end date is in the past.
              const probationEnd = p.probationEndDate ? new Date(p.probationEndDate) : null;
              const isOnProbation = p.employmentType === "intern"
                ? true
                : !!(probationEnd && probationEnd.getTime() > Date.now());
              const inProbationLabel = p.employmentType === "intern"
                ? `Yes${p.joiningDate ? ` (${fmtDate(p.joiningDate)}` : ""}${p.internshipEndDate ? ` – ${fmtDate(p.internshipEndDate)})` : ""}`
                : isOnProbation
                  ? `Yes · ends ${fmtDate(p.probationEndDate)}`
                  : "No";
              const contractRange = (p.joiningDate || p.internshipEndDate)
                ? `${p.employmentType === "intern" ? "Internship" : "Employed"}${p.joiningDate ? ` · ${fmtDate(p.joiningDate)}` : ""}${p.internshipEndDate ? ` – ${fmtDate(p.internshipEndDate)}` : ""}`
                : null;
              return (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
                  <div className="space-y-5">
                    {/* ── Job Details ── 9 fields = clean 3×3 grid.
                        Pay Band / Pay Grade / the empty filler row were
                        dropped because we don't track those today. */}
                    <DetailCard title="Job Details" onEdit={canEdit ? () => setEditSection("job") : undefined}>
                      <Grid3>
                        <KV label="Employee Number"        value={p.employeeId} />
                        <KV label="Date of Joining"        value={fmtDate(p.joiningDate)} />
                        <KV label="Job Title — Primary"    value={p.designation} />
                        <KV label="Job Title — Secondary"  value={p.secondaryJobTitle} />
                        <KV label="In Probation"           value={inProbationLabel} />
                        <KV label="Notice Period"          value={p.noticePeriodDays != null ? `${p.noticePeriodDays} Days` : null} />
                        <KV label="Employment Type"        value={p.employmentType === "intern" ? "Intern" : "Regular Employee"} />
                        <KV label="Time Type"              value="Full Time" />
                        <KV label="Contract Status"        value={contractRange} />
                      </Grid3>
                    </DetailCard>

                    {/* ── Employee Time ── 8 fields flow naturally in a
                        3-col grid (last row carries the 2 leftover
                        cells). Shift Weekly Off Rule was dropped — we
                        don't track per-employee shift exceptions. */}
                    <DetailCard title="Employee Time" onEdit={canEdit ? () => setEditSection("time") : undefined}>
                      <Grid3>
                        <KV label="Shift"                           value="Regular Shift" />
                        <KV label="Weekly Off Policy"               value={p.weeklyOff} />
                        <KV label="Leave Plan"                      value={p.leavePlan} />
                        <KV label="Holiday Calendar"                value={p.holidayList} />
                        <KV label="Attendance Number"               value={p.attendanceNumber || p.employeeId} />
                        <KV label="Attendance Time Tracking Policy" value={p.timeTrackingPolicy} />
                        <KV label="Attendance Penalisation Policy"  value={p.penalizationPolicy} />
                        <KV label="Attendance Capture Scheme"       value={p.attendanceCaptureScheme} />
                      </Grid3>
                    </DetailCard>

                    {/* ── Education ── compliance-tracked; the cron
                        needs at least one entry with degree +
                        institution OR it'll warn the employee + later
                        auto-violate. JSON column on EmployeeProfile,
                        same shape the candidate apply form uses. */}
                    {(() => {
                      const raw: any = (p as any).educationDetails;
                      let entries: any[] = [];
                      if (Array.isArray(raw)) entries = raw;
                      else if (typeof raw === "string") {
                        try { const v = JSON.parse(raw); if (Array.isArray(v)) entries = v; } catch {}
                      }
                      return (
                        <DetailCard title="Education" onEdit={canEdit ? () => setEditSection("education") : undefined}>
                          {entries.length === 0 ? (
                            <p className="text-[13px] text-slate-400 italic">No education entries on file. Required for compliance.</p>
                          ) : (
                            <div className="space-y-2.5">
                              {entries.map((e: any, i: number) => {
                                const degree      = String(e?.degree      ?? e?.course     ?? "").trim();
                                const institution = String(e?.institution ?? e?.university ?? "").trim();
                                const startY      = String(e?.startOfCourse ?? e?.startYear ?? "").trim();
                                const endY        = String(e?.endOfCourse   ?? e?.endYear   ?? "").trim();
                                return (
                                  <div key={i} className="rounded-lg border border-slate-200 px-4 py-2.5">
                                    <p className="text-[13px] font-semibold text-slate-800">{degree || "(degree missing)"}</p>
                                    <p className="text-[12px] text-slate-500 mt-0.5">
                                      {institution || "(institution missing)"}
                                      {(startY || endY) && (
                                        <span className="text-slate-400"> · {startY}{startY && endY ? "–" : ""}{endY}</span>
                                      )}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </DetailCard>
                      );
                    })()}

                    {/* ── Other ── */}
                    <DetailCard title="Other" onEdit={canEdit ? () => setEditSection("other") : undefined}>
                      <Grid3>
                        <KV label="Biometric"            value={p.biometricId} />
                        <KV label="Internship End Date"  value={fmtDate(p.internshipEndDate)} />
                        {/* Probation End Date — inline "Extend" chip
                            opens the same quick-extend modal the email
                            reminder deep-links into. Visible only when
                            an end date is set + viewer can edit. */}
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.1em] font-medium text-slate-400">Probation End Date</p>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <p className="text-[13px] text-slate-800">{fmtDate(p.probationEndDate) || "—"}</p>
                            {canEdit && p.probationEndDate && (
                              <button
                                type="button"
                                onClick={() => { setProbationModalDefault("1m"); setProbationModalOpen(true); }}
                                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold px-2.5 py-0.5 transition-colors"
                              >
                                Extend
                              </button>
                            )}
                          </div>
                        </div>
                        <KV label="Job Location"         value={p.jobLocation} capitalize />
                      </Grid3>
                    </DetailCard>
                  </div>

                  {/* ── Organization sidebar ── */}
                  <aside className="lg:sticky lg:top-5 self-start">
                    <DetailCard title="Organization" onEdit={canEdit ? () => setEditSection("org") : undefined}>
                      <div className="space-y-4">
                        <KV label="Business Unit"   value={p.businessUnit} />
                        <KV label="Department"      value={p.department} />
                        <KV label="Location"        value={p.jobLocation} capitalize />
                        <KV label="Cost Center"     value={p.costCenter} />
                        <KV label="Legal Entity"    value={p.legalEntity} />

                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Reports To</p>
                          {user.manager ? (
                            <Link href={`/dashboard/hr/people/${user.manager.id}`} className="mt-1.5 inline-flex items-center gap-2 hover:underline">
                              {user.manager.profilePictureUrl ? (
                                <img src={user.manager.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full object-cover" />
                              ) : (
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#008CFF]/15 text-[10px] font-bold text-[#008CFF]">
                                  {user.manager.name?.split(" ").map((p: string) => p[0]).join("").slice(0,2).toUpperCase()}
                                </span>
                              )}
                              <span className="text-[13px] font-medium text-slate-800">{user.manager.name}</span>
                            </Link>
                          ) : (
                            <p className="mt-1 text-[13px] text-slate-800">—</p>
                          )}
                        </div>

                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">L2 Manager</p>
                          {user.inlineManager ? (
                            <Link href={`/dashboard/hr/people/${user.inlineManager.id}`} className="mt-1.5 inline-flex items-center gap-2 hover:underline">
                              {user.inlineManager.profilePictureUrl ? (
                                <img src={user.inlineManager.profilePictureUrl} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full object-cover" />
                              ) : (
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/15 text-[10px] font-bold text-violet-600">
                                  {user.inlineManager.name?.split(" ").map((p: string) => p[0]).join("").slice(0,2).toUpperCase()}
                                </span>
                              )}
                              <span className="text-[13px] font-medium text-slate-800">{user.inlineManager.name}</span>
                            </Link>
                          ) : (
                            <p className="mt-1 text-[13px] text-slate-800">—</p>
                          )}
                        </div>

                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Direct Reports</p>
                          <p className="mt-1 text-[13px] font-medium text-slate-800">{directReports.length} {directReports.length === 1 ? "Employee" : "Employees"}</p>
                        </div>
                      </div>
                    </DetailCard>
                  </aside>
                </div>
              );
            })()}

            {activeTab === "Attendance" && (showAttendanceTab ? (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                {/* Attendance | Leave sub-view toggle — HR-admin only. Leave
                    shows the same balances + history the employee sees on
                    their own leave page, read-only. Non-HR viewers (the
                    employee themselves, their direct manager) only get the
                    Attendance panel. */}
                {isHRAdmin && (
                  <div className="mb-5 inline-flex rounded-lg border border-slate-200 overflow-hidden">
                    {(["attendance", "leave"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setAttendanceView(v)}
                        className={`h-8 px-4 text-[12.5px] font-semibold transition-colors ${
                          attendanceView === v ? "bg-[#008CFF] text-white" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {v === "attendance" ? "Attendance" : "Leave"}
                      </button>
                    ))}
                  </div>
                )}
                {/* Attendance counting toggle — visible to developers
                    and to orgLevel="hr_manager" users (the HR tier).
                    Flipping OFF stops attendance from being counted /
                    flagged late / marked absent for this employee from
                    today onwards. Payroll continues to generate as
                    normal (payrollEnabled stays TRUE) so the employee
                    still gets paid for the full cycle — exactly what
                    HR needs for paid-notice-period cases (e.g. Manpreet's
                    15 days). */}
                {(me?.isDeveloper === true || me?.orgLevel === "hr_manager") && (
                  <AttendanceCountingToggle userId={userId} userName={user.name} />
                )}
                {isHRAdmin && attendanceView === "leave" ? (
                  <EmployeeLeavePanel userId={userId} userName={user.name} />
                ) : (
                  <EmployeeTimePanel
                    userId={userId}
                    userName={user.name}
                    isHRAdmin={isHRAdmin}
                    meDbId={Number(me?.dbId) || null}
                    joiningDate={p?.joiningDate ?? null}
                    workLocation={p?.workLocation ?? null}
                    targetOrgLevel={user.orgLevel ?? null}
                    targetIsDeveloper={user.isDeveloper === true}
                    shiftStartTime={user.shift?.startTime ?? null}
                    shiftBreakMinutes={user.shift?.breakMinutes ?? null}
                    viewerIsGaganDev={isGaganDeveloper(me?.email)}
                  />
                )}
              </section>
            ) : (
              <section className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <p className="text-[14px] font-semibold text-slate-700">Attendance is private</p>
                <p className="mt-1 text-[12.5px] text-slate-500">
                  Only the employee, their direct manager, and HR-admins can view this tab.
                </p>
              </section>
            ))}

            {activeTab === "Documents" && (
              showDocumentsTab ? (
                <DocumentsPanel profile={p} documents={user.documents || []} userId={userId} />
              ) : (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-[13px] text-amber-800">
                  Documents are private. Only the employee and HR admins can view this tab.
                </section>
              )
            )}

            {activeTab === "Assets" && (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <h3 className="mb-4 text-[15px] font-semibold text-slate-800">Assigned Assets</h3>
                {user.assets?.length > 0 ? (
                  <div className="space-y-2">
                    {user.assets.map((asset: any) => (
                      <div key={asset.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
                          <Laptop size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-slate-800">{asset.name}</p>
                          <p className="truncate text-[11px] text-slate-500">
                            {asset.category || "Asset"}{asset.serialNumber ? ` · ${asset.serialNumber}` : ""}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          asset.condition === "good" || asset.condition === "new"
                            ? "bg-emerald-50 text-emerald-600"
                            : asset.condition === "fair"
                            ? "bg-amber-50 text-amber-600"
                            : "bg-rose-50 text-rose-600"
                        }`}>{asset.condition || "—"}</span>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState icon={Laptop} label="No assets assigned" />}
              </section>
            )}

            {activeTab === "Finances" && showFinancesTab && (
              <EmployeeFinancesPanel userId={userId} userName={user.name} />
            )}

            {activeTab === "Exit Survey" && (
              <ExitSurveyTab userId={userId} />
            )}

            {activeTab === "Edit Profile" && showEditTab && (
              <EditProfilePanel userId={userId} user={user} managers={managers} canSeeSalary={canSeeSalary} />
            )}
          </main>

          {/* ── Right rail: Reporting Team — visible on About tab only,
              and only when at least one person actually reports to this
              user. Combines two gates: About-tab-only keeps it off the
              denser content tabs (Profile / Job / Attendance / Documents
              / Assets / Finances / Edit Profile); has-reports collapses
              the empty card for non-managers (ICs / interns). */}
          {activeTab === "About" && directReports.length > 0 && (
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-slate-800">
                  <UsersIcon size={14} className="text-[#008CFF]" />
                  Reporting Team
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
                  {directReports.length}
                </span>
              </div>

                <div className="relative mb-3">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={teamQuery}
                    onChange={(e) => setTeamQuery(e.target.value)}
                    placeholder="Search by name…"
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[12px] text-slate-800 placeholder-slate-400 focus:border-[#008CFF] focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  {filteredReports.length > 0 ? filteredReports.map((member: any) => (
                    <Link key={member.id} href={`/dashboard/hr/people/${member.id}`}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50">
                      <Avatar url={member.profilePictureUrl} name={member.name} size={32} fontSize={11} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold text-slate-800">{member.name}</p>
                        <p className="truncate text-[10.5px] text-slate-500">
                          {member.employeeProfile?.designation || getUserRoleLabel(member.role) || "Team Member"}
                        </p>
                      </div>
                    </Link>
                  )) : (
                    <p className="py-6 text-center text-[12px] text-slate-500">No matches</p>
                  )}
                </div>
              </div>
          </aside>
          )}
        </div>
      </div>

      {/* Edit modal retired — see the new "Edit Profile" tab for the
          canonical edit surface. ProfileEditModal stays defined below
          for now (no longer mounted) and can be removed in a follow-up
          cleanup once the new tab is verified in production. */}

      {/* ── PROFILE-tab section editors (HR-admin only) ──────────────── */}
      {editSection && canEdit && (() => {
        const close = (saved: boolean) => {
          setEditSection(null);
          if (saved) mutate(`/api/hr/people/${userId}`);
        };
        const dateISO = (v: any): string => {
          if (!v) return "";
          if (typeof v === "string") return v.slice(0, 10);
          try { return new Date(v).toISOString().slice(0, 10); } catch { return ""; }
        };
        if (editSection === "primary") return (
          <SectionEditModal
            userId={userId}
            title="Primary Details"
            onClose={close}
            values={{
              employeeId: p.employeeId ?? "",
              firstName:  p.firstName ?? "",
              middleName: p.middleName ?? "",
              lastName:   p.lastName ?? "",
              displayName: user.name ?? "",
              dateOfBirth: dateISO(p.dateOfBirth),
              gender:     p.gender ?? "",
              bloodGroup: p.bloodGroup ?? "",
              maritalStatus: p.maritalStatus ?? "",
              nationality: p.nationality ?? "",
              physicallyHandicapped: p.physicallyHandicapped ?? "No",
            }}
            fields={[
              { key: "employeeId",  label: "HRM No." },
              { key: "firstName",   label: "First Name" },
              { key: "middleName",  label: "Middle Name" },
              { key: "lastName",    label: "Last Name" },
              { key: "displayName", label: "Display Name", fullWidth: true },
              { key: "dateOfBirth", label: "Date of Birth", type: "date" },
              { key: "gender",      label: "Gender", type: "select", options: ["Male", "Female", "Other", "Prefer not to say"] },
              { key: "bloodGroup",  label: "Blood Group", type: "select", options: ["A+","A-","B+","B-","O+","O-","AB+","AB-"] },
              { key: "maritalStatus", label: "Marital Status", type: "select", options: ["Single","Married","Divorced","Widowed"] },
              { key: "nationality", label: "Nationality" },
              { key: "physicallyHandicapped", label: "Physically Handicapped", type: "select", options: ["No", "Yes"] },
            ]}
          />
        );
        if (editSection === "contact") return (
          <SectionEditModal
            userId={userId}
            title="Contact Details"
            hint="Login Email is the Google address this employee signs in with. Leaving it unchanged is safe; a valid new address updates their sign-in."
            onClose={close}
            values={{
              workEmail:     user.email ?? "",
              personalEmail: p.personalEmail ?? "",
              phone:         p.phone ?? "",
              workPhone:     p.workPhone ?? "",
              homePhone:     p.homePhone ?? "",
              emergencyPhone: p.emergencyPhone ?? "",
              emergencyRelationship: p.emergencyRelationship ?? "",
            }}
            fields={[
              { key: "workEmail", label: "Login Email (Google sign-in)", type: "email", fullWidth: true },
              { key: "personalEmail", label: "Personal Email", type: "email", fullWidth: true },
              { key: "phone",         label: "Mobile Number",  type: "tel" },
              { key: "workPhone",     label: "Work Number",    type: "tel" },
              { key: "homePhone",     label: "Home Phone",     type: "tel" },
              { key: "emergencyPhone", label: "Emergency Phone", type: "tel" },
              { key: "emergencyRelationship", label: "Emergency Relationship", type: "select", options: ["Father","Mother","Spouse","Sibling","Friend","Guardian","Other"] },
            ]}
          />
        );
        if (editSection === "family") return (
          <SectionEditModal
            userId={userId}
            title="Personal Details & Family"
            onClose={close}
            values={{
              parentName:    p.parentName ?? "",
              motherName:    p.motherName ?? "",
              spouseName:    p.spouseName ?? "",
              childrenNames: p.childrenNames ?? "",
            }}
            fields={[
              { key: "parentName",    label: "Father's Name" },
              { key: "motherName",    label: "Mother's Name" },
              { key: "spouseName",    label: "Spouse's Name" },
              { key: "childrenNames", label: "Children (comma-separated)", fullWidth: true },
            ]}
          />
        );
        if (editSection === "address") return (
          <SectionEditModal
            userId={userId}
            title="Addresses"
            hint="Both current and permanent addresses"
            onClose={close}
            values={{
              address:          p.address ?? "",
              addressLine2:     p.addressLine2 ?? "",
              city:             p.city ?? "",
              state:            p.state ?? "",
              addressPincode:   p.addressPincode ?? "",
              addressCountry:   p.addressCountry ?? "India",
              permanentLine1:   p.permanentLine1 ?? "",
              permanentLine2:   p.permanentLine2 ?? "",
              permanentCity:    p.permanentCity ?? "",
              permanentState:   p.permanentState ?? "",
              permanentPincode: p.permanentPincode ?? "",
              permanentCountry: p.permanentCountry ?? "India",
            }}
            fields={[
              { key: "address",        label: "Current — Address Line 1", type: "textarea", fullWidth: true },
              { key: "addressLine2",   label: "Current — Address Line 2", fullWidth: true },
              { key: "city",           label: "Current — City" },
              { key: "state",          label: "Current — State" },
              { key: "addressPincode", label: "Current — Pincode" },
              { key: "addressCountry", label: "Current — Country" },
              { key: "permanentLine1", label: "Permanent — Address Line 1", type: "textarea", fullWidth: true },
              { key: "permanentLine2", label: "Permanent — Address Line 2", fullWidth: true },
              { key: "permanentCity",  label: "Permanent — City" },
              { key: "permanentState", label: "Permanent — State" },
              { key: "permanentPincode", label: "Permanent — Pincode" },
              { key: "permanentCountry", label: "Permanent — Country" },
            ]}
          />
        );
        if (editSection === "identity") return (
          <SectionEditModal
            userId={userId}
            title="Identity Information"
            hint="PAN / Aadhaar are write-only — leave blank to keep the existing value"
            onClose={close}
            values={{
              panNumber: "",
              aadhaarNumber: "",
              aadhaarEnrollment: "",
              pfNumber:   p.pfNumber ?? "",
              uanNumber:  p.uanNumber ?? "",
              biometricId: p.biometricId ?? "",
            }}
            fields={[
              { key: "panNumber",        label: "PAN Number (leave blank to keep existing)" },
              { key: "aadhaarNumber",    label: "Aadhaar Number (leave blank to keep existing)" },
              { key: "aadhaarEnrollment", label: "Aadhaar Enrollment (leave blank to keep existing)", fullWidth: true },
              { key: "pfNumber",         label: "PF Number" },
              { key: "uanNumber",        label: "UAN Number" },
              { key: "biometricId",      label: "Biometric ID" },
            ]}
          />
        );
        if (editSection === "job") return (
          <SectionEditModal
            userId={userId}
            title="Job Details"
            onClose={close}
            values={{
              employeeId:        p.employeeId ?? "",
              joiningDate:       dateISO(p.joiningDate),
              designation:       p.designation ?? "",
              secondaryJobTitle: p.secondaryJobTitle ?? "",
              employmentType:    p.employmentType ?? "fulltime",
              internshipEndDate: dateISO(p.internshipEndDate),
              noticePeriodDays:  p.noticePeriodDays != null ? String(p.noticePeriodDays) : "30",
              probationPolicy:   p.probationPolicy ?? "",
              probationEndDate:  dateISO(p.probationEndDate),
            }}
            fields={[
              { key: "employeeId",        label: "HRM No." },
              { key: "joiningDate",       label: p.employmentType === "intern" ? "Internship Start Date" : "Date of Joining", type: "date" },
              // Company-scoped: pick from the brand the employee belongs
              // to. Brand derived from EmployeeProfile.businessUnit (with
              // legalEntity as a fallback signal).
              { key: "designation",       label: "Job Title — Primary",  type: "select", options: jobTitleSource(brandFromBusinessUnit(p.businessUnit, p.legalEntity)).defaults },
              { key: "secondaryJobTitle", label: "Job Title — Secondary", type: "select", options: jobTitleSource(brandFromBusinessUnit(p.businessUnit, p.legalEntity)).defaults },
              { key: "employmentType",    label: "Employment Type", type: "select", options: [
                { value: "fulltime", label: "Regular Employee" },
                { value: "intern",   label: "Intern" },
              ]},
              { key: "internshipEndDate", label: "Internship End Date (only when Intern)", type: "date" },
              { key: "noticePeriodDays",  label: "Notice Period (days)" },
              { key: "probationPolicy",   label: "Probation Policy" },
              // Auto-populated to joiningDate + 3 months on new onboarding
              // (server-side). HR can edit to shorten / extend / clear.
              // Clearing this field also clears probationReminderSentAt so
              // the 7-day reminder re-arms next time HR sets a new date.
              { key: "probationEndDate",  label: "Probation End Date", type: "date" },
            ]}
          />
        );
        if (editSection === "time") return (
          <SectionEditModal
            userId={userId}
            title="Employee Time"
            hint="Some fields are smart-linked — picking a Time Tracking Policy auto-syncs the Capture Scheme (and disables Penalisation when set to None), and Weekly Off Policy adjusts the Leave Plan to match the schedule."
            onClose={close}
            values={{
              weeklyOff:               p.weeklyOff ?? "",
              leavePlan:               p.leavePlan ?? "",
              holidayList:             p.holidayList ?? "",
              attendanceNumber:        p.attendanceNumber ?? p.employeeId ?? "",
              timeTrackingPolicy:      p.timeTrackingPolicy ?? "",
              penalizationPolicy:      p.penalizationPolicy ?? "",
              attendanceCaptureScheme: p.attendanceCaptureScheme ?? "",
            }}
            fields={[
              { key: "weeklyOff",               label: "Weekly Off Policy", type: "select", options: ["Standard Weekly Off", "Saturday + Sunday", "Sunday Only", "Custom"] },
              { key: "leavePlan",               label: "Leave Plan",         type: "select", options: ["Regular Leave Plan", "Regular Leave Plan_2026", "Intern Leave Plan", "None"] },
              { key: "holidayList",             label: "Holiday Calendar",   type: "select", options: ["Default Holiday List", "India Public Holidays"] },
              { key: "attendanceNumber",        label: "Attendance Number" },
              { key: "timeTrackingPolicy",      label: "Attendance Time Tracking Policy", type: "select", options: ["On-Site Capture", "Remote Capture", "Hybrid Capture", "None"] },
              { key: "penalizationPolicy",      label: "Attendance Penalisation Policy",  type: "select", options: ["Default", "Strict", "Lenient", "None"] },
              { key: "attendanceCaptureScheme", label: "Attendance Capture Scheme",       type: "select", options: ["On-Site", "Remote", "Hybrid"] },
            ]}
            onFieldChange={(key, value): Record<string, string> | void => {
              // ── Time Tracking Policy ↔ Attendance Capture Scheme ──
              // Two stored fields describing the same operational mode.
              // Keep them aligned automatically so HR can't accidentally
              // save "Remote Capture" with capture scheme still
              // "On-Site". When the tracking policy is turned OFF, also
              // disable penalisation (you can't penalise tardiness on a
              // role you aren't tracking time for).
              if (key === "timeTrackingPolicy") {
                if (value === "On-Site Capture") return { attendanceCaptureScheme: "On-Site" };
                if (value === "Remote Capture")  return { attendanceCaptureScheme: "Remote"  };
                if (value === "Hybrid Capture")  return { attendanceCaptureScheme: "Hybrid"  };
                if (value === "None")            return { attendanceCaptureScheme: "", penalizationPolicy: "None" };
              }
              if (key === "attendanceCaptureScheme") {
                if (value === "On-Site") return { timeTrackingPolicy: "On-Site Capture" };
                if (value === "Remote")  return { timeTrackingPolicy: "Remote Capture"  };
                if (value === "Hybrid")  return { timeTrackingPolicy: "Hybrid Capture"  };
              }
              // ── Weekly Off Policy → Leave Plan ──
              // 6-day-week schedules (Sunday Only) typically belong to
              // interns who use the Intern Leave Plan; 5-day schedules
              // map to the regular full-time plan. "Custom" is left
              // alone — HR will pick the matching plan manually for
              // bespoke arrangements.
              if (key === "weeklyOff") {
                if (value === "Sunday Only")                                       return { leavePlan: "Intern Leave Plan" };
                if (value === "Standard Weekly Off" || value === "Saturday + Sunday") return { leavePlan: "Regular Leave Plan" };
              }
            }}
          />
        );
        if (editSection === "other") return (
          <SectionEditModal
            userId={userId}
            title="Other"
            onClose={close}
            values={{
              biometricId:       p.biometricId ?? "",
              internshipEndDate: dateISO(p.internshipEndDate),
              jobLocation:       p.jobLocation ?? "",
            }}
            fields={[
              { key: "biometricId",       label: "Biometric ID" },
              { key: "internshipEndDate", label: "Internship End Date", type: "date" },
              { key: "jobLocation",       label: "Job Location",        type: "select", options: ["Mohali", "Delhi", "Mumbai", "Remote"] },
            ]}
          />
        );
        if (editSection === "bios") return (
          <SectionEditModal
            userId={userId}
            title="About / What I love / Hobbies"
            hint="Free-text bios shown on the ABOUT tab. Leave blank to clear."
            onClose={close}
            values={{
              about:   p.about   ?? "",
              jobLove: p.jobLove ?? "",
              hobbies: p.hobbies ?? "",
            }}
            fields={[
              { key: "about",   label: "About",                       type: "textarea", placeholder: "Tell the team a bit about yourself…" },
              { key: "jobLove", label: "What I love about my job?",   type: "textarea", placeholder: "Share what excites you about your role…" },
              { key: "hobbies", label: "My interests and hobbies",    type: "textarea", placeholder: "Movies, music, sports, side projects…" },
            ]}
          />
        );
        if (editSection === "org") return (
          <SectionEditModal
            userId={userId}
            title="Organization"
            hint="Edit any organisational attribute. Reporting Manager + L2 Manager save through the same endpoint as the legacy Edit Profile tab — developers aren't selectable as managers."
            onClose={close}
            values={{
              businessUnit:    p.businessUnit ?? "NB Media",
              department:      p.department ?? "",
              jobLocation:     p.jobLocation ?? "",
              // Default Cost Center to "NB Media" when empty so HR
              // doesn't have to retype the same value for every new
              // hire. They can still override per-employee.
              costCenter:      p.costCenter ?? "NB Media",
              legalEntity:     p.legalEntity ?? "",
              managerId:       user.manager?.id != null ? String(user.manager.id) : "",
              inlineManagerId: user.inlineManager?.id != null ? String(user.inlineManager.id) : "",
            }}
            fields={[
              { key: "businessUnit", label: "Business Unit", type: "select", options: ["NB Media", "YT Labs"] },
              // Company-scoped department list: YT Labs employees see
              // YT_-prefixed departments; NB Media sees the standard set.
              { key: "department",   label: "Department",    type: "select", options: departmentSource(brandFromBusinessUnit(p.businessUnit, p.legalEntity)).defaults },
              { key: "jobLocation",  label: "Location",      type: "select", options: ["Mohali", "Delhi", "Mumbai", "Remote"] },
              { key: "costCenter",   label: "Cost Center",   type: "select", options: ["NB Media", "YT Labs"] },
              { key: "legalEntity",  label: "Legal Entity",  type: "select", options: ["NB Media Productions", "YT Labs"] },
              // Manager dropdowns — populated from /api/managers?all=true
              // which lists every active non-developer employee. Empty
              // string in the option list = "— No manager —" so HR can
              // unset the reporting line entirely.
              {
                key: "managerId",
                label: "Reporting Manager",
                type: "select",
                options: [
                  { value: "", label: "— No manager —" },
                  ...managers
                    .filter((m: any) => m.id !== userId)
                    .map((m: any) => ({ value: String(m.id), label: m.name })),
                ],
              },
              {
                key: "inlineManagerId",
                label: "L2 Manager",
                type: "select",
                options: [
                  { value: "", label: "— No L2 manager —" },
                  ...managers
                    .filter((m: any) => m.id !== userId)
                    .map((m: any) => ({ value: String(m.id), label: m.name })),
                ],
              },
            ]}
          />
        );
        if (editSection === "education") return (
          <EducationEditModal
            userId={userId}
            initial={(() => {
              const raw: any = (p as any).educationDetails;
              if (Array.isArray(raw)) return raw;
              if (typeof raw === "string") {
                try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
              }
              return [];
            })()}
            onClose={() => close(false)}
            onSaved={async () => {
              await mutate(`/api/hr/people/${userId}`);
              close(true);
            }}
          />
        );
        return null;
      })()}

      {/* Probation extension modal — opened either by email deep-link
          (?extendProbation=1m | 2m | custom) or via the Job Details
          modal. Self-contained: fetches the current probationEndDate,
          shows quick presets + a custom date picker, PATCHes to the
          People API, then revalidates the SWR cache. */}
      {probationModalOpen && (
        <ProbationExtendModal
          userId={userId}
          employeeName={user?.name ?? ""}
          currentEnd={user?.profile?.probationEndDate ?? null}
          defaultMode={probationModalDefault}
          onClose={() => { setProbationModalOpen(false); setProbationModalDefault(null); }}
          onSaved={async () => {
            await mutate(`/api/hr/people/${userId}`);
            setProbationModalOpen(false);
            setProbationModalDefault(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Probation extension modal
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
//  Education editor modal — repeating-rows form for the new
//  EmployeeProfile.educationDetails JSON column. Required field by
//  the compliance cron (at least one entry with degree + institution
//  filled). Field shape mirrors the candidate apply form so HR can
//  later copy across without remapping.
// ─────────────────────────────────────────────────────────────────────
function EducationEditModal({
  userId, initial, onClose, onSaved,
}: {
  userId: number;
  initial: any[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  type Row = { id: string; degree: string; institution: string; startYear: string; endYear: string; branch: string };
  const fromExisting = (e: any): Row => ({
    id: Math.random().toString(36).slice(2),
    degree:      String(e?.degree      ?? e?.course        ?? "").trim(),
    institution: String(e?.institution ?? e?.university    ?? "").trim(),
    startYear:   String(e?.startOfCourse ?? e?.startYear   ?? "").trim(),
    endYear:     String(e?.endOfCourse   ?? e?.endYear     ?? "").trim(),
    branch:      String(e?.branch      ?? ""              ).trim(),
  });
  const blankRow = (): Row => ({
    id: Math.random().toString(36).slice(2),
    degree: "", institution: "", startYear: "", endYear: "", branch: "",
  });
  const [rows, setRows] = useState<Row[]>(
    initial.length > 0 ? initial.map(fromExisting) : [blankRow()],
  );
  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (id: string) =>
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((r) => r.id !== id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    // Drop blank rows; keep partial rows so HR sees their data in the
    // payload until they fill the missing piece.
    const cleaned = rows
      .filter((r) => r.degree.trim() || r.institution.trim() || r.startYear.trim() || r.endYear.trim() || r.branch.trim())
      .map((r) => ({
        degree:        r.degree.trim()      || "",
        institution:   r.institution.trim() || "",
        startOfCourse: r.startYear.trim()   || "",
        endOfCourse:   r.endYear.trim()     || "",
        branch:        r.branch.trim()      || "",
      }));
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ educationDetails: cleaned }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || `Save failed (${res.status})`);
        return;
      }
      await onSaved();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-[15px] font-semibold text-slate-900">Education</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Required for compliance — at least one entry with degree + institution.
          </p>
        </div>
        <div className="px-6 py-5 space-y-3 overflow-y-auto">
          {rows.map((row, idx) => (
            <div key={row.id} className="rounded-lg border border-slate-200 p-3.5 group">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] font-semibold text-slate-400">#{idx + 1}</span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    className="text-[11px] text-rose-500 hover:text-rose-600 font-medium opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >Remove</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Degree</label>
                  <input
                    value={row.degree}
                    onChange={(e) => setRow(row.id, { degree: e.target.value })}
                    placeholder="e.g. B.Tech"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-slate-300"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Institution</label>
                  <input
                    value={row.institution}
                    onChange={(e) => setRow(row.id, { institution: e.target.value })}
                    placeholder="e.g. IIT Delhi"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-slate-300"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Branch</label>
                  <input
                    value={row.branch}
                    onChange={(e) => setRow(row.id, { branch: e.target.value })}
                    placeholder="Optional"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-slate-300"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Start</label>
                  <input
                    value={row.startYear}
                    onChange={(e) => setRow(row.id, { startYear: e.target.value })}
                    placeholder="2019"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-slate-300"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">End</label>
                  <input
                    value={row.endYear}
                    onChange={(e) => setRow(row.id, { endYear: e.target.value })}
                    placeholder="2023"
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-slate-300"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0070cc] transition-colors"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#008CFF]/10">+</span>
            Add another education
          </button>
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] text-rose-700">{error}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-50">
            {saving ? "Saving…" : "Save education"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProbationExtendModal({
  userId, employeeName, currentEnd, defaultMode, onClose, onSaved,
}: {
  userId: number;
  employeeName: string;
  currentEnd: string | Date | null;
  defaultMode: "1m" | "2m" | "custom" | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  // Anchor preset extensions to the EXISTING probation end date when
  // present; fall back to today so HR can use this even on rows that
  // never had probation set up. Calculations below add whole months
  // using Date.setMonth so DST / month-length edge cases handle
  // themselves (e.g. Jan 31 → +1 month → Feb 28/29).
  const anchor = currentEnd ? new Date(currentEnd) : new Date();
  const plusMonths = (n: number) => {
    const d = new Date(anchor);
    d.setMonth(d.getMonth() + n);
    return d;
  };
  const dateInputValue = (d: Date) => {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };
  const [mode, setMode] = useState<"1m" | "2m" | "custom">(defaultMode ?? "1m");
  const [customDate, setCustomDate] = useState<string>(dateInputValue(plusMonths(1)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedEnd = mode === "1m" ? plusMonths(1)
                    : mode === "2m" ? plusMonths(2)
                    : (customDate ? new Date(customDate + "T00:00:00.000Z") : null);

  const submit = async () => {
    if (!computedEnd || Number.isNaN(computedEnd.getTime())) {
      setError("Pick a valid date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probationEndDate: computedEnd.toISOString() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || `Save failed (${res.status})`);
        return;
      }
      await onSaved();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-[15px] font-semibold text-slate-900">Extend probation</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {employeeName}
            {currentEnd && <> · currently ends <strong className="text-slate-700">{fmt(new Date(currentEnd))}</strong></>}
          </p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-2">
            {([
              { v: "1m", label: "Extend by 1 month",  to: fmt(plusMonths(1)) },
              { v: "2m", label: "Extend by 2 months", to: fmt(plusMonths(2)) },
              { v: "custom", label: "Custom date", to: null },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setMode(opt.v)}
                className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left text-[13px] transition-colors ${
                  mode === opt.v
                    ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <span className="font-medium">{opt.label}</span>
                {opt.to && <span className="text-[11.5px] text-slate-500">→ {opt.to}</span>}
              </button>
            ))}
          </div>
          {mode === "custom" && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1.5">New probation end date</label>
              <DateField
                value={customDate}
                onChange={setCustomDate}
                className="w-full"
              />
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] text-rose-700">{error}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Saving…" : "Confirm extension"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Compact stacked label/value used inside Keka-style detail cards.
function Compact({ label, value, capitalize = false }: { label: string; value?: string | null; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 text-[13px] text-slate-800 ${capitalize ? "capitalize" : ""}`}>{value || "—"}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="text-center py-12 border border-dashed border-slate-200 rounded-lg">
      <Icon size={28} className="mx-auto text-slate-300 mb-2" strokeWidth={1.5} />
      <p className="text-[13px] text-slate-500">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Profile / Documents — Keka-style detail building blocks
// ─────────────────────────────────────────────────────────────────────────────

function DetailCard({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100">
        <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#008CFF] hover:underline"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function Grid3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-5">{children}</div>;
}

function KV({ label, value, capitalize = false }: { label: string; value?: string | null; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 text-[13px] text-slate-800 ${capitalize ? "capitalize" : ""}`}>{value || "—"}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PROFILE-tab per-section edit modal — HR-admin only. Saves via PUT
//  /api/hr/people/[id], which auto-upserts the EmployeeProfile row.
// ─────────────────────────────────────────────────────────────────────────────
type SectionFieldType = "text" | "date" | "select" | "textarea" | "tel" | "email";
type SectionOption = string | { value: string; label: string };
type SectionField = {
  key: string;
  label: string;
  type?: SectionFieldType;
  options?: SectionOption[];
  placeholder?: string;
  fullWidth?: boolean;
};
function SectionEditModal({
  title, hint, fields, values, userId, onClose, onFieldChange,
}: {
  title: string;
  hint?: string;
  fields: SectionField[];
  values: Record<string, string>;
  userId: number;
  onClose: (saved: boolean) => void;
  /**
   * Optional cross-field cascade hook. Fires every time a field
   * changes, BEFORE state commits. Return a partial object whose
   * key/value pairs will be merged into the form alongside the primary
   * change — lets the caller keep linked fields in sync (e.g.
   * Attendance Time Tracking Policy ↔ Attendance Capture Scheme).
   * Returning undefined / null is a no-op.
   */
  onFieldChange?: (
    key: string,
    value: string,
    next: Record<string, string>,
  ) => Record<string, string> | void;
}) {
  const [form, setForm] = useState<Record<string, string>>(values);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const set = (k: string, v: string) => setForm((f) => {
    const next = { ...f, [k]: v };
    const cascade = onFieldChange?.(k, v, next);
    return cascade ? { ...next, ...cascade } : next;
  });

  const save = async () => {
    setSaving(true); setErr("");
    try {
      // Only send keys that are present in the modal's field list — keeps
      // the patch tight so we never accidentally overwrite a field the
      // user didn't see.
      const payload: Record<string, string | null> = {};
      for (const f of fields) {
        const v = (form[f.key] ?? "").toString();
        // Empty string → null so DB clears the column. Modal forms only
        // ever explicitly type a value or leave it blank.
        payload[f.key] = v.length > 0 ? v : null;
      }
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d?.error || `Save failed (HTTP ${res.status})`); return; }
      onClose(true);
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-[14.5px] font-semibold text-slate-800">{title}</h3>
            {hint && <p className="mt-0.5 text-[11.5px] text-slate-500">{hint}</p>}
          </div>
          <button onClick={() => onClose(false)} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map((f) => (
            <div key={f.key} className={f.fullWidth || f.type === "textarea" ? "sm:col-span-2" : ""}>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">{f.label}</label>
              {f.type === "date" ? (
                <SharedDatePicker value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
              ) : f.type === "select" && f.options ? (
                <SelectField
                  value={form[f.key] ?? ""}
                  onChange={(v) => set(f.key, v)}
                  options={f.options}
                  placeholder={f.placeholder ?? "Select…"}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800"
                />
              ) : f.type === "textarea" ? (
                <textarea
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, f.type === "email" ? e.target.value.toLowerCase() : e.target.value)}
                  rows={2}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 resize-none"
                />
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, f.type === "email" ? e.target.value.toLowerCase() : e.target.value)}
                  placeholder={f.placeholder}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15"
                />
              )}
            </div>
          ))}
        </div>
        {err && (
          <p className="mx-6 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{err}</p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button onClick={() => onClose(false)} className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="h-8 rounded-lg bg-[#3b82f6] px-4 text-[12px] font-semibold text-white hover:bg-[#2563eb] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Mask helpers — show only the trailing 4 chars/digits.
function maskAadhaar(v?: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (digits.length < 4) return v;
  return `XXXX-XXXX-${digits.slice(-4)}`;
}
function maskPan(v?: string | null): string | null {
  if (!v) return null;
  const t = v.toUpperCase();
  if (t.length < 4) return t;
  return `XXXXXX${t.slice(-4)}`;
}

// Folder layout per HR policy (2026-06-05):
//   • Identity:   PAN + Aadhaar are required, Passport + DL are optional.
//   • Education:  one latest degree / marksheet, required.
//   • Letters:    NB Media offer letter, required.
//   • Previous:   relieving letter + offer letter from prior employer,
//                 BOTH "if available" (no hard requirement).
//   • Other:      free-form catch-all.
//
// Storage keys are kept stable across renames so existing rows + the
// doc-compliance cron (panFile / aadhaarFile / education_certificate)
// keep matching. Only the LABEL changes when we want a friendlier
// display name — see CAT_LABEL_OVERRIDES below.
const DOC_FOLDERS: { key: string; label: string; cats: string[] }[] = [
  { key: "identity",    label: "Identity Docs",          cats: ["pan_card", "aadhar", "passport", "driving_license"] },
  { key: "education",   label: "Education",              cats: ["education_certificate"] },
  { key: "letters",     label: "Employee Letters",       cats: ["offer_letter"] },
  { key: "previous",    label: "Previous Experience",    cats: ["previous_relieving_letter", "previous_offer_letter"] },
  { key: "other",       label: "Other",                  cats: ["other"] },
];

// Display labels for category keys that don't render cleanly under
// the default `snake_case → Title Case` rule. Anything missing from
// here falls back to the auto-titlecase used inline below.
//
// Old keys (tenth / twelfth / degree / experience_letter / contract /
// id_proof / voter_id / payslip) are kept here so historical uploads
// still render readably even though they're no longer offered in the
// upload picker.
const CAT_LABEL_OVERRIDES: Record<string, string> = {
  // current pickers
  pan_card:                 "PAN Card",
  aadhar:                   "Aadhaar",
  passport:                 "Passport",
  driving_license:          "Driving License",
  education_certificate:    "Degree/marksheet",
  offer_letter:             "Offer Letter",
  previous_relieving_letter:"Previous Relieving Letter",
  previous_offer_letter:    "Previous Offer Letter",
  // legacy — keep so doc cards from before this rework still show clean labels
  id_proof:                 "ID Proof",
  voter_id:                 "Voter ID",
  tenth:                    "10th",
  twelfth:                  "12th",
  degree:                   "Degree",
  experience_letter:        "Experience Letter",
  contract:                 "Contract",
  payslip:                  "Payslip",
};
// Required = must be uploaded as part of onboarding compliance. The
// upload picker tags these with a "*" so HR / the employee see which
// docs the org actually needs. Optional / "if-available" cats get a
// muted suffix instead.
const REQUIRED_CATS = new Set<string>([
  "pan_card", "aadhar", "education_certificate", "offer_letter",
]);
const OPTIONAL_HINT: Record<string, string> = {
  passport:                  "optional",
  driving_license:           "optional",
  previous_relieving_letter: "if available",
  previous_offer_letter:     "if available",
};
const prettyCategory = (c: string): string =>
  CAT_LABEL_OVERRIDES[c]
    ?? c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
const dropdownCategoryLabel = (c: string): string => {
  const base = prettyCategory(c);
  if (REQUIRED_CATS.has(c)) return `${base} *`;
  if (OPTIONAL_HINT[c])      return `${base} (${OPTIONAL_HINT[c]})`;
  return base;
};

// Tailwind classes for the upload modal's text inputs — kept inline
// to avoid coupling this file to AssetsPanel's local constant.
const DOC_FIELD_CLS = "mt-1 w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]";

function DocumentsPanel({ profile, documents, userId }: { profile: any; documents: any[]; userId: number }) {
  // Folder concept retired in the new layout — kept the
  // DOC_FOLDERS catalog only so the modal can build a category
  // dropdown that includes every known category.

  const [uploadOpen, setUploadOpen]   = useState(false);
  const [uploadFile, setUploadFile]   = useState<File | null>(null);
  const [uploadName, setUploadName]   = useState<string>("");
  const [uploadCategory, setUploadCategory] = useState<string>("pan_card");
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver]       = useState(false);
  // Which versioned cards (e.g. Offer Letter) have their history expanded.
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const openUpload = () => {
    setUploadFile(null);
    setUploadName("");
    // Default to "other" since the inline per-card uploads cover the
    // catalog cases — this modal is now for free-form uploads.
    setUploadCategory("other");
    setUploadError(null);
    setUploadOpen(true);
  };
  const closeUpload = () => {
    if (uploading) return;
    setUploadOpen(false);
  };

  const pickFile = (f: File) => {
    setUploadError(null);
    if (f.size > 10 * 1024 * 1024) {
      setUploadError("File is larger than the 10 MB limit.");
      return;
    }
    setUploadFile(f);
    if (!uploadName.trim()) setUploadName(f.name);
  };

  const submitUpload = async () => {
    if (!uploadFile) { setUploadError("Pick a file first."); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("userId", String(userId));
      fd.append("category", uploadCategory);
      if (uploadName.trim()) fd.append("fileName", uploadName.trim());
      const res = await fetch("/api/hr/documents", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setUploadError(j?.error || `Upload failed (${res.status})`);
        return;
      }
      await mutate(`/api/hr/people/${userId}`);
      setUploadOpen(false);
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: any) => {
    if (!confirm(`Delete "${doc.fileName}"?`)) return;
    const res = await fetch(`/api/hr/documents/${doc.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return alert(j?.error || `Delete failed (${res.status})`);
    }
    await mutate(`/api/hr/people/${userId}`);
  };

  // Category options for the modal — full cross-folder list now
  // that we no longer have a folder context. Per-card inline uploads
  // (above) handle the common required cases; the modal is for
  // ad-hoc uploads, so showing every option is fine.
  const categoryOptions = DOC_FOLDERS.flatMap((f) =>
    f.cats.map((c) => ({ value: c, label: dropdownCategoryLabel(c) }))
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickFile(file);
  };

  // ── Section-grouped checklist layout ─────────────────────────
  // Catalog drives the layout. Each required card always renders so
  // HR can see at a glance which docs are missing. Optional + "if
  // available" cards also always render — the per-card action
  // adapts to whether a document is already on file.
  // `versioned` cards keep every upload as a version: the newest is the main
  // document and older ones move into an expandable history (used for Offer
  // Letters, which get re-issued on each increment/revision).
  type CatMeta = { key: string; label: string; required: boolean; hint?: string; versioned?: boolean };
  const SECTION_CATALOG: Array<{ key: string; label: string; subtitle?: string; cats: CatMeta[] }> = [
    {
      key: "required",
      label: "Required documents",
      subtitle: "Every employee must upload these.",
      cats: [
        { key: "pan_card",              label: "PAN Card",          required: true },
        { key: "aadhar",                label: "Aadhaar",           required: true },
        { key: "education_certificate", label: "Degree / Marksheet", required: true },
        { key: "offer_letter",          label: "Offer Letter",       required: true, versioned: true },
      ],
    },
    {
      key: "optional",
      label: "Optional identity proofs",
      cats: [
        { key: "passport",         label: "Passport",         required: false },
        { key: "driving_license",  label: "Driving License",  required: false },
      ],
    },
    {
      key: "previous",
      label: "Previous experience",
      subtitle: "Upload only if available from prior employer.",
      cats: [
        { key: "previous_relieving_letter", label: "Relieving Letter",        required: false, hint: "If available" },
        { key: "previous_offer_letter",     label: "Offer Letter (Previous)", required: false, hint: "If available" },
      ],
    },
  ];
  const KNOWN_KEYS = new Set<string>(SECTION_CATALOG.flatMap((s) => s.cats.map((c) => c.key)));
  // Generated-letter rows live under category='employee_letter' (the
  // auto-save the /api/hr/letter-templates/[key]/generate route writes
  // when HR clicks "Generate PDF"). Lifted into their own section so
  // HR sees FnF / probation / relieving / offer letters grouped
  // together instead of mixed into "Other files".
  KNOWN_KEYS.add("employee_letter");
  const generatedLetters = documents.filter(
    (d: any) => (d.category || "").toLowerCase() === "employee_letter"
  );
  // Latest doc per category — newest upload wins so a "Replace"
  // shows the freshly uploaded file.
  const docByCat = new Map<string, any>();
  // All versions per category, newest-first — [0] is the current/main doc,
  // the rest are history. Powers the versioned Offer Letter card.
  const docsByCatAll = new Map<string, any[]>();
  for (const d of documents.slice().sort((a: any, b: any) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )) {
    const k = (d.category || "").toLowerCase();
    if (!docByCat.has(k)) docByCat.set(k, d);
    const arr = docsByCatAll.get(k);
    if (arr) arr.push(d); else docsByCatAll.set(k, [d]);
  }
  // Anything outside the catalog (legacy uploads, "other") goes
  // into the bottom "Other files" group.
  const otherDocs = documents.filter((d: any) => !KNOWN_KEYS.has((d.category || "").toLowerCase()));

  // Required completion bar.
  const requiredCats = SECTION_CATALOG[0].cats;
  const requiredDone = requiredCats.filter((c) => docByCat.has(c.key)).length;
  const requiredPct  = Math.round((requiredDone / requiredCats.length) * 100);

  // Direct (no-modal) upload for a specific category — the row's
  // file input fires this with the category baked in. Bypasses the
  // category dropdown entirely so the user just picks a file.
  const inlineUpload = async (categoryKey: string, file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("File is larger than the 10 MB limit.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("userId", String(userId));
    fd.append("category", categoryKey);
    fd.append("fileName", file.name);
    const res = await fetch("/api/hr/documents", { method: "POST", body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j?.error || `Upload failed (${res.status})`);
      return;
    }
    await mutate(`/api/hr/people/${userId}`);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
      {/* Header + progress strip */}
      <div className="px-6 py-4 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Employee Documents</h3>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              {requiredDone === requiredCats.length
                ? "All required documents on file."
                : `${requiredDone} of ${requiredCats.length} required documents uploaded.`}
            </p>
          </div>
          <button
            type="button"
            onClick={openUpload}
            className="inline-flex items-center gap-1.5 h-8 px-3 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12.5px] font-semibold transition-colors"
          >
            <Plus size={14} /> Other upload
          </button>
        </div>
        <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full transition-all ${requiredPct === 100 ? "bg-emerald-500" : "bg-[#008CFF]"}`}
            style={{ width: `${requiredPct}%` }}
          />
        </div>
      </div>

      {/* Identity profile cards — only render when data is present */}
      {(profile.aadhaarNumber || profile.aadhaarEnrollment || profile.panNumber || profile.parentName) && (
        <div className="px-6 pt-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {(profile.aadhaarNumber || profile.aadhaarEnrollment) && (
            <IdDocCard
              flag="🇮🇳" title="Aadhaar Card"
              status={profile.aadhaarNumber ? "verified" : "pending"}
              rows={[
                ["Aadhaar Number",     maskAadhaar(profile.aadhaarNumber) || "—"],
                ["Enrollment Number",  profile.aadhaarEnrollment || "Not Available"],
                ["Date of Birth",      fmtDate(profile.dateOfBirth)],
                ["Name",               [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "—"],
              ]}
            />
          )}
          {(profile.panNumber || profile.parentName) && (
            <IdDocCard
              flag="🇮🇳" title="PAN Card"
              status={profile.panNumber ? "verified" : "pending"}
              rows={[
                ["Permanent Account Number", maskPan(profile.panNumber) || "—"],
                ["Name",                     [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "—"],
                ["Date of Birth",            fmtDate(profile.dateOfBirth)],
                ["Parent's Name",            profile.parentName || "—"],
              ]}
            />
          )}
        </div>
      )}

      {/* Section-grouped checklist */}
      <div className="p-6 space-y-6">
        {SECTION_CATALOG.map((section) => (
          <div key={section.key}>
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <h4 className="text-[12px] uppercase tracking-wider font-semibold text-slate-500">{section.label}</h4>
              {section.subtitle && (
                <p className="text-[11px] text-slate-400">{section.subtitle}</p>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {section.cats.map((cat) => {
                const doc = docByCat.get(cat.key);
                const hasDoc = !!doc;
                // Versioned cards (Offer Letter): [0] is the current doc,
                // the rest are older versions shown in the history drawer.
                const versions = cat.versioned ? (docsByCatAll.get(cat.key) ?? []) : [];
                const history = versions.slice(1);
                const isExpanded = !!expandedHistory[cat.key];
                const stateBorder = hasDoc
                  ? "border-emerald-300 bg-emerald-50/40"
                  : cat.required
                    ? "border-amber-300 bg-amber-50/30"
                    : "border-slate-200 bg-white";
                return (
                  <div key={cat.key} className={`rounded-xl border ${stateBorder} px-4 py-3 transition-colors`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {hasDoc
                            ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                            : cat.required
                              ? <AlertCircle size={14} className="text-amber-500 shrink-0" />
                              : <Circle size={14} className="text-slate-300 shrink-0" />}
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{cat.label}</p>
                          {cat.required && (
                            <span className="text-[9.5px] font-bold tracking-wider text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">REQUIRED</span>
                          )}
                          {cat.hint && (
                            <span className="text-[10.5px] text-slate-400">· {cat.hint}</span>
                          )}
                        </div>
                        {hasDoc ? (
                          <div className="mt-1 flex items-center gap-2 text-[11.5px] text-slate-500">
                            <FileText size={11} className="shrink-0" />
                            <span className="truncate">{doc.fileName || "Untitled"}</span>
                            <span className="text-slate-400">· {fmtDate(doc.createdAt)}</span>
                          </div>
                        ) : (
                          <p className="mt-1 text-[11.5px] text-slate-400">
                            {cat.required ? "Not yet uploaded — required." : "Not uploaded."}
                          </p>
                        )}
                      </div>
                      {cat.versioned && history.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedHistory((s) => ({ ...s, [cat.key]: !s[cat.key] }))}
                          className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium text-slate-500 hover:text-[#008CFF] hover:bg-[#008CFF]/5"
                          title={isExpanded ? "Hide previous versions" : "Show previous versions"}
                        >
                          <History size={12} />
                          {history.length} previous
                          <ChevronDown size={13} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-1.5">
                      {hasDoc && (
                        <>
                          <a
                            href={doc.fileUrl?.startsWith("http") ? doc.fileUrl : `/api/hr/documents/${doc.id}/file`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] text-slate-600 hover:text-[#008CFF] hover:bg-[#008CFF]/5"
                          >
                            <Eye size={13} /> View
                          </a>
                          <button
                            type="button"
                            onClick={() => handleDelete(doc)}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        </>
                      )}
                      <label className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] font-semibold cursor-pointer bg-[#008CFF] hover:bg-[#0070cc] text-white">
                        {hasDoc
                          ? (cat.versioned
                              ? <><Plus size={13} /> Add version</>
                              : <><RefreshCw size={13} /> Replace</>)
                          : <><UploadIcon size={13} /> Upload</>}
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,image/*,.doc,.docx"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            // Reset value so the same file can be re-selected (Replace flow).
                            e.target.value = "";
                            inlineUpload(cat.key, f ?? null);
                          }}
                        />
                      </label>
                    </div>
                    {cat.versioned && isExpanded && history.length > 0 && (
                      <div className="mt-3 border-t border-slate-200/70 pt-2.5 space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Previous versions</p>
                        {history.map((h: any) => (
                          <div key={h.id} className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex items-center gap-1.5 text-[11.5px] text-slate-500">
                              <FileText size={11} className="shrink-0" />
                              <span className="truncate">{h.fileName || "Untitled"}</span>
                              <span className="text-slate-400 shrink-0">· {fmtDate(h.createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <a
                                href={h.fileUrl?.startsWith("http") ? h.fileUrl : `/api/hr/documents/${h.id}/file`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11.5px] text-slate-600 hover:text-[#008CFF] hover:bg-[#008CFF]/5"
                              >
                                <Eye size={12} /> View
                              </a>
                              <button
                                type="button"
                                onClick={() => handleDelete(h)}
                                className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11.5px] text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                title="Delete this version"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Generated letters — auto-saved by the Templates page each
            time HR clicks "Generate PDF". Same render shape as Other
            files but in its own section so HR can find them fast. */}
        {generatedLetters.length > 0 && (
          <div>
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <h4 className="text-[12px] uppercase tracking-wider font-semibold text-slate-500">Generated letters</h4>
              <p className="text-[11px] text-slate-400">Auto-saved from the Templates page · {generatedLetters.length} total</p>
            </div>
            <div className="space-y-2">
              {generatedLetters.map((doc: any) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/30 px-4 py-3 hover:border-emerald-300 transition-colors"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700">
                    <FileText size={16} />
                  </div>
                  <a
                    href={doc.fileUrl?.startsWith("http") ? doc.fileUrl : `/api/hr/documents/${doc.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <p className="truncate text-[13px] font-semibold text-slate-800">{doc.fileName || "Untitled"}</p>
                    <p className="truncate text-[11px] text-slate-500">Generated · {fmtDate(doc.createdAt)}</p>
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    title="Delete"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-slate-400 hover:text-rose-500"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Other files — uploads outside the catalog (legacy + ad-hoc) */}
        {otherDocs.length > 0 && (
          <div>
            <div className="mb-2.5">
              <h4 className="text-[12px] uppercase tracking-wider font-semibold text-slate-500">Other files</h4>
            </div>
            <div className="space-y-2">
              {otherDocs.map((doc: any) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-[#008CFF]/40 transition-colors"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
                    <FileText size={16} />
                  </div>
                  <a
                    href={doc.fileUrl?.startsWith("http") ? doc.fileUrl : `/api/hr/documents/${doc.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <p className="truncate text-[13px] font-semibold text-slate-800">{doc.fileName || "Untitled"}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {prettyCategory(doc.category || "Document")} · {fmtDate(doc.createdAt)}
                    </p>
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    title="Delete"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-slate-400 hover:text-rose-500"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Upload drawer */}
      {uploadOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeUpload} />
          <div className="fixed top-0 right-0 bottom-0 w-[420px] bg-[#f4f7f8] border-l border-slate-200 shadow-2xl z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-[16px] font-semibold text-slate-800">Upload document</h2>
                <p className="mt-0.5 text-[11.5px] text-slate-500">Pick a file and a category.</p>
              </div>
              <button onClick={closeUpload} aria-label="Close" disabled={uploading} className="text-slate-400 hover:text-slate-700 -mt-1 disabled:opacity-50">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed py-8 px-4 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? "border-[#008CFF] bg-[#008CFF]/[0.04]"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <FileText size={28} className="mx-auto text-slate-300 mb-2" strokeWidth={1.5} />
                {uploadFile ? (
                  <>
                    <p className="text-[13px] font-semibold text-slate-800">{uploadFile.name}</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-500">{(uploadFile.size / 1024).toFixed(1)} KB · click to replace</p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-semibold text-slate-700">Drop a file here or click to pick</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-500">PDF, image, or DOCX up to 10 MB</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pickFile(f);
                  }}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Category</label>
                <SelectField
                  value={uploadCategory}
                  onChange={setUploadCategory}
                  options={categoryOptions}
                  className={DOC_FIELD_CLS}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Display name <span className="text-slate-400 font-normal normal-case tracking-normal">(optional)</span></label>
                <input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder={uploadFile?.name || "Defaults to the file name"}
                  className={DOC_FIELD_CLS}
                />
              </div>
              {uploadError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] text-rose-700">{uploadError}</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={closeUpload} disabled={uploading} className="h-9 px-5 text-[13px] text-slate-500 hover:text-slate-800 rounded-lg disabled:opacity-50">Cancel</button>
              <button
                onClick={submitUpload}
                disabled={uploading || !uploadFile}
                className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-60 disabled:cursor-wait"
              >{uploading ? "Uploading…" : "Upload"}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// Single edit modal that swaps its field set based on the section being
// edited. PUTs to /api/hr/people/:id, then revalidates the SWR cache so
// the page reflects the change without a full reload.
function ProfileEditModal({
  section, userId, user, onClose,
}: {
  section: "primary" | "contact" | "address" | "identity";
  userId: number;
  user: any;
  onClose: () => void;
}) {
  const p = user.profile || {};
  const dateISO = (v: any) =>
    v ? (typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10)) : "";
  const initial: Record<string, string> = {
    displayName: user.name ?? "",
    firstName:   p.firstName ?? "",
    middleName:  p.middleName ?? "",
    lastName:    p.lastName ?? "",
    dateOfBirth: dateISO(p.dateOfBirth),
    gender:      p.gender ?? "",
    bloodGroup:  p.bloodGroup ?? "",
    maritalStatus: p.maritalStatus ?? "",
    personalEmail: p.personalEmail ?? "",
    phone:       p.phone ?? "",
    workPhone:   p.workPhone ?? "",
    emergencyPhone:   p.emergencyPhone ?? "",
    address:     p.address ?? "",
    city:        p.city ?? "",
    state:       p.state ?? "",
    panNumber:   "",  // Plaintext field — empty by default; HR can re-enter to update.
    aadhaarNumber: "",
    aadhaarEnrollment: "",
    parentName:  p.parentName ?? "",
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const set = (k: keyof typeof initial, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const SECTIONS: Record<typeof section, { title: string; fields: Array<{ key: keyof typeof initial; label: string; type?: string; options?: string[]; fullWidth?: boolean }> }> = {
    primary: {
      title: "Primary Details",
      fields: [
        { key: "firstName",  label: "First Name" },
        { key: "middleName", label: "Middle Name" },
        { key: "lastName",   label: "Last Name" },
        { key: "dateOfBirth", label: "Date of Birth", type: "dob" },
        { key: "gender",      label: "Gender",        options: ["Male", "Female", "Other", "Prefer not to say"] },
        { key: "bloodGroup",  label: "Blood Group",   options: ["A+","A-","B+","B-","O+","O-","AB+","AB-"] },
        { key: "maritalStatus", label: "Marital Status", options: ["Single","Married","Divorced","Widowed"] },
      ],
    },
    contact: {
      title: "Contact Details",
      fields: [
        { key: "personalEmail",    label: "Personal Email", type: "email", fullWidth: true },
        { key: "phone",            label: "Mobile Number",  type: "tel" },
        { key: "workPhone",        label: "Work Number",    type: "tel" },
        { key: "emergencyPhone",   label: "Emergency Phone", type: "tel" },
      ],
    },
    address: {
      title: "Addresses",
      fields: [
        { key: "address", label: "Street Address", fullWidth: true },
        { key: "city",    label: "City" },
        { key: "state",   label: "State" },
      ],
    },
    identity: {
      title: "Identity Information",
      fields: [
        { key: "panNumber",         label: "PAN Number" },
        { key: "aadhaarNumber",     label: "Aadhaar Number" },
        { key: "aadhaarEnrollment", label: "Aadhaar Enrollment" },
        { key: "parentName",        label: "Parent's Name" },
      ],
    },
  };
  const cfg = SECTIONS[section];

  const onSave = async () => {
    setSaving(true);
    setError("");
    // Only send the fields relevant to the active section. Empty strings
    // for identity are skipped so HR doesn't accidentally wipe a stored
    // PAN by opening the modal and saving with the field blank.
    const patch: Record<string, unknown> = {};
    for (const f of cfg.fields) {
      const v = form[f.key];
      if (section === "identity" && (!v || v.trim().length === 0)) continue;
      patch[f.key] = v;
    }
    if (section === "primary") {
      const fullName = [form.firstName, form.middleName, form.lastName]
        .filter(Boolean).join(" ").trim();
      if (fullName) patch.displayName = fullName;
    }
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      await mutate(`/api/hr/people/${userId}`);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">{cfg.title}</h3>
          <button onClick={onClose}>
            <X size={18} className="text-slate-400 hover:text-slate-700" />
          </button>
        </div>
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          {cfg.fields.map((f) => (
            <div key={f.key as string} className={f.fullWidth || f.type === "dob" ? "col-span-2" : ""}>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">{f.label}</label>
              {f.type === "dob" ? (
                <SharedDatePicker value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
              ) : f.options ? (
                <SelectField
                  value={form[f.key] ?? ""}
                  onChange={(v) => set(f.key, v)}
                  options={f.options}
                  placeholder="Select…"
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800"
                />
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, f.type === "email" ? e.target.value.toLowerCase() : e.target.value)}
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                />
              )}
            </div>
          ))}
        </div>
        {error && <p className="px-6 pb-2 text-[12px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="h-9 px-4 text-[13px] text-slate-500 hover:text-slate-800">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IdDocCard({
  flag, title, status, rows,
}: {
  flag: string;
  title: string;
  status: "verified" | "pending";
  rows: [string, string][];
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-[16px]">{flag}</span>
          <span className="text-[13px] font-semibold text-slate-800">{title}</span>
          <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            status === "verified"
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : "bg-amber-50  text-amber-700  ring-1 ring-amber-200"
          }`}>
            {status}
          </span>
        </div>
      </div>
      <div className="px-5 py-4 grid grid-cols-2 gap-x-8 gap-y-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
            <p className="mt-1 text-[13px] text-slate-800">{value || "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Time tab — admin-facing attendance log + on-behalf actions
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

function fmtMins(m: number): string {
  if (!m || m <= 0) return "—";
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h ${mm}m`;
}

function statusPill(status: string) {
  const map: Record<string, string> = {
    present:   "bg-emerald-50 text-emerald-700 ring-emerald-200",
    late:      "bg-amber-50  text-amber-700  ring-amber-200",
    absent:    "bg-red-50    text-red-700    ring-red-200",
    half_day:  "bg-orange-50 text-orange-700 ring-orange-200",
    on_leave:  "bg-violet-50 text-violet-700 ring-violet-200",
    holiday:   "bg-sky-50    text-sky-700    ring-sky-200",
    weekly_off:"bg-slate-100 text-slate-600  ring-slate-200",
    pending:   "bg-slate-100 text-slate-600  ring-slate-200",
  };
  const cls = map[status] || "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// Shift window for the timeline bar: 9 AM → 6 PM IST (540 minutes).
const SHIFT_START_MIN = 9 * 60;   // minutes since midnight IST
const SHIFT_END_MIN   = 18 * 60;
const SHIFT_LEN       = SHIFT_END_MIN - SHIFT_START_MIN;

// Convert a UTC clock-time to minutes-since-midnight IST.
function toIstMin(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(d).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  return parseInt(parts.hour || "0", 10) * 60 + parseInt(parts.minute || "0", 10);
}

function LocationLink({ raw }: { raw: string | null | undefined }) {
  const loc: AttLoc = parseAttLoc(raw);
  // Nothing to show if the row never captured a location.
  if (!raw || (loc.lat === undefined && !loc.address && !loc.mode)) return null;

  const hasCoords = typeof loc.lat === "number" && typeof loc.lng === "number";
  const href = hasCoords
    ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
    : loc.address
      ? `https://www.google.com/maps/search/${encodeURIComponent(loc.address)}`
      : null;

  // Tooltip — shows the captured address (best-effort reverse-geocode) plus
  // mode/coords as a fallback if no address resolved.
  const tooltip = [
    loc.mode === "remote" ? "Remote" : loc.mode === "office" ? "Office" : null,
    loc.address,
    hasCoords ? `${loc.lat?.toFixed(5)}, ${loc.lng?.toFixed(5)}` : null,
  ].filter(Boolean).join(" · ");

  // Soft mode-tinted dot underneath the pin so HR can scan office vs remote.
  const tone =
    loc.mode === "remote" ? "text-sky-600 hover:bg-sky-50" :
    loc.mode === "office" ? "text-emerald-600 hover:bg-emerald-50" :
                            "text-slate-500 hover:bg-slate-100";

  if (!href) {
    return (
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${tone}`} title={tooltip || "Location"}>
        <MapPin className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip || "Open in Google Maps"}
      className={`inline-flex h-6 w-6 items-center justify-center rounded transition ${tone}`}
      onClick={(e) => e.stopPropagation()}
    >
      <MapPin className="h-3.5 w-3.5" />
    </a>
  );
}

type BarTone = "default" | "pending" | "approved";

function TimelineBar({
  clockIn, clockOut, tone = "default", sessions, isTodayRow, doorEntries,
}: {
  clockIn: string | Date | null;
  clockOut: string | Date | null;
  tone?: BarTone;
  sessions?: Array<{ clockIn: string | Date; clockOut?: string | Date | null }>;
  isTodayRow?: boolean;
  doorEntries?: Array<{ scannedAt: string | Date }>;
}) {
  // 9-to-6 shift window. Clamp the filled bar to the window edges.
  const inMin  = clockIn  ? toIstMin(new Date(clockIn))  : null;
  const outMin = clockOut ? toIstMin(new Date(clockOut)) : null;
  const startPct = inMin  != null ? Math.max(0,   ((inMin  - SHIFT_START_MIN) / SHIFT_LEN) * 100) : 0;
  const endPct   = outMin != null ? Math.min(100, ((outMin - SHIFT_START_MIN) / SHIFT_LEN) * 100) : 0;
  const widthPct = Math.max(0, endPct - startPct);
  const hasBar   = !!(clockIn && clockOut);
  // When there's a clock-in but no clock-out yet (today: open session;
  // past dates: forgot-to-clock-out / regularization needed) we still
  // want a visible marker at the clock-in position so HR can see WHEN
  // the day started without having to hover the empty track.
  const hasStartOnly = !!clockIn && !clockOut;

  // Lowercase, no leading-zero formatting — matches the attendance
  // page's "Logged In 8:00 am" tooltip wording.
  const fmt = (d: Date | null) => d
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
        .replace(/^0/, "").toLowerCase()
    : null;
  const inLabel  = clockIn  ? fmt(new Date(clockIn))  : null;
  const outLabel = clockOut ? fmt(new Date(clockOut)) : null;
  const toneSuffix = tone === "pending"  ? " · Regularization pending"
                   : tone === "approved" ? " · Regularization approved"
                   : "";

  // Tone palette: default (sky), pending (amber-striped), approved (emerald)
  const toneCls =
    tone === "pending"
      ? { fill: "from-[#fbbf24] to-[#f59e0b]", glow: "0 2px 5px rgba(245,158,11,0.35)", ring: "#f59e0b", dot: "bg-[#f59e0b]" }
      : tone === "approved"
        ? { fill: "from-[#34d399] to-[#10b981]", glow: "0 2px 5px rgba(16,185,129,0.35)", ring: "#10b981", dot: "bg-[#10b981]" }
        : { fill: "from-[#38bdf8] to-[#0ea5e9]", glow: "0 2px 5px rgba(14,165,233,0.35)", ring: "#0ea5e9", dot: "bg-[#0ea5e9]" };

  // The hover tooltip is portaled to <body> so it can render ABOVE the bar
  // without being clipped by the attendance table's overflow-hidden card.
  // Capture the bar's viewport rect on hover; position the tooltip from it.
  const barRef = useRef<HTMLDivElement>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const showTip = () => {
    const r = barRef.current?.getBoundingClientRect();
    if (r) setTipPos({ left: r.left + r.width / 2, top: r.top });
  };
  const hideTip = () => setTipPos(null);

  return (
    <div ref={barRef} onMouseEnter={showTip} onMouseLeave={hideTip} className="group relative h-5 w-full">
      {/* Track */}
      <div className="absolute inset-x-0 top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/60" />

      {hasBar ? (
        <>
          {/* Filled bar */}
          <div
            className={`absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-gradient-to-r ${toneCls.fill} ${tone === "pending" ? "opacity-80" : ""}`}
            style={{ left: `${startPct}%`, width: `${widthPct}%`, boxShadow: toneCls.glow }}
          />
          {/* Diagonal stripe overlay on PENDING bars — signals "tentative" without
              shouting. Pure CSS, no extra DOM. */}
          {tone === "pending" ? (
            <div
              className="absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full"
              style={{
                left: `${startPct}%`,
                width: `${widthPct}%`,
                backgroundImage:
                  "repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 4px, transparent 4px 8px)",
              }}
            />
          ) : null}
          {/* Endpoint dots */}
          <span
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.20)]"
            style={{ left: `${startPct}%`, boxShadow: `0 0 0 2px ${toneCls.ring}` }}
          />
          <span
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.20)]"
            style={{ left: `${endPct}%`, boxShadow: `0 0 0 2px ${toneCls.ring}` }}
          />
        </>
      ) : hasStartOnly ? (
        <>
          {/* Start-only bar: a short amber stub anchored at the clock-in
              position, with a single endpoint dot. Communicates "we know
              when they came in; clock-out is missing." Hover the row for
              the exact time. */}
          <div
            className="absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-300 to-amber-400"
            style={{ left: `${startPct}%`, width: `6px`, boxShadow: "0 2px 5px rgba(245,158,11,0.35)" }}
          />
          <span
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.20)]"
            style={{ left: `${startPct}%`, boxShadow: `0 0 0 2px #f59e0b` }}
          />
        </>
      ) : null}

      {/* Themed hover tooltip — same look as the attendance-page bar.
          Pointer-events disabled so it never swallows clicks on the
          row's other interactive children (regularize, on-behalf
          actions, etc.). Hidden when there's no clock-in to show. */}
      {inLabel && tipPos && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{ position: "fixed", left: tipPos.left, top: tipPos.top - 8, transform: "translate(-50%, -100%)" }}
          className="pointer-events-none z-[80] whitespace-nowrap rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0a1526] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-700 dark:text-slate-200 shadow-lg"
        >
          {/* Web Clock In — each session as ↙ clock-in / ↗ clock-out (now /
              Missed), matching the attendance-page LOG tooltip exactly. */}
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Web Clock In</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
            {(sessions && sessions.length > 0
              ? sessions
              : [{ clockIn: clockIn as string | Date, clockOut }]
            ).map((s, i) => {
              const open = !s.clockOut;
              const isLiveNow = open && isTodayRow;
              return (
                <div key={i} className="contents">
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                    <ArrowDownLeft size={13} strokeWidth={2.4} className="shrink-0 text-emerald-500" />
                    {fmt(new Date(s.clockIn))}
                  </span>
                  {isLiveNow ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium">
                      <span className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center">
                        <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">now</span>
                    </span>
                  ) : open ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium">
                      <AlertCircle size={13} strokeWidth={2.4} className="shrink-0 text-amber-500" />
                      <span className="font-semibold text-amber-600 dark:text-amber-400">Missed</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                      <ArrowUpRight size={13} strokeWidth={2.4} className="shrink-0 text-rose-500" />
                      {fmt(new Date(s.clockOut!))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {toneSuffix && (
            <p className="mt-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">{toneSuffix.replace(/^\s*·\s*/, "")}</p>
          )}
          {/* Door entries — mid-day re-entry scans (managers / HR / CEO / devs only). */}
          {Array.isArray(doorEntries) && doorEntries.length > 0 && (
            <div className="mt-1.5 border-t border-slate-200/60 dark:border-white/10 pt-1.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Door Entries</p>
              <div className="flex flex-col gap-1 tabular-nums">
                {doorEntries.map((d, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                    <ArrowDownLeft size={13} strokeWidth={2.4} className="shrink-0 text-[#008CFF]" />
                    {fmt(new Date(d.scannedAt))}
                  </span>
                ))}
              </div>
            </div>
          )}
          <span className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 rotate-45 bg-white dark:bg-[#0a1526] border-r border-b border-slate-200 dark:border-white/10" />
        </div>,
        document.body
      )}
    </div>
  );
}

function EmployeeTimePanel({
  userId, userName, isHRAdmin, meDbId, joiningDate, workLocation,
  targetOrgLevel, targetIsDeveloper,
  shiftStartTime, shiftBreakMinutes,
  viewerIsGaganDev = false,
}: {
  userId: number; userName: string; isHRAdmin: boolean; meDbId: number | null;
  joiningDate?: string | null;
  workLocation?: string | null;
  targetOrgLevel?: string | null;
  targetIsDeveloper?: boolean;
  // Shift coords drive the LATE-chip cutoff per row. Passed in from
  // the parent so we don't refetch — /api/hr/people/[id] already
  // includes shift in its response.
  shiftStartTime?: string | null;
  shiftBreakMinutes?: number | null;
  // True ONLY when the signed-in viewer is Gagan's developer account —
  // unlocks the on-behalf "Clock Out" control below. No other developer /
  // CEO / HR sees it. Enforced again server-side in the API.
  viewerIsGaganDev?: boolean;
}) {
  // CEO + developers don't punch a clock — flexible schedules mean the
  // daily "Absent" cross-marks for every non-clocked-in day are noise.
  // When viewing their profile (or their own page) we skip absent-row
  // synthesis below. Real clock-ins, weekends, and holidays still
  // appear; just the empty-day "Absent" placeholders are dropped.
  const skipAbsentSynthesis = !!(targetOrgLevel === "ceo" || targetIsDeveloper);
  // Normalise the joining date to a UTC midnight Date so we can clamp
  // every date window without re-parsing per call. Anything before this
  // day was pre-employment and shouldn't show as "Absent" — the row
  // never existed.
  const joinedAt = joiningDate ? new Date(`${String(joiningDate).slice(0, 10)}T00:00:00Z`) : null;
  // Remote / hybrid employees already work from home as their baseline,
  // so applying for WFH is meaningless. Hide the quick action — both
  // for self-view and for HR viewing such an employee's profile.
  const targetWorkLocation = String(workLocation ?? "office").toLowerCase();
  const canApplyWfh = targetWorkLocation !== "remote" && targetWorkLocation !== "hybrid";
  // True when the signed-in viewer is looking at their own profile — used
  // to render a "Regularize this day" link in place of the passive Absent
  // cross icon, deep-linking into /dashboard/hr/attendance with the date
  // pre-filled so the user can self-apply.
  const isSelfView = meDbId !== null && meDbId === userId;
  const today = new Date();

  // Live clock tick — used to add the currently-open session's elapsed
  // minutes onto today's Effective/Gross hours. Without this, the row
  // is stuck on the last clocked-out totalMinutes (which is what the DB
  // stores) and a user mid-session sees stale numbers. 1-minute cadence
  // is plenty; per-second feels jittery in a table cell.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Period selector: "30d" | "YYYY-MM"
  type Period = "30d" | string;
  const [period, setPeriod] = useState<Period>("30d");

  // API URL based on period. The 30-day window is clamped to the
  // employee's joining date so we never fetch (or synthesize) "absent"
  // rows for days before they were employed.
  const url = (() => {
    if (period === "30d") {
      const end = new Date();
      let start = new Date(end); start.setDate(start.getDate() - 29);
      if (joinedAt && start.getTime() < joinedAt.getTime()) start = new Date(joinedAt.getTime());
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      return `/api/hr/attendance?userId=${userId}&from=${iso(start)}&to=${iso(end)}`;
    }
    return `/api/hr/attendance?userId=${userId}&month=${period}`;
  })();
  const { data, isLoading } = useSWR(url, fetcher);
  // This employee's shift + alternate-Saturday anchor (from the attendance
  // API) — drives the weekly-off vs absent synthesis below. Null → Mon–Fri.
  const panelShift = (data?.shift ?? null) as any;
  const panelAnchor = data?.shiftEffectiveFrom ? new Date(data.shiftEffectiveFrom) : null;
  const records: any[] = data?.records ?? [];

  // On-behalf clock-out (Gagan's developer account only — see viewerIsGaganDev
  // and the server enforcement in /api/hr/attendance/clock-out-on-behalf).
  // Closes the target user's open session for TODAY at the current time.
  const [clockingOut, setClockingOut] = useState(false);
  const handleClockOutOnBehalf = async () => {
    if (clockingOut) return;
    if (!window.confirm(`Clock out ${userName} now (current time)?`)) return;
    setClockingOut(true);
    try {
      const res = await fetch("/api/hr/attendance/clock-out-on-behalf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to clock out"); return; }
      await mutate(url);
      await mutate(`/api/hr/people/${userId}`);
    } finally {
      setClockingOut(false);
    }
  };

  // Status rank for "best" choice when multiple requests exist for the same date.
  // Pending > partially_approved > approved > rejected/cancelled.
  const statusRank = (s: string) =>
    s === "pending" ? 4 : s === "partially_approved" ? 3 : s === "approved" ? 2 : 1;

  // Regularization requests — admins fetch all then filter client-side; users get view=my.
  const regsUrl = isHRAdmin ? "/api/hr/attendance/regularize?view=all" : "/api/hr/attendance/regularize?view=my";
  const { data: regsData = [] } = useSWR<any[]>(regsUrl, fetcher);

  // WFH requests
  const wfhUrl = isHRAdmin ? "/api/hr/attendance/wfh?view=all" : "/api/hr/attendance/wfh?view=my";
  const { data: wfhData = [] } = useSWR<any[]>(wfhUrl, fetcher);

  // Leave applications
  const leavesUrl = isHRAdmin ? "/api/hr/leaves?view=all" : "/api/hr/leaves?view=my";
  const { data: leavesRaw } = useSWR<any>(leavesUrl, fetcher);
  const leavesData: any[] = Array.isArray(leavesRaw)
    ? leavesRaw
    : (leavesRaw?.applications ?? leavesRaw?.items ?? []);

  // Build per-date maps for THIS user.
  const regByDate = (() => {
    const map = new Map<string, any>();
    if (!Array.isArray(regsData)) return map;
    for (const r of regsData) {
      if (r.userId !== userId) continue;
      const k = String(r.date).slice(0, 10);
      const prev = map.get(k);
      if (!prev || statusRank(r.status) > statusRank(prev.status)) map.set(k, r);
    }
    return map;
  })();

  const wfhByDate = (() => {
    const map = new Map<string, any>();
    if (!Array.isArray(wfhData)) return map;
    for (const w of wfhData) {
      if (w.userId !== userId) continue;
      const k = String(w.date).slice(0, 10);
      const prev = map.get(k);
      if (!prev || statusRank(w.status) > statusRank(prev.status)) map.set(k, w);
    }
    return map;
  })();

  // Leaves are date-RANGES — find the best applicable leave for a given day.
  const userLeaves = leavesData.filter((l: any) => l.userId === userId);
  const findLeaveForDate = (dateOnly: string): any | null => {
    let best: any = null;
    for (const l of userLeaves) {
      const from = String(l.fromDate).slice(0, 10);
      const to   = String(l.toDate).slice(0, 10);
      if (dateOnly >= from && dateOnly <= to) {
        if (!best || statusRank(l.status) > statusRank(best.status)) best = l;
      }
    }
    return best;
  };

  // Build a complete day-by-day series (incl. weekends + absent gaps), newest first.
  // Start is clamped to the employee's joining date — pre-employment days
  // would otherwise synthesize as "Absent" rows and pollute the log.
  const fullSeries = (() => {
    let start: Date, end: Date;
    if (period === "30d") {
      end = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
      start = new Date(end.getTime()); start.setUTCDate(start.getUTCDate() - 29);
    } else {
      const [y, m] = period.split("-").map(Number);
      start = new Date(Date.UTC(y, m - 1, 1));
      end   = new Date(Date.UTC(y, m, 0));
      const todayUtc = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
      if (end.getTime() > todayUtc.getTime()) end = todayUtc;
    }
    if (joinedAt && start.getTime() < joinedAt.getTime()) start = new Date(joinedAt.getTime());
    // If the entire window is pre-joining, bail out with an empty series.
    if (start.getTime() > end.getTime()) return [] as any[];
    const byDate = new Map<string, any>();
    for (const r of records) byDate.set(String(r.date).slice(0, 10), r);
    const out: any[] = [];
    for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const rec = byDate.get(iso);
      if (rec) out.push(rec);
      else {
        // Off day for THIS employee's shift — weekly-off OR a non-working
        // alternate Saturday. Working Saturdays correctly stay "absent".
        const isWeekend = !isWorkingDay(d, panelShift, panelAnchor);
        // CEO + developers — only synthesize weekends (calendar context).
        // Drop the "Absent" placeholders so the log isn't a wall of
        // cross-marks for someone who doesn't punch a clock.
        if (skipAbsentSynthesis && !isWeekend) continue;
        out.push({
          id: `synth-${iso}`,
          date: `${iso}T00:00:00.000Z`,
          clockIn: null, clockOut: null, totalMinutes: 0,
          status: isWeekend ? "weekly_off" : "absent",
        });
      }
    }
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return out;
  })();

  // Period button list — matches the Keka layout (30 DAYS + last 6 months).
  const periodButtons: { key: Period; label: string }[] = [
    { key: "30d", label: "30 DAYS" },
    ...Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { key: k as Period, label: MONTH_NAMES[d.getMonth()].toUpperCase() };
    }),
  ];

  const periodLabel = period === "30d"
    ? "Last 30 Days"
    : (() => {
        const [y, m] = period.split("-").map(Number);
        return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
      })();

  // ── Regularize-on-behalf modal state ────────────────────────────────
  const [regOpen, setRegOpen] = useState(false);
  const [regForm, setRegForm] = useState<{ date: string; requestedIn: string; requestedOut: string; reason: string }>({
    date: "", requestedIn: "", requestedOut: "", reason: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // ── HR on-behalf actions: 3-dot menu, WFH modal, Leave modal ────────
  // The kebab opens a small popover with three options that map to the
  // three on-behalf POST endpoints (regularize, wfh, leaves). State below
  // is HR-admin only — guarded at each call site by isHRAdmin.
  const [menuOpenKey, setMenuOpenKey]   = useState<string | null>(null);
  // Anchor rect of the open kebab button — the menu is portaled to <body> with
  // fixed positioning so it escapes the attendance table's overflow-hidden card
  // (otherwise the dropdown gets clipped, esp. on the last/only row).
  const [menuRect, setMenuRect]         = useState<DOMRect | null>(null);
  const [wfhOpen,     setWfhOpen]       = useState(false);
  // Tab inside the Apply-Leave-on-behalf modal — switches between
  // submitting a Leave application and granting WFH for the same user
  // without forcing HR to close one modal and open another.
  const [leaveModalTab, setLeaveModalTab] = useState<"leave" | "wfh">("leave");
  // On-Duty on-behalf modal — standalone small modal that POSTs to the
  // existing /api/hr/attendance/on-duty endpoint with targetUserId.
  const [odOpen, setOdOpen] = useState(false);
  // `date` = From, `toDate` = To. Single-day defaults to date == toDate.
  const [odForm, setOdForm] = useState<{ date: string; toDate: string; location: string; purpose: string }>({ date: "", toDate: "", location: "", purpose: "" });
  // WFH on-behalf form: `date` is the FROM date, `toDate` is the TO date.
  // The API treats a missing/equal `toDate` as a single-day grant; when a
  // later toDate is supplied (HR-on-behalf only) it grants WFH for every
  // working day in the range.
  const [wfhForm,     setWfhForm]       = useState<{ date: string; toDate: string; reason: string }>({ date: "", toDate: "", reason: "" });
  const [leaveOpen,   setLeaveOpen]     = useState(false);
  const [leaveForm,   setLeaveForm]     = useState<{ leaveTypeId: number | ""; fromDate: string; toDate: string; reason: string }>({
    leaveTypeId: "", fromDate: "", toDate: "", reason: "",
  });
  // Shared full / first_half / second_half toggle for both the
  // HR-on-behalf Leave and WFH tabs. Picking a half-day collapses the
  // range to a single date and prepends the reason with the marker the
  // backend uses to count as 0.5 days.
  const [grantDayKind, setGrantDayKind] = useState<"full" | "first_half" | "second_half">("full");
  const isGrantHalf = grantDayKind !== "full";

  // Handoff Details — POC + Work Status (+ Unavailability for WFH). Same
  // contract the company's standard leave/WFH form enforces; both APIs
  // reject the request when these are missing, so the HR-on-behalf
  // modal has to surface them too. State sits at the modal level so
  // switching between Leave / WFH tabs doesn't drop a typed-in value.
  const [handoffPoc,            setHandoffPoc]            = useState<PickerUser[]>([]);
  const [handoffWorkStatus,     setHandoffWorkStatus]     = useState("");
  const [handoffUnavailability, setHandoffUnavailability] = useState("");
  // HR filing on behalf can mark POC as N/A — the user's own
  // request flow keeps POC required (allowNa stays default-false there).
  const [handoffPocNa,          setHandoffPocNa]          = useState(false);
  const resetHandoff = () => { setHandoffPoc([]); setHandoffWorkStatus(""); setHandoffUnavailability(""); setHandoffPocNa(false); };
  const [leaveTypes,  setLeaveTypes]    = useState<{ id: number; name: string }[]>([]);
  // Per-type available balance for the target user, keyed by leaveTypeId.
  // available = totalDays - usedDays - pendingDays. Pending MUST be
  // subtracted so the number shown matches what the apply API actually
  // enforces (POST /api/hr/leaves rejects on total-used-pending) — otherwise
  // the form showed a higher "available" than could really be applied for.
  // Refetched each time the modal opens so a stale draft isn't shown.
  const [targetBalances, setTargetBalances] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!isHRAdmin) return;
    fetch("/api/hr/leaves/types").then(r => r.json()).then((d) => {
      if (Array.isArray(d)) setLeaveTypes(d);
    }).catch(() => {});
  }, [isHRAdmin]);
  // External trigger: the profile-page kebab dispatches
  // "hr:apply-leave-on-behalf" so HR can open the leave modal without
  // first clicking through to the per-row kebab. Only honored for HR
  // admins (who'd see the option anyway).
  useEffect(() => {
    if (!isHRAdmin) return;
    const open = () => setLeaveOpen(true);
    window.addEventListener("hr:apply-leave-on-behalf", open);
    return () => window.removeEventListener("hr:apply-leave-on-behalf", open);
  }, [isHRAdmin]);
  useEffect(() => {
    if (!leaveOpen || !isHRAdmin || !userId) return;
    fetch(`/api/hr/leaves/balance?userId=${userId}`)
      .then(r => r.json())
      .then((rows) => {
        if (!Array.isArray(rows)) return;
        const map: Record<number, number> = {};
        for (const b of rows) {
          const total   = parseFloat(b.totalDays   ?? "0");
          const used    = parseFloat(b.usedDays    ?? "0");
          const pending = parseFloat(b.pendingDays ?? "0");
          map[b.leaveTypeId] = total - used - pending;
        }
        setTargetBalances(map);
      })
      .catch(() => {});
  }, [leaveOpen, isHRAdmin, userId]);
  useEffect(() => {
    if (menuOpenKey === null) return;
    // Close on outside click. Using a data-attribute check is more reliable
    // than React's e.stopPropagation() because React 17+ delegates to the
    // root container — a synthetic stopPropagation doesn't always prevent
    // the native event from reaching document-level listeners, which would
    // unmount the menu before the option's click handler fired.
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest("[data-hr-menu]")) setMenuOpenKey(null);
    };
    // The menu is position:fixed (portaled), so it would drift on scroll —
    // close it instead. `true` catches scrolls on inner scroll containers.
    const dismiss = () => setMenuOpenKey(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menuOpenKey]);

  const openWfhFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    // Route through the unified Leave + WFH modal with the WFH tab
    // pre-selected — keeps a single canonical form instead of a
    // standalone WFH modal that duplicated the same fields.
    setWfhForm({ date: dateOnly, toDate: dateOnly, reason: "" });
    setLeaveModalTab("wfh");
    setMenuOpenKey(null);
    setLeaveOpen(true);
  };
  const openOdFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    setOdForm({ date: dateOnly, toDate: dateOnly, location: "", purpose: "" });
    setMenuOpenKey(null);
    setOdOpen(true);
  };
  const openLeaveFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    setLeaveForm({ leaveTypeId: "", fromDate: dateOnly, toDate: dateOnly, reason: "" });
    setLeaveModalTab("leave");
    setMenuOpenKey(null);
    setLeaveOpen(true);
  };

  const refreshAttendanceCaches = () => {
    // Mirror submitReg's refresh set: the table + all three request lists
    // so badges (Approved / Pending / on-leave) and the timeline bar update.
    mutate(url);
    mutate(regsUrl);
    mutate(wfhUrl);
    mutate(leavesUrl);
  };

  const submitWfh = async () => {
    if (!wfhForm.date || !wfhForm.reason.trim()) { alert("From date and reason are required."); return; }
    // Handoff Details mirror the standard WFH form. HR on-behalf can
    // mark POC as N/A — when that's ticked we send pocUserId=null and
    // skip the required check.
    const pocId = handoffPocNa ? null : (handoffPoc[0]?.id ?? null);
    if (!handoffPocNa && !pocId)         { alert("POC in Absence is required (or mark as N/A)."); return; }
    if (!handoffWorkStatus.trim())       { alert("Work Status is required."); return; }
    if (!handoffUnavailability.trim())   { alert("Time of Unavailability is required."); return; }
    const effectiveTo = wfhForm.toDate && wfhForm.toDate >= wfhForm.date ? wfhForm.toDate : wfhForm.date;
    setSubmitting(true);
    try {
      // No forceGrant — route through normal approval (same flow as
      // apply-on-behalf on the HR dashboard). The target user's manager
      // sees the request in their L1 queue.
      // Half-day WFH tags the reason with [First Half] / [Second Half]
      // (same convention as leave) and collapses the range to a single
      // date — half-day WFH only makes sense for one day.
      const wfhReasonText = wfhForm.reason.trim();
      const wfhReasonOut =
        grantDayKind === "first_half"  ? `[First Half] ${wfhReasonText}`  :
        grantDayKind === "second_half" ? `[Second Half] ${wfhReasonText}` :
                                          wfhReasonText;
      const wfhEffectiveTo = isGrantHalf ? wfhForm.date : effectiveTo;
      const res = await fetch("/api/hr/attendance/wfh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId:   userId,
          date:           wfhForm.date,
          toDate:         wfhEffectiveTo,
          reason:         wfhReasonOut,
          pocUserId:      pocId,
          workStatus:     handoffWorkStatus.trim(),
          unavailability: handoffUnavailability.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to grant WFH"); return; }
      setWfhOpen(false);
      resetHandoff();
      refreshAttendanceCaches();
    } finally { setSubmitting(false); }
  };

  const submitOnDuty = async () => {
    if (!odForm.date)            { alert("From date is required."); return; }
    if (!odForm.purpose.trim())  { alert("Purpose is required."); return; }
    // Handoff Details — workStatus is required server-side. POC is
    // N/A-eligible here for the HR-on-behalf path.
    const pocId = handoffPocNa ? null : (handoffPoc[0]?.id ?? null);
    if (!handoffPocNa && !pocId)   { alert("POC in Absence is required (or mark as N/A)."); return; }
    if (!handoffWorkStatus.trim()) { alert("Work Status is required."); return; }
    const effectiveTo = odForm.toDate && odForm.toDate >= odForm.date ? odForm.toDate : odForm.date;
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/attendance/on-duty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: userId,
          date:         odForm.date,
          toDate:       effectiveTo,
          location:     odForm.location.trim() || undefined,
          purpose:      odForm.purpose.trim(),
          pocUserId:    pocId,
          workStatus:   handoffWorkStatus.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to submit on-duty request."); return; }
      setOdOpen(false);
      setOdForm({ date: "", toDate: "", location: "", purpose: "" });
      resetHandoff();
      refreshAttendanceCaches();
    } finally { setSubmitting(false); }
  };

  const submitLeave = async () => {
    if (!leaveForm.leaveTypeId) { alert("Leave type is required."); return; }
    if (!leaveForm.fromDate || !leaveForm.toDate) { alert("From and To dates are required."); return; }
    if (!leaveForm.reason.trim()) { alert("Reason is required."); return; }
    // Handoff Details — same contract as the standard leave form. POC
    // may be N/A on HR-on-behalf; workStatus stays required.
    const pocId = handoffPocNa ? null : (handoffPoc[0]?.id ?? null);
    if (!handoffPocNa && !pocId)   { alert("POC in Absence is required (or mark as N/A)."); return; }
    if (!handoffWorkStatus.trim()) { alert("Work Status is required."); return; }
    setSubmitting(true);
    try {
      // Half-day leave: tag the reason and collapse the range so the
      // API's 0.5-day accounting kicks in.
      const leaveReasonText = leaveForm.reason.trim();
      const leaveReasonOut =
        grantDayKind === "first_half"  ? `[First Half] ${leaveReasonText}`  :
        grantDayKind === "second_half" ? `[Second Half] ${leaveReasonText}` :
                                          leaveReasonText;
      const leaveToDateOut = isGrantHalf ? leaveForm.fromDate : leaveForm.toDate;
      const res = await fetch("/api/hr/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId:    userId,
          useLwpFallback:  true,  // HR-on-behalf auto-falls back to LWP if balance missing
          leaveTypeId:     Number(leaveForm.leaveTypeId),
          fromDate:        leaveForm.fromDate,
          toDate:          leaveToDateOut,
          reason:          leaveReasonOut,
          pocUserId:       pocId,
          workStatus:      handoffWorkStatus.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to grant leave"); return; }
      setLeaveOpen(false);
      resetHandoff();
      refreshAttendanceCaches();
    } finally { setSubmitting(false); }
  };

  // datetime-local <-> IST helpers. The native input is timezone-naive
  // (just "YYYY-MM-DDTHH:mm" text), so we have to format the stored UTC
  // instant in IST when pre-filling, and parse the entered IST string
  // back to a UTC instant on submit. Otherwise HR sees UTC times and a
  // server in UTC re-interprets the entered value, producing day-old
  // garbage on the regularization row.
  const utcToIstInput = (instant: Date | string): string => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(typeof instant === "string" ? new Date(instant) : instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    // formatToParts can emit "24" for midnight on some engines — normalize.
    const hh = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
  };
  const istInputToUtcIso = (val: string): string => {
    // val is "YYYY-MM-DDTHH:mm" interpreted as IST (+05:30). Append the
    // offset so Date parses unambiguously regardless of the runtime TZ.
    if (!val) return "";
    return new Date(`${val}:00+05:30`).toISOString();
  };

  const openRegFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    setRegForm({
      date: dateOnly,
      requestedIn:  rec.clockIn  ? utcToIstInput(rec.clockIn)  : `${dateOnly}T09:00`,
      requestedOut: rec.clockOut ? utcToIstInput(rec.clockOut) : `${dateOnly}T18:00`,
      reason: "",
    });
    setRegOpen(true);
  };

  const submitReg = async () => {
    if (!regForm.reason.trim()) { alert("Reason is required."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/attendance/regularize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: regForm.date,
          requestedIn:  regForm.requestedIn  ? istInputToUtcIso(regForm.requestedIn)  : null,
          requestedOut: regForm.requestedOut ? istInputToUtcIso(regForm.requestedOut) : null,
          reason: regForm.reason.trim(),
          userId,
          forceGrant: true,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Regularize failed.");
        return;
      }
      setRegOpen(false);
      mutate(url);
      mutate(regsUrl);
      mutate(wfhUrl);
      mutate(leavesUrl);
    } finally {
      setSubmitting(false);
    }
  };

  // ── ME-tab-style top summary widgets ─────────────────────────────────
  // Computed from the `records` we already fetched so we don't need any
  // new API calls. Avg hours and on-time arrival % cover the last 7
  // calendar days. The Mon→Sun pills show this week with the worked
  // days coloured by status.
  const istToday = (() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  })();
  // Clamp the 7-day window to the employee's joining date so a brand-new
  // joiner doesn't get diluted to 0% on-time by 6 pre-employment days.
  const joinedIso = joinedAt ? joinedAt.toISOString().slice(0, 10) : null;
  const last7 = (() => {
    const out: string[] = [];
    const base = new Date(istToday + "T00:00:00Z");
    for (let i = 0; i < 7; i++) {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      if (joinedIso && iso < joinedIso) continue;
      out.push(iso);
    }
    return out;
  })();
  const last7Records = records.filter((r) => last7.includes(String(r.date).slice(0, 10)));
  // Roll today's LIVE minutes into the 7-day total — the stored
  // totalMinutes is stale for an ongoing session.
  const minsFor = (r: any) => {
    const base = r.totalMinutes || 0;
    if (String(r.date).slice(0, 10) !== istToday) return base;
    const sess = Array.isArray(r.sessions) ? r.sessions : [];
    const open = sess.find((s: any) => !s.clockOut);
    return open
      ? base + Math.max(0, Math.floor((now.getTime() - new Date(open.clockIn).getTime()) / 60000))
      : base;
  };
  const workedMins7  = last7Records.reduce((s, r) => s + minsFor(r), 0);
  const workedDays7  = last7Records.filter((r) => minsFor(r) > 0).length;
  const avgMins      = workedDays7 > 0 ? Math.round(workedMins7 / workedDays7) : 0;
  // On-time = clock-in <= 10:00 IST. Same rule as the daily summary email.
  const onTime7 = last7Records.filter((r) => {
    if (!r.clockIn) return false;
    const ist = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(r.clockIn));
    const [h, m] = ist.split(":").map(Number);
    return h * 60 + m <= 10 * 60;
  }).length;
  const onTimePct = workedDays7 > 0 ? Math.round((onTime7 / workedDays7) * 100) : 0;

  // Mon → Sun this week
  const weekPills = (() => {
    const base = new Date(istToday + "T00:00:00Z");
    const dow = (base.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
    const monday = new Date(base); monday.setUTCDate(monday.getUTCDate() - dow);
    const labels = ["M", "T", "W", "T", "F", "S", "S"];
    return labels.map((lbl, i) => {
      const d = new Date(monday); d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const rec = records.find((r) => String(r.date).slice(0, 10) === iso);
      const isToday = iso === istToday;
      const status: "today" | "present" | "absent" | "off" | "future" =
        isToday ? "today" :
        iso > istToday ? "future" :
        (i >= 5) ? "off" :  // Sat/Sun
        rec?.clockIn ? "present" : "absent";
      return { lbl, status };
    });
  })();
  const pillColor = (s: string) =>
    s === "today"   ? "bg-[#008CFF] text-white" :
    s === "present" ? "bg-emerald-100 text-emerald-700" :
    s === "absent"  ? "bg-rose-100 text-rose-600" :
    s === "off"     ? "bg-slate-100 text-slate-500" :
                      "bg-slate-50 text-slate-400";

  return (
    <section>
      {/* ── Top summary row — Stats · Timings · Actions ───────────── */}
      {(() => {
        // Today's record + LIVE minute count for ongoing sessions.
        // Mirrors the per-row table logic so the cards stay in sync
        // with the "Today" row below.
        const todayRec = records.find((r) => String(r.date).slice(0, 10) === istToday);
        const todaySessions = Array.isArray(todayRec?.sessions) ? todayRec!.sessions as any[] : [];
        const openSess = todaySessions.find((s) => !s.clockOut);
        const baseTodayMins = todayRec?.totalMinutes ?? 0;
        const liveTodayMins = openSess
          ? baseTodayMins + Math.max(0, Math.floor((now.getTime() - new Date(openSess.clockIn).getTime()) / 60000))
          : baseTodayMins;
        const fmtIstHM = (instant: any) => instant
          ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(instant))
          : null;
        const effMins   = liveTodayMins;
        const grossMins = liveTodayMins; // gross == effective for now (no break tracking)
        const todayIn   = fmtIstHM(todayRec?.clockIn);
        const todayOut  = fmtIstHM(todayRec?.clockOut);
        // 9 AM → 6 PM standard workday → progress bar fill % based on
        // worked minutes vs 9h target.
        const workdayMins = 9 * 60;
        const progressPct = Math.min(100, Math.round((effMins / workdayMins) * 100));
        return (
          <div className="mb-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ── Attendance Stats ── */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[13px] font-semibold text-slate-800">Attendance Stats</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Last 7 Days</p>
              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-3 items-end pb-2 border-b border-slate-100">
                <span />
                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Avg Hrs/Day</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 text-right">On Time</span>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center py-3 border-b border-slate-100">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 text-[10px] font-bold">
                    {userName?.split(" ").map((p: string) => p[0]).join("").slice(0,2).toUpperCase()}
                  </span>
                  <span className="text-[12.5px] font-semibold text-slate-700">{isSelfView ? "Me" : userName}</span>
                </span>
                <span className="text-[13px] font-bold tabular-nums text-slate-800">{fmtMins(avgMins)}</span>
                <span className="text-[13px] font-bold tabular-nums text-slate-800 text-right">{onTimePct}%</span>
              </div>
            </div>

            {/* ── Timings ── */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[13px] font-semibold text-slate-800">Timings</p>
              <div className="mt-3 flex items-center justify-between gap-1">
                {weekPills.map((p, i) => (
                  <span key={i} className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${pillColor(p.status)}`}>
                    {p.lbl}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-slate-500">Today (9:00 AM – 6:00 PM)</p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-[#008CFF] rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-slate-500">
                <span>Duration: <strong className="text-slate-700">{fmtMins(effMins)}</strong></span>
                <span>{todayRec?.clockIn ? `In: ${todayIn}${todayOut ? ` · Out: ${todayOut}` : ""}` : "not clocked in"}</span>
              </div>
            </div>

            {/* ── Actions ── */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[13px] font-semibold text-slate-800">Actions</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {today.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-3 text-[11px] text-slate-500">
                <span>Effective: <strong className="text-slate-800">{fmtMins(effMins)}</strong></span>
                <span>Gross: <strong className="text-slate-800">{fmtMins(grossMins)}</strong></span>
              </div>
              {(isHRAdmin || isSelfView) && (
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {canApplyWfh && (
                    <button onClick={() => { setLeaveOpen(true); setLeaveModalTab("wfh"); }} className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-[#008CFF] hover:underline justify-start">
                      <Home size={12} /> Work From Home
                    </button>
                  )}
                  <button onClick={() => setOdOpen(true)} className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-[#008CFF] hover:underline justify-start">
                    <Briefcase size={12} /> On Duty
                  </button>
                  <button onClick={() => setRegOpen(true)} className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-[#008CFF] hover:underline justify-start">
                    <ShieldCheck size={12} /> Regularization
                  </button>
                  <button onClick={() => { setLeaveOpen(true); setLeaveModalTab("leave"); }} className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-[#008CFF] hover:underline justify-start">
                    <Coffee size={12} /> Apply Leave
                  </button>
                </div>
              )}
              {/* On-behalf clock-out — visible ONLY to Gagan's developer
                  account, and only while the user has an open session today
                  (clocked in, not yet out). Server re-checks the identity. */}
              {viewerIsGaganDev && openSess && (
                <button
                  onClick={handleClockOutOnBehalf}
                  disabled={clockingOut}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                >
                  <LogOut size={12} /> {clockingOut ? "Clocking out…" : "Clock Out (dev)"}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Logs & Requests sub-tabs (visual parity with the ME tab) ──
          Hidden entirely when the target user is CEO / developer —
          their schedules are flexible and the per-day log doesn't
          represent anything meaningful. The modals below the table
          stay rendered so HR's on-behalf actions still work. */}
      {!skipAbsentSynthesis && (
      <>
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 px-1">
        <p className="text-[13px] font-semibold text-slate-800">Logs &amp; Requests</p>
      </div>

      {/* Period bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <h3 className="text-[14px] font-semibold text-slate-800">{periodLabel}</h3>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {periodButtons.map((b) => (
            <button
              key={b.key}
              onClick={() => setPeriod(b.key)}
              className={`h-7 rounded px-3 text-[10.5px] font-bold uppercase tracking-wider transition ${
                period === b.key
                  ? "bg-[#008CFF] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Attendance table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="w-[150px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Date</th>
              <th className="w-[280px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Attendance Visual</th>
              <th className="w-[120px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Effective Hours</th>
              <th className="w-[110px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Gross Hours</th>
              <th className="w-[60px] px-5 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Log</th>
              {isHRAdmin ? <th className="w-[40px] px-3 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={isHRAdmin ? 6 : 5} className="px-4 py-10 text-center text-[12px] text-slate-400">Loading…</td></tr>
            ) : fullSeries.length === 0 ? (
              <tr><td colSpan={isHRAdmin ? 6 : 5} className="px-4 py-10 text-center text-[12px] text-slate-400">No attendance for this period.</td></tr>
            ) : fullSeries.map((rec) => {
              const dateOnly = String(rec.date).slice(0, 10);
              const dt = new Date(rec.date);
              const dateLabel = dt.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
              const isToday   = dateOnly === today.toISOString().slice(0, 10);
              const isWeekend = rec.status === "weekly_off";
              const isHoliday = rec.status === "holiday";
              const isPresent = rec.status === "present" || rec.status === "late" || rec.status === "half_day";
              // LOP penalties from the auto-LOP job — surfaced so HR (and the
              // employee) can see the day was docked. full = absence, half =
              // unregularized missed clock-out.
              const isFullLop    = rec.status === "lop";
              const isHalfDayLop = rec.status === "half_day_lop";
              const isLop        = isFullLop || isHalfDayLop;

              const reg   = regByDate.get(dateOnly);
              const wfh   = wfhByDate.get(dateOnly);
              const leave = findLeaveForDate(dateOnly);

              const isRegPending  = reg && (reg.status === "pending" || reg.status === "partially_approved");
              const isRegApproved = reg && reg.status === "approved";
              const isWfhPending  = wfh && (wfh.status === "pending" || wfh.status === "partially_approved");
              const isWfhApproved = wfh && wfh.status === "approved";
              const isLeavePending  = leave && (leave.status === "pending" || leave.status === "partially_approved");
              const isLeaveApproved = leave && leave.status === "approved";
              const leaveTypeName = leave?.leaveType?.name || (rec.status === "on_leave" ? "Leave" : null);
              // Half-day markers ([First/Second Half]) on the leave / WFH requests.
              const leaveHalfDir: "first" | "second" | null =
                leave ? (/\[first\s+half\]/i.test(leave.reason ?? "") ? "first" : /\[second\s+half\]/i.test(leave.reason ?? "") ? "second" : null) : null;
              const wfhHalfDir: "first" | "second" | null =
                wfh ? (/\[first\s+half\]/i.test(wfh.reason ?? "") ? "first" : /\[second\s+half\]/i.test(wfh.reason ?? "") ? "second" : null) : null;
              // A FULL-day leave renders as the centered "On <X> Leave" banner and
              // hides the timeline. A HALF-day leave does NOT — the employee works
              // the other half, so keep the timeline and show BOTH segments.
              const isLeaveRow = (rec.status === "on_leave" || isLeaveApproved) && !leaveHalfDir;
              // Both-segment label for a split day (half-day leave and/or half WFH):
              // each half is the leave type / WFH / (expected) Office.
              const halfKind = (which: "first" | "second"): string =>
                leaveHalfDir === which ? (leaveTypeName || "Leave")
                : wfhHalfDir === which ? "WFH"
                : "Office";
              const isSplitDay = !!(leaveHalfDir || wfhHalfDir);
              const splitLabel = isSplitDay ? `1st Half ${halfKind("first")} · 2nd Half ${halfKind("second")}` : null;

              // Admins can regularize any past/today row that doesn't already
              // have a regularization in flight — including leave days (employee
              // actually showed up while on leave) and weekends/holidays
              // (worked on a day off). Future dates are skipped.
              const isFuture = dateOnly > today.toISOString().slice(0, 10);
              const canRegularize = isHRAdmin && !isRegPending && !isFuture;

              // Row background tinting per status — matches the Keka light theme.
              const rowBg =
                isToday      ? "bg-sky-50/50"
                : isLeaveRow ? "bg-violet-50/40"
                : isWeekend  ? "bg-slate-100/60"
                : isHoliday  ? "bg-amber-50/40"
                : "bg-white hover:bg-slate-50/60";

              // Today's row keeps ticking live for as long as a session
              // is open. Without this, after clocking back in from a
              // break the row would freeze at the closed-session sum
              // (what Attendance.totalMinutes stores). Mirrors the
              // attendance-page elapsed math: stored total + elapsed
              // since the currently-open session's clockIn.
              const sess = (rec.sessions ?? []) as Array<{ clockIn: string; clockOut: string | null }>;
              const openSess = sess.find((s) => !s.clockOut);
              const baseMin = rec.totalMinutes ?? 0;
              const liveMin = isToday && openSess
                ? baseMin + Math.max(0, Math.floor((now.getTime() - new Date(openSess.clockIn).getTime()) / 60000))
                : baseMin;
              const totalMin = liveMin;
              const effectiveDot = totalMin >= 480 ? "bg-emerald-500" : totalMin >= 240 ? "bg-amber-500" : totalMin > 0 ? "bg-red-500" : "bg-slate-300";

              // ── Status-tag flags (Late / Missed / On break) ──
              // Mirrors the Me-section row badges (in /dashboard/hr/attendance)
              // so HR sees the same context here when they open someone's
              // profile. Suppressed when a pending request covers the day —
              // matches the Me-section's `!hasPendingAny` guard so a pending
              // regularization / WFH / leave hides the harsher "Late" or
              // "Missed" label until the request is decided.
              const hasPendingAny = !!(isRegPending || isWfhPending || isLeavePending);
              const firstIn = sess[0]?.clockIn
                ? new Date(sess[0].clockIn)
                : (rec.clockIn ? new Date(rec.clockIn) : null);
              const isLateFirstIn = !!firstIn && (() => {
                // Late = first clock-in past the SHIFT-SPECIFIC
                // cutoff (shift.startTime + breakMinutes grace).
                // Falls back to 10:00 IST + 0 grace when the
                // employee has no shift assigned (matches clock-in
                // route's legacy rule). UTC + 5:30 → IST minutes-of-
                // day; don't use getHours() — that's the SERVER's
                // local TZ and would skew the cutoff.
                const totalUtcMin = firstIn.getUTCHours() * 60 + firstIn.getUTCMinutes();
                const istMin      = (totalUtcMin + 330) % (24 * 60);
                const [sh, sm]    = shiftStartTime
                  ? String(shiftStartTime).split(":").map((n: string) => Number(n) || 0)
                  : [10, 0];
                const grace       = Number.isFinite(shiftBreakMinutes) ? Number(shiftBreakMinutes) : (shiftStartTime ? 15 : 0);
                const cutoffMin   = sh * 60 + sm + grace;
                return istMin > cutoffMin;
              })();
              const missedClockOut = !!rec.clockIn && !rec.clockOut && !isToday && !rec.isRegularized && !isLeaveRow;
              // "On break" — today, all closed sessions, day-total still < 9h.
              // Means the user clocked out for a break but hasn't hit the
              // 9h threshold; not yet "done for the day".
              const isOnBreak = isToday && !openSess && sess.some((s) => s.clockOut) && !rec.isRegularized && (rec.totalMinutes || 0) < 540;

              return (
                <tr key={rec.id} className={`border-b border-slate-100 transition-colors ${rowBg}`}>
                  {/* Date + badges */}
                  <td className="px-5 py-3 align-middle">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-medium text-slate-800">{dateLabel}</p>
                      {isToday        ? <span className="inline-flex items-center rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700">Today</span> : null}
                      {isLeaveRow     ? <span className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">Leave</span> : null}
                      {isWeekend      ? <span className="inline-flex items-center rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">W-Off</span> : null}
                      {isHoliday      ? <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Holiday</span> : null}
                      {isWfhApproved && !isLeaveRow ? <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700">WFH</span> : null}
                      {/* Request in flight (regularization / WFH / leave) —
                          same chip the employee sees on their own attendance
                          page, so HR knows the day is awaiting a decision
                          (the split-day summary below shows even while
                          pending, which used to read as already-approved). */}
                      {hasPendingAny ? <span className="inline-flex items-center rounded bg-[#008CFF]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#008CFF]">Pending</span> : null}
                      {/* New tags (matches Me-section) */}
                      {isLop ? <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">{isHalfDayLop ? "½ Day LOP" : "LOP"}</span> : null}
                      {/* Under-9h day that clocked out but wasn't regularised —
                          payroll counts it as ½ day (0.5 LOP). Surface it loudly
                          so HR doesn't mistake the "completed punch" ✓ for a full
                          day. Suppressed while a request is pending / for today. */}
                      {rec.status === "half_day" && !isToday && !hasPendingAny ? <span title="Worked under 9h — counts as ½ day (0.5 LOP) in payroll unless regularized" className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700"><AlertCircle size={10} strokeWidth={2.5} /> ½ Half day</span> : null}
                      {missedClockOut && !hasPendingAny && !isLop ? <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Missed</span> : null}
                      {isLateFirstIn && !!rec.clockIn && !hasPendingAny && !isLeaveRow ? <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">Late</span> : null}
                      {isOnBreak ? <span className="inline-flex items-center rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-700">On break</span> : null}
                    </div>
                    {/* Split-day summary so HR + the employee can see BOTH halves
                        at a glance (e.g. 1st Half Sick Leave · 2nd Half WFH). */}
                    {splitLabel && (
                      <p className="mt-1 text-[10.5px] font-semibold text-violet-600">{splitLabel}</p>
                    )}
                  </td>

                  {/* Attendance Visual / centered text — used for all "no real
                      punches" cases (leave / w-off / holiday / pending requests
                      / regularization). Reads cleaner than a striped bar. */}
                  {(() => {
                    // "Has actual punches" means there's at least a real
                    // clock-in on the row. An open session (clockOut still
                    // null) is real data — the live timeline + counter
                    // still tell the user what's been worked so far. The
                    // old `clockIn && clockOut` rule treated today's open
                    // session as "no data" and hid the timeline behind a
                    // centered "Regularization Pending" banner, which made
                    // the row look like attendance was missing.
                    const hasActualPunches = !!rec.clockIn;
                    const isRegOnly = !hasActualPunches && (isRegPending || isRegApproved);
                    const showCentered = isWeekend || isLeaveRow || isHoliday
                      || (isLeavePending && !isPresent)
                      || (isWfhPending && !isPresent && !isWfhApproved)
                      || isRegOnly
                      // Split day (half leave / half WFH) with no punches yet →
                      // show the both-segment label instead of an empty bar.
                      || (isSplitDay && !hasActualPunches)
                      // LOP rows have no usable punches → show the centered LOP
                      // banner instead of an empty bar. (For a half-day LOP the
                      // row does carry a clock-in, but the day is already docked,
                      // so the banner is the clearer signal.)
                      || (isLop && !isRegApproved);
                    if (!showCentered) return null;
                    const fmt = (d: string | Date | null | undefined) => d
                      ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
                      : null;
                    const regWindow = reg?.requestedIn && reg?.requestedOut
                      ? `${fmt(reg.requestedIn)} → ${fmt(reg.requestedOut)}`
                      : null;
                    const label = isSplitDay
                      ? splitLabel
                      : isLeaveRow
                      ? `On ${leaveTypeName || "Leave"}${leave?.totalDays && leave.totalDays > 1 ? ` (${leave.totalDays} days)` : ""}`
                      : isLeavePending  ? `Leave Pending — ${leave?.leaveType?.name || "Leave"}`
                      : isWfhPending    ? "WFH Pending Approval"
                      : isWeekend       ? "Full day Weekly-off"
                      : isHoliday       ? (rec.notes || "Public Holiday")
                      : isHalfDayLop    ? "Half-day LOP — missed clock-out not regularized in time"
                      : isFullLop       ? "Full-day LOP — absent, no attendance logged"
                      : isRegPending    ? `Regularization Pending${regWindow ? ` · ${regWindow}` : ""}`
                      : isRegApproved   ? `Regularized${regWindow ? ` · ${regWindow}` : ""}`
                      : "";
                    const tone =
                      isLop                                          ? "text-red-600"
                      : isLeavePending || isWfhPending || isRegPending ? "text-amber-700"
                      : isLeaveRow                                    ? "text-violet-700"
                      : isRegApproved                                 ? "text-emerald-700"
                      : isHoliday                                     ? "text-amber-700"
                      :                                                 "text-slate-500";
                    return (
                      <td className="px-5 py-3 text-center align-middle" colSpan={3}>
                        <span className={`text-[12.5px] font-medium ${tone}`}>{label}</span>
                      </td>
                    );
                  })() || (
                    <>
                      <td className="px-5 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            {/* If actual punches are missing but a regularization
                                is in flight or approved, draw the bar from the
                                regularization's requested times instead — so the
                                row visualises what attendance would look like once
                                approved. Tone changes color: amber-striped while
                                pending, emerald when approved, sky when actual. */}
                            {(() => {
                              // Prefer the real clock-in whenever it exists
                              // (open session counts). Only fall back to the
                              // regularization's requested times when there
                              // are no real punches at all — matches the
                              // hasActualPunches check above so the centered
                              // banner and the bar agree on what to draw.
                              const hasActual = !!rec.clockIn;
                              const useReg = !hasActual && reg && (reg.requestedIn || reg.requestedOut);
                              const barIn  = useReg ? reg.requestedIn  : rec.clockIn;
                              const barOut = useReg ? reg.requestedOut : rec.clockOut;
                              const barTone: BarTone = useReg
                                ? (isRegPending ? "pending" : isRegApproved ? "approved" : "default")
                                : "default";
                              return <TimelineBar clockIn={barIn} clockOut={barOut} tone={barTone} sessions={hasActual ? sess : undefined} isTodayRow={isToday} doorEntries={(rec as any).doorEntries} />;
                            })()}
                          </div>
                          <LocationLink raw={rec.location} />
                        </div>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        {(() => {
                          // Compute regularization-based hours when actual punches are missing.
                          const hasActual = !!rec.clockIn;
                          let mins = totalMin;
                          if (!hasActual && reg && reg.requestedIn && reg.requestedOut) {
                            mins = Math.max(0, Math.round((new Date(reg.requestedOut).getTime() - new Date(reg.requestedIn).getTime()) / 60000));
                          }
                          const dot = isRegPending  ? "bg-amber-500" :
                                      isRegApproved ? "bg-emerald-500" :
                                      mins >= 480 ? "bg-emerald-500" : mins >= 240 ? "bg-amber-500" : mins > 0 ? "bg-red-500" : "bg-slate-300";
                          if (isPresent || (reg && (isRegPending || isRegApproved))) {
                            return (
                              <div className="flex items-center gap-2">
                                <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                                <span className={`text-[12.5px] ${isRegPending ? "italic text-amber-700" : "text-slate-700"}`}>
                                  {fmtMins(mins) || "0h 0m"}{rec.status === "half_day" ? " +" : ""}
                                </span>
                              </div>
                            );
                          }
                          // Clocked in but never clocked out (status didn't flip to
                          // present/late/half_day). Surface "Incomplete" instead of
                          // a silent dash so HR can see the row needs attention.
                          if (hasActual && !rec.clockOut) {
                            return (
                              <span
                                className="text-[12.5px] italic text-amber-700"
                                title="Clocked in but no clock-out recorded — regularization needed"
                              >
                                Incomplete
                              </span>
                            );
                          }
                          return <span className="text-[12.5px] text-slate-400">—</span>;
                        })()}
                      </td>
                      <td className="px-5 py-3 align-middle">
                        {(() => {
                          const hasActual = !!rec.clockIn;
                          let mins = totalMin;
                          if (!hasActual && reg && reg.requestedIn && reg.requestedOut) {
                            mins = Math.max(0, Math.round((new Date(reg.requestedOut).getTime() - new Date(reg.requestedIn).getTime()) / 60000));
                          }
                          if (isPresent || (reg && (isRegPending || isRegApproved))) {
                            return (
                              <span className={`text-[12.5px] ${isRegPending ? "italic text-amber-700" : "text-slate-700"}`}>
                                {fmtMins(mins) || "0h 0m"}
                              </span>
                            );
                          }
                          if (hasActual && !rec.clockOut) {
                            return (
                              <span
                                className="text-[12.5px] italic text-amber-700"
                                title="Clocked in but no clock-out recorded"
                              >
                                Incomplete
                              </span>
                            );
                          }
                          return <span className="text-[12.5px] text-slate-400">—</span>;
                        })()}
                      </td>
                    </>
                  )}

                  {/* Log status — pending requests take priority over the attendance icon */}
                  <td className="px-5 py-3 text-center align-middle">
                    {isLeavePending ? (
                      <span
                        title="Leave application pending approval"
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Leave
                      </span>
                    ) : isWfhPending ? (
                      <span
                        title="WFH request pending approval"
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        WFH
                      </span>
                    ) : isRegPending ? (
                      <span
                        title={reg.status === "partially_approved" ? "Partially approved — awaiting final approver" : "Regularization pending approval"}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Reg.
                      </span>
                    ) : isLeaveRow ? (
                      <span
                        title={`On ${leaveTypeName || "Leave"}`}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-inset ring-violet-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                        Leave
                      </span>
                    ) : isWfhApproved ? (
                      <span
                        title="Approved Work From Home"
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        WFH
                      </span>
                    ) : isRegApproved ? (
                      <span
                        title="Regularization approved"
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-inset ring-emerald-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Reg.
                      </span>
                    ) : rec.status === "half_day" && !isToday ? (
                      // Clocked out under 9h and not regularised → payroll docks
                      // 0.5 LOP. Show an amber "½ Day" flag instead of the same
                      // green ✓ a full day gets, so HR spots it at a glance. For
                      // admins it doubles as a one-click regularize affordance.
                      isHRAdmin ? (
                        <button
                          type="button"
                          onClick={() => openRegFor(rec)}
                          title="Worked under 9h — counts as ½ day (0.5 LOP) in payroll. Click to regularize."
                          aria-label="Half day — regularize this day"
                          className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 ring-1 ring-inset ring-orange-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)] transition hover:bg-orange-100 hover:ring-orange-300"
                        >
                          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
                          ½ Day
                        </button>
                      ) : (
                        <span
                          title="Worked under 9h — counts as ½ day (0.5 LOP) in payroll unless regularized"
                          className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 ring-1 ring-inset ring-orange-200"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                          ½ Day
                        </span>
                      )
                    ) : isPresent ? (
                      <span
                        title="Clock-in completed"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200 shadow-[0_1px_2px_rgba(16,185,129,0.18)]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      </span>
                    ) : isToday && !rec.clockIn ? (
                      <span
                        title="Not clocked in yet"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </span>
                    ) : isLop ? (
                      <span
                        title={isHalfDayLop ? "Half-day LOP — missed clock-out not regularized in time" : "Full-day LOP — absent, no attendance logged"}
                        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700 ring-1 ring-inset ring-red-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        {isHalfDayLop ? "½ LOP" : "LOP"}
                      </span>
                    ) : rec.status === "absent" ? (
                      // Absent day → render a "Regularize" affordance instead
                      // of a passive cross. HR admins open the on-behalf
                      // modal; the profile owner is deep-linked into
                      // /dashboard/hr/attendance with the date pre-filled
                      // so they can self-apply. Anyone else (rare: an HR
                      // viewer who's not an admin) still sees the icon but
                      // it's non-interactive.
                      isHRAdmin ? (
                        <button
                          type="button"
                          onClick={() => openRegFor(rec)}
                          title="Regularize this day"
                          aria-label="Regularize this day"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)] transition hover:bg-amber-100 hover:ring-amber-300"
                        >
                          <ShieldCheck className="h-4 w-4" strokeWidth={2.25} />
                        </button>
                      ) : isSelfView ? (
                        <Link
                          href={`/dashboard/hr/attendance?apply=regularize&date=${dateOnly}`}
                          title="Regularize this day"
                          aria-label="Regularize this day"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)] transition hover:bg-amber-100 hover:ring-amber-300"
                        >
                          <ShieldCheck className="h-4 w-4" strokeWidth={2.25} />
                        </Link>
                      ) : (
                        <span
                          title="Absent — ask HR to regularize"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-500 ring-1 ring-inset ring-amber-200"
                        >
                          <ShieldCheck className="h-4 w-4" strokeWidth={2.25} />
                        </span>
                      )
                    ) : null}
                  </td>

                  {/* Admin kebab — 3-dot menu opens an on-behalf action picker:
                      Regularization (existing modal), WFH (new modal), Leave (new modal).
                      data-hr-menu lets the outside-click closer skip clicks on these
                      elements so option onClick handlers actually fire. */}
                  {isHRAdmin ? (
                    <td className="px-3 py-3 text-right align-middle relative">
                      {canRegularize ? (
                        <>
                          <button
                            type="button"
                            data-hr-menu
                            onClick={(e) => {
                              if (menuOpenKey === dateOnly) { setMenuOpenKey(null); return; }
                              setMenuRect(e.currentTarget.getBoundingClientRect());
                              setMenuOpenKey(dateOnly);
                            }}
                            title="HR actions"
                            aria-label="Open HR actions menu"
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {menuOpenKey === dateOnly && menuRect && typeof document !== "undefined" ? createPortal(
                            <div
                              data-hr-menu
                              className="fixed z-[100] min-w-[160px] rounded-md border border-slate-200 bg-white shadow-lg text-left text-[12.5px]"
                              style={(() => {
                                const vh = typeof window !== "undefined" ? window.innerHeight : 800;
                                const left = Math.max(8, menuRect.right - 160);
                                // Flip up when the button sits low in the viewport
                                // so the menu never spills below the fold.
                                return menuRect.bottom > vh * 0.65
                                  ? { bottom: vh - menuRect.top + 4, left }
                                  : { top: menuRect.bottom + 4, left };
                              })()}
                            >
                              <button
                                type="button"
                                onClick={() => { setMenuOpenKey(null); openRegFor(rec); }}
                                className="block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700"
                              >
                                Regularization
                              </button>
                              <button
                                type="button"
                                onClick={() => openWfhFor(rec)}
                                className="block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700 border-t border-slate-100"
                              >
                                WFH
                              </button>
                              <button
                                type="button"
                                onClick={() => openOdFor(rec)}
                                className="block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700 border-t border-slate-100"
                              >
                                On Duty
                              </button>
                              <button
                                type="button"
                                onClick={() => openLeaveFor(rec)}
                                className="block w-full px-3 py-2 text-slate-700 hover:bg-sky-50 hover:text-sky-700 border-t border-slate-100"
                              >
                                Leave
                              </button>
                            </div>,
                            document.body,
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}

      {/* Regularize-on-behalf modal — admin only */}
      {regOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md flex flex-col max-h-[90vh] rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">Regularize attendance</h3>
                <p className="text-[11.5px] text-slate-500">For {userName} · {regForm.date}</p>
              </div>
              <button onClick={() => setRegOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clock-in</label>
                  <input
                    type="datetime-local"
                    value={regForm.requestedIn}
                    onChange={(e) => setRegForm((f) => ({ ...f, requestedIn: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clock-out</label>
                  <input
                    type="datetime-local"
                    value={regForm.requestedOut}
                    onChange={(e) => setRegForm((f) => ({ ...f, requestedOut: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={regForm.reason}
                  onChange={(e) => setRegForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  placeholder="Why is this regularization being granted?"
                  className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>

              <div className="rounded bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 ring-1 ring-inset ring-amber-200">
                Submitting marks this regularization as <strong>admin-granted</strong>. It still needs L1 / L2 approval to apply to attendance.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 flex-shrink-0">
              <button
                onClick={() => setRegOpen(false)}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitReg}
                disabled={submitting || !regForm.reason.trim()}
                className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Grant regularization"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── HR on-behalf: WFH modal ───────────────────────────────────── */}
      {/* ── HR on-behalf: On Duty modal ────────────────────────────── */}
      {odOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md flex flex-col max-h-[90vh] rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">Submit On Duty</h3>
                <p className="text-[11.5px] text-slate-500">For {userName}</p>
              </div>
              <button onClick={() => setOdOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                  <DateField
                    value={odForm.date}
                    onChange={(v) => setOdForm((f) => ({ ...f, date: v, toDate: f.toDate && f.toDate >= v ? f.toDate : v }))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                  <DateField
                    value={odForm.toDate}
                    onChange={(v) => setOdForm((f) => ({ ...f, toDate: v }))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Location <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></label>
                <input
                  value={odForm.location}
                  onChange={(e) => setOdForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Client office, Mumbai"
                  className="mt-1 h-9 w-full rounded border border-slate-200 px-2.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Purpose <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={odForm.purpose}
                  onChange={(e) => setOdForm((f) => ({ ...f, purpose: e.target.value }))}
                  rows={3}
                  placeholder="Why is on-duty being submitted on behalf?"
                  className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>
              {/* Handoff Details — workStatus is required; POC supports N/A
                  for HR-on-behalf where no specific cover is assigned. */}
              <HandoffSection
                poc={handoffPoc}
                onPocChange={setHandoffPoc}
                workStatus={handoffWorkStatus}
                onWorkStatusChange={setHandoffWorkStatus}
                allowNa
                naSelected={handoffPocNa}
                onNaChange={setHandoffPocNa}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 flex-shrink-0">
              <button
                onClick={() => { setOdOpen(false); resetHandoff(); }}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitOnDuty}
                disabled={submitting || !odForm.date || !odForm.purpose.trim()}
                className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Submit On Duty"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wfhOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md flex flex-col max-h-[90vh] rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">Grant Work From Home</h3>
                <p className="text-[11.5px] text-slate-500">For {userName}</p>
              </div>
              <button onClick={() => setWfhOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                  <DateField
                    value={wfhForm.date}
                    onChange={(v) => setWfhForm((f) => ({ ...f, date: v, toDate: f.toDate && f.toDate >= v ? f.toDate : v }))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                  <DateField
                    value={wfhForm.toDate}
                    onChange={(v) => setWfhForm((f) => ({ ...f, toDate: v }))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={wfhForm.reason}
                  onChange={(e) => setWfhForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  placeholder="Why is WFH being granted on behalf?"
                  className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 flex-shrink-0">
              <button
                onClick={() => setWfhOpen(false)}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitWfh}
                disabled={submitting || !wfhForm.date || !wfhForm.reason.trim()}
                className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Grant WFH"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── HR on-behalf: Leave + WFH unified modal ───────────────────── */}
      {leaveOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          {/* Flex column with capped height so the form body scrolls
              while the header + tab strip stay pinned to the top and
              the action footer stays pinned to the bottom. Fixes the
              small-screen bug where the Apply leave / Grant WFH button
              was pushed off the viewport. */}
          <div className="w-full max-w-md flex flex-col max-h-[90vh] rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">
                  {leaveModalTab === "leave" ? "Apply Leave on behalf" : "Grant Work From Home"}
                </h3>
                <p className="text-[11.5px] text-slate-500">For {userName}</p>
              </div>
              <button onClick={() => { setLeaveOpen(false); resetHandoff(); }} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tab strip */}
            <div className="flex border-b border-slate-100 px-2 flex-shrink-0">
              {(["leave", "wfh"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setLeaveModalTab(t)}
                  className={`px-4 py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors ${
                    leaveModalTab === t
                      ? "border-[#008CFF] text-[#008CFF]"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t === "leave" ? "Leave" : "WFH"}
                </button>
              ))}
            </div>

            {/* Scrollable form body — only this region scrolls. */}
            <div className="flex-1 overflow-y-auto">
            {leaveModalTab === "leave" ? (
              <div className="space-y-3 px-5 py-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Leave type</label>
                  <SelectField
                    value={leaveForm.leaveTypeId === "" ? "" : String(leaveForm.leaveTypeId)}
                    onChange={(v) => setLeaveForm((f) => ({ ...f, leaveTypeId: v ? Number(v) : "" }))}
                    placeholder="— Select type —"
                    options={leaveTypes.map((t) => {
                      const bal = targetBalances[t.id];
                      const balLabel = bal == null
                        ? ""
                        : `  ·  ${bal % 1 === 0 ? bal.toFixed(0) : bal.toFixed(1)} available`;
                      return { value: String(t.id), label: `${t.name}${balLabel}` };
                    })}
                    className="mt-1 w-full rounded border border-slate-200 h-9 px-2.5 text-[12.5px]"
                  />
                  {leaveForm.leaveTypeId && targetBalances[Number(leaveForm.leaveTypeId)] != null && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {userName} has{" "}
                      <span className={`font-semibold ${targetBalances[Number(leaveForm.leaveTypeId)] > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {targetBalances[Number(leaveForm.leaveTypeId)].toFixed(1)} day{targetBalances[Number(leaveForm.leaveTypeId)] === 1 ? "" : "s"}
                      </span>{" "}
                      available in this type.
                    </p>
                  )}
                </div>
                {/* Full / Half day pill — same convention as the user's
                    own leave form. Half-day pins toDate to fromDate. */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Day type</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { k: "full",        label: "Full Day"    },
                      { k: "first_half",  label: "First Half"  },
                      { k: "second_half", label: "Second Half" },
                    ].map((opt) => {
                      const active = grantDayKind === opt.k;
                      return (
                        <button
                          key={opt.k}
                          type="button"
                          onClick={() => {
                            const next = opt.k as typeof grantDayKind;
                            setGrantDayKind(next);
                            if (next !== "full") {
                              setLeaveForm((f) => ({ ...f, toDate: f.fromDate }));
                            }
                          }}
                          className={`h-8 px-3.5 rounded-full border text-[11.5px] font-semibold transition-colors ${
                            active
                              ? "bg-[#008CFF] text-white border-[#008CFF] shadow-sm"
                              : "bg-white text-slate-600 border-slate-200 hover:border-[#008CFF]/40 hover:text-[#008CFF]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                    <DateField
                      value={leaveForm.fromDate}
                      onChange={(v) => setLeaveForm((f) => ({ ...f, fromDate: v, toDate: f.toDate < v ? v : f.toDate }))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                    <DateField
                      value={leaveForm.toDate}
                      onChange={(v) => setLeaveForm((f) => ({ ...f, toDate: v }))}
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                    rows={3}
                    placeholder="Why is leave being granted on behalf?"
                    className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
                {/* Handoff Details — POC + Work Status. Required by the
                    leave API exactly the same as the user's own form.
                    Allow N/A so HR can skip POC when no cover assigned. */}
                <HandoffSection
                  poc={handoffPoc}
                  onPocChange={setHandoffPoc}
                  workStatus={handoffWorkStatus}
                  onWorkStatusChange={setHandoffWorkStatus}
                  allowNa
                  naSelected={handoffPocNa}
                  onNaChange={setHandoffPocNa}
                />
              </div>
            ) : (
              <div className="space-y-3 px-5 py-4">
                {/* Full / Half day pill — same as the Leave tab. Picking
                    a half-day collapses the WFH to a single date. */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Day type</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { k: "full",        label: "Full Day"    },
                      { k: "first_half",  label: "First Half"  },
                      { k: "second_half", label: "Second Half" },
                    ].map((opt) => {
                      const active = grantDayKind === opt.k;
                      return (
                        <button
                          key={opt.k}
                          type="button"
                          onClick={() => {
                            const next = opt.k as typeof grantDayKind;
                            setGrantDayKind(next);
                            if (next !== "full") {
                              setWfhForm((f) => ({ ...f, toDate: f.date }));
                            }
                          }}
                          className={`h-8 px-3.5 rounded-full border text-[11.5px] font-semibold transition-colors ${
                            active
                              ? "bg-[#008CFF] text-white border-[#008CFF] shadow-sm"
                              : "bg-white text-slate-600 border-slate-200 hover:border-[#008CFF]/40 hover:text-[#008CFF]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                    <DateField
                      value={wfhForm.date}
                      onChange={(v) => setWfhForm((f) => ({ ...f, date: v, toDate: f.toDate && f.toDate >= v ? f.toDate : v }))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                    <DateField
                      value={wfhForm.toDate}
                      onChange={(v) => setWfhForm((f) => ({ ...f, toDate: v }))}
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    value={wfhForm.reason}
                    onChange={(e) => setWfhForm((f) => ({ ...f, reason: e.target.value }))}
                    rows={3}
                    placeholder="Why is WFH being granted on behalf?"
                    className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
                {/* Handoff Details — POC + Work Status + Time of
                    Unavailability (WFH-only). The WFH API rejects the
                    request without workStatus / unavailability; POC is
                    N/A-eligible for HR-on-behalf. */}
                <HandoffSection
                  poc={handoffPoc}
                  onPocChange={setHandoffPoc}
                  workStatus={handoffWorkStatus}
                  onWorkStatusChange={setHandoffWorkStatus}
                  unavailability={handoffUnavailability}
                  onUnavailabilityChange={setHandoffUnavailability}
                  showUnavailability
                  allowNa
                  naSelected={handoffPocNa}
                  onNaChange={setHandoffPocNa}
                />
              </div>
            )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 flex-shrink-0">
              <button
                onClick={() => { setLeaveOpen(false); resetHandoff(); }}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              {leaveModalTab === "leave" ? (
                <button
                  onClick={submitLeave}
                  disabled={submitting || !leaveForm.leaveTypeId || !leaveForm.fromDate || !leaveForm.toDate || !leaveForm.reason.trim()}
                  className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Apply leave"}
                </button>
              ) : (
                <button
                  onClick={submitWfh}
                  disabled={submitting || !wfhForm.date || !wfhForm.reason.trim()}
                  className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Grant WFH"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
