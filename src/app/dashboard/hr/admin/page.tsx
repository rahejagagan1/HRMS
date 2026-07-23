"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { brandFromSlug, slugForBrand, type CompanyBrand } from "@/lib/hr-brand-scope";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import { Settings, Calendar, Clock, Users, Plus, Pencil, X, CheckCircle2, AlertCircle, Palmtree, Trash2, LayoutDashboard, CalendarDays, Package, CheckSquare, UserPlus, ShieldCheck, Briefcase, UserMinus, BarChart3, Banknote, ClipboardCheck, FileSpreadsheet, FileText, HeartPulse, Home, UserCheck } from "lucide-react";
import AttendanceDashboardPanel from "@/components/hr/AttendanceDashboardPanel";
import { DEPARTMENTS } from "@/lib/departments";
import { DEPARTMENTS_YT_LABS } from "@/lib/departments-yt-labs";
import AssetsPanel from "@/components/hr/AssetsPanel";
import ApprovalsPanel from "@/components/hr/ApprovalsPanel";
import ProbationApprovalsCard from "@/components/hr/ProbationApprovalsCard";
import PerformancePlanApprovalsCard from "@/components/hr/PerformancePlanApprovalsCard";
import LeavesAdminPanel from "@/components/hr/LeavesAdminPanel";
import LeavePoliciesPanel from "@/components/hr/LeavePoliciesPanel";
import PayrollAdminPanel from "@/components/hr/PayrollAdminPanel";
import RegularizationBalancePanel from "@/components/hr/RegularizationBalancePanel";
import WfhBalancesPanel from "@/components/hr/WfhBalancesPanel";
import PulseSurveysPanel from "@/components/hr/PulseSurveysPanel";
import SalaryStructuresList from "@/components/hr/SalaryStructuresList";
import EmployeePicker, { type PickerUser } from "@/components/hr/EmployeePicker";
import { RunPayrollPanel } from "@/app/dashboard/hr/payroll/run/page";
import { DateField } from "@/components/ui/date-field";
import {
  isHRAdmin,
  isFullHRAdmin,
  canViewSalary,
  isSalaryDeveloper,
  HR_MANAGER_ALLOWED_TABS,
  HR_MANAGER_ALLOWED_RAIL_LINKS,
} from "@/lib/access";

// Every HR-admin section is an inline state tab — no sub-routes.
type AdminTabDef = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
};
// Each sub-tab also carries the TabKey it's gated by in the central
// permissions catalog. Tab Permissions UI flipping any of these to
// false hides that section from the user.
const ADMIN_TABS: Array<AdminTabDef & { permKey: string }> = [
  { key: "attendance-dashboard", label: "Attendance Dashboard", icon: LayoutDashboard, permKey: "hr_admin_attendance"     },
  { key: "approvals",            label: "Approvals",            icon: CheckSquare,     permKey: "hr_admin_approvals"      },
  { key: "reviews",              label: "PIP & Probation",      icon: UserCheck,       permKey: "hr_admin_approvals"      },
  { key: "regularize-balance",   label: "Regularization Balance", icon: ClipboardCheck, permKey: "hr_admin_regularize_balance" },
  { key: "wfh-balances",         label: "WFH Balances",         icon: Home,            permKey: "hr_admin_wfh_balances"   },
  { key: "leaves",               label: "Leave Balances",       icon: Calendar,        permKey: "hr_admin_leaves"         },
  { key: "holidays",             label: "Holidays & Calendar",  icon: CalendarDays,    permKey: "hr_admin_holidays"       },
  { key: "leave-types",          label: "Leave Types",          icon: Calendar,        permKey: "hr_admin_leave_types"    },
  { key: "leave-policies",       label: "Leave Policies",       icon: Calendar,        permKey: "hr_admin_leave_policies" },
  { key: "shifts",               label: "Shift Templates",      icon: Clock,           permKey: "hr_admin_shifts"         },
  { key: "departments",          label: "Departments",          icon: Users,           permKey: "hr_admin_departments"    },
  { key: "payroll",              label: "Payroll",              icon: Banknote,        permKey: "hr_admin_payroll"        },
  { key: "salary-structures",    label: "Salary Structures",    icon: Banknote,        permKey: "hr_admin_payroll"        },
  { key: "pulse-surveys",        label: "Pulse & Surveys",      icon: HeartPulse,      permKey: "hr_admin_pulse_surveys"  },
];

const DAYS_LABEL = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// "HH:MM" → minutes-of-day (null when malformed) and back. Used by the shift
// form to preview the half-day boundary (mid-point of start/end) live.
const hmToMin = (hm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const minToHm = (min: number): string =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export default function HRAdminPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  // Hover-flyout state for the "Permissions" rail menu — mirrors the
  // Reports / HR-Me flyout pattern in the main sidebar. Hover opens;
  // hover-out closes after a 200ms grace so the cursor can travel from
  // the button into the submenu without it snapping shut. Click also
  // toggles (for accessibility + touch devices).
  const [permsOpen, setPermsOpen] = useState(false);
  const permsCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permsHandlers = {
    onMouseEnter: () => {
      if (permsCloseTimer.current) { clearTimeout(permsCloseTimer.current); permsCloseTimer.current = null; }
      setPermsOpen(true);
    },
    onMouseLeave: () => {
      permsCloseTimer.current = setTimeout(() => setPermsOpen(false), 200);
    },
  };
  useEffect(() => () => {
    if (permsCloseTimer.current) clearTimeout(permsCloseTimer.current);
  }, []);
  // Same hover-flyout pattern for the "Reviews" rail item → Probation / PIP.
  const [reviewsRailOpen, setReviewsRailOpen] = useState(false);
  const reviewsCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewsHandlers = {
    onMouseEnter: () => {
      if (reviewsCloseTimer.current) { clearTimeout(reviewsCloseTimer.current); reviewsCloseTimer.current = null; }
      setReviewsRailOpen(true);
    },
    onMouseLeave: () => {
      reviewsCloseTimer.current = setTimeout(() => setReviewsRailOpen(false), 200);
    },
  };
  useEffect(() => () => {
    if (reviewsCloseTimer.current) clearTimeout(reviewsCloseTimer.current);
  }, []);
  // Includes ceo / developer / special_access / role=admin / hr_manager —
  // all of whom should see the HR Dashboard. Full admins see every tab;
  // hr_manager-only users see a curated subset.
  const isAdmin = isHRAdmin(user);
  const isFullAdmin = isFullHRAdmin(user);

  // Pull the viewer's effective tab permissions so the rail links honour
  // explicit grants/revokes from the Permissions UI (not just role-based
  // defaults). Lets an admin grant `hr_hiring: true` to a Coordinator
  // and have them see the Hiring rail link without making them an admin.
  const { data: perms } = useSWR<{ permissions: Record<string, boolean> }>(
    "/api/hr/me/tab-permissions",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );
  const tabAllowed = (key: string) => (perms?.permissions?.[key] ?? true);

  // Filter tabs by tier first, then by per-user permission so admins
  // can grant / revoke individual sub-tabs through Tab Permissions UI.
  // tabAllowed() defaults to true when no explicit row exists — so
  // existing users keep seeing every tab they're entitled to until
  // someone flips the toggle.
  const tierTabs = isFullAdmin
    ? ADMIN_TABS
    : ADMIN_TABS.filter((t) => HR_MANAGER_ALLOWED_TABS.has(t.key));
  // Payroll tab is salary data — narrower gate than the rest of the
  // admin surface. Only HR Manager / CEO / developer ever see it, no
  // matter what isFullAdmin or per-user permissions say.
  const canSeeSalary = canViewSalary(user);
  // Salary Structures (all-org compensation table) is tighter still —
  // gagan-only (the salary-trusted developer, see SALARY_DEV_EMAIL). Even
  // HR Manager / CEO / other developers can't see it from here; if they
  // need a single employee's structure, the Finances tab on a profile
  // still serves that case for the salary-viewing tier.
  const isSalaryDev = isSalaryDeveloper(user);
  // Regularization Balance is a developer-only diagnostic view — not
  // even CEO / HR Manager. Hardcoded gate, can't be flipped via Tab
  // Permissions UI.
  const isDev = user?.isDeveloper === true;
  const salaryFiltered = tierTabs.filter((t) => {
    if (t.key === "payroll")             return canSeeSalary;
    if (t.key === "salary-structures")   return isSalaryDev;
    if (t.key === "regularize-balance")  return isDev;
    return true;
  });
  const visibleTabs = salaryFiltered.filter((t) => tabAllowed(t.permKey));
  // Rail links: full admins always see them; hr_manager-tier sees them
  // when both the curated whitelist allows it AND their tab permission
  // is on. Other roles see them only if Tab Permissions explicitly grants.
  const showOnboardRail   = isFullAdmin
    || (HR_MANAGER_ALLOWED_RAIL_LINKS.has("onboard")  && tabAllowed("hr_people"));
  const showOffboardRail  = isFullAdmin
    || (HR_MANAGER_ALLOWED_RAIL_LINKS.has("offboard") && tabAllowed("hr_offboard"));
  const showHiringRail    = isFullAdmin
    || (HR_MANAGER_ALLOWED_RAIL_LINKS.has("hiring")   && tabAllowed("hr_hiring"));
  const showTabPermsRail  = isFullAdmin; // policy config — admin-only
  const showManageKpisRail = isFullAdmin; // KPI uploads — admin-only
  // Master Sheet (Excel exports) — HR department needs it too. The page and
  // export API already gate on isHRAdmin, so align the rail link with that.
  const showMasterSheetRail = isAdmin;

  // URL-synced — refresh stays on the same admin section.
  // Untyped allowed-values list because ADMIN_TABS may be filtered
  // for hr_manager-only viewers; we still want the URL value
  // honoured if it's a valid key for the current viewer.
  const [tab, setTab] = useUrlTab<string>("tab", "attendance-dashboard");

  // ── Brand scope (NB Media vs YT Labs sub-dashboards) ───────────────
  // The sidebar exposes the HR Dashboard as a hover-flyout with two
  // brand entries that route here as ?brand=nb-media or ?brand=yt-labs
  // (and ?brand=all for super-admins). When set, that value is passed
  // down as `initialBrand` to each panel so they open scoped to that
  // brand. Absent param → fallback to the in-panel auto-detect (viewer
  // brand, or "all" for super-admin) — unchanged from before.
  const searchParams = useSearchParams();
  const brandParam   = searchParams.get("brand");
  const initialBrand: CompanyBrand | null = useMemo(
    () => brandFromSlug(brandParam),
    [brandParam],
  );
  const brandLabel = initialBrand === "NB Media" ? "NB Media"
                   : initialBrand === "YT Labs"  ? "YT Labs"
                   : initialBrand === "all"      ? "All brands"
                   : null;

  // If the current tab isn't visible (because tier-curation OR a
  // per-user revoke removed it), snap to the first visible tab. We
  // can't always pick attendance-dashboard since admins might revoke
  // even that one for a specific user.
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((t) => t.key === tab)) {
      setTab(visibleTabs[0].key);
    }
  }, [visibleTabs, tab]);

  const { data: leaveTypes = [] } = useSWR("/api/hr/admin/leave-types", fetcher);
  // Shifts API honours ?brand=… — pass the URL brand so the list
  // reflects the active brand tab (NB Media / YT Labs).
  const shiftsBrandParam =
    initialBrand === "NB Media" ? "?brand=NB%20Media"
  : initialBrand === "YT Labs"  ? "?brand=YT%20Labs"
  : "";
  const { data: shifts = [] }     = useSWR(`/api/hr/admin/shifts${shiftsBrandParam}`, fetcher);
  // Admin tabs use this for headcount + department / manager breakdowns —
  // only active employees should be counted, otherwise offboarded folks
  // would inflate the totals and "Show inactive" toggle on the People
  // directory becomes the single place HR sees inactive people.
  const { data: employees = [] }  = useSWR("/api/hr/employees?isActive=true", fetcher);
  const { data: holidays = [] }   = useSWR("/api/hr/admin/holidays", fetcher);
  // Pending approvals count — feeds the badge on the "Approvals" rail item.
  // Forward the URL brand so the badge tracks the current sub-dashboard
  // (matches what the user sees inside the Approvals panel).
  const approvalsBrandQs =
    initialBrand === "YT Labs"  ? "?brand=yt-labs" :
    initialBrand === "NB Media" ? "?brand=nb-media" :
    "";
  // Same brand suffix carried into the Permissions rail links so the
  // Permissions pages auto-scope to the current sub-dashboard's brand.
  const permBrandQs = approvalsBrandQs;
  const { data: approvalsSummary } = useSWR<{ byTab: Record<string, number>; total: number }>(
    `/api/hr/approvals/summary${approvalsBrandQs}`,
    fetcher,
    { refreshInterval: 60_000 }
  );
  const approvalsTotal = approvalsSummary?.total ?? 0;

  // Pending probation recommendations awaiting HR — feeds the badge on the
  // "Probation Reviews" rail item + the panel below.
  // Brand scope for the Reviews badges (NB Media / YT Labs sub-dashboards).
  const reviewsBrandQs = initialBrand === "NB Media" || initialBrand === "YT Labs" ? `&brand=${encodeURIComponent(initialBrand)}` : "";
  const { data: probationHr } = useSWR<{ reviews: any[] }>(`/api/hr/probation-reviews?scope=hr${reviewsBrandQs}`, fetcher, { refreshInterval: 60_000 });
  const probationTotal = probationHr?.reviews?.length ?? 0;
  // Pending PIP recommendations awaiting HR — badge on the "PIP Reviews" rail item.
  const { data: pipHr } = useSWR<{ reviews: any[] }>(`/api/hr/pip-reviews?scope=hr${reviewsBrandQs}`, fetcher, { refreshInterval: 60_000 });
  const pipTotal = pipHr?.reviews?.length ?? 0;
  const [reviewsSub, setReviewsSub] = useState<"probation" | "pip">("probation");

  const [showHolidayForm, setShowHolidayForm] = useState(false);
  // editingHolidayId !== null means the modal is in edit mode (PUT to
  // /api/hr/admin/holidays with id in the body); null means it's a new
  // holiday (POST). The form fields are shared either way.
  const [editingHolidayId, setEditingHolidayId] = useState<number | null>(null);
  const [holidayForm, setHolidayForm] = useState({ name: "", date: "", isOptional: false });

  const openHolidayEdit = (h: any) => {
    setEditingHolidayId(h.id);
    setHolidayForm({
      name: h.name ?? "",
      // `date` from API is an ISO string; the DateField needs YYYY-MM-DD.
      date: typeof h.date === "string" ? h.date.slice(0, 10) : new Date(h.date).toISOString().slice(0, 10),
      isOptional: h.type === "optional",
    });
    setShowHolidayForm(true);
  };

  const closeHolidayForm = () => {
    setShowHolidayForm(false);
    setEditingHolidayId(null);
    setHolidayForm({ name: "", date: "", isOptional: false });
  };

  const saveHoliday = async () => {
    // The DB stores the "Optional holiday" toggle as the `type` column
    // ("public" = mandatory, "optional" = employee can choose). Project
    // the front-end's `isOptional` boolean back into that string before
    // sending so the row actually persists with the right flavour.
    const payload: any = {
      name: holidayForm.name,
      date: holidayForm.date,
      type: holidayForm.isOptional ? "optional" : "public",
    };
    if (editingHolidayId != null) payload.id = editingHolidayId;
    const res = await fetch("/api/hr/admin/holidays", {
      method: editingHolidayId != null ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) { closeHolidayForm(); mutate("/api/hr/admin/holidays"); }
    else alert((await res.json()).error);
  };

  const deleteHoliday = async (id: number) => {
    await fetch(`/api/hr/admin/holidays?id=${id}`, { method: "DELETE" });
    mutate("/api/hr/admin/holidays");
  };

  // Leave type form
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [editLeave, setEditLeave] = useState<any>(null);
  const [leaveForm, setLeaveForm] = useState({ name: "", description: "", daysPerYear: "12", isPaid: true, carryForward: false, maxCarryForward: "", applicable: true, adminOnly: false });

  // Shift form
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [editShift, setEditShift] = useState<any>(null);
  const [shiftForm, setShiftForm] = useState({ name: "", startTime: "09:00", endTime: "18:00", gracePeriodMinutes: "15", halfDayGraceMinutes: "", workingDays: [1,2,3,4,5], saturdayPolicy: "all", saturdayWeeks: [] as number[] });
  // Apply-shift-to-employees modal state.
  const [applyShift, setApplyShift] = useState<any>(null);
  const [applyScope, setApplyScope] = useState<"all" | "nb_media" | "yt_labs" | "specific">("all");
  const [applyUsers, setApplyUsers] = useState<PickerUser[]>([]);
  const [applyBusy, setApplyBusy] = useState(false);

  const submitApply = async () => {
    if (!applyShift) return;
    setApplyBusy(true);
    try {
      const res = await fetch(`/api/hr/admin/shifts/${applyShift.id}/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: applyScope,
          userIds: applyScope === "specific" ? applyUsers.map((u) => u.id) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to apply shift"); return; }
      alert(`Applied "${applyShift.name}" to ${data.applied} employee(s) — ${data.created} new, ${data.reassigned} reassigned.`);
      setApplyShift(null); setApplyUsers([]); setApplyScope("all");
    } finally { setApplyBusy(false); }
  };

  const openLeaveEdit = (lt: any) => {
    setEditLeave(lt);
    setLeaveForm({
      name: lt.name,
      description: lt.description || "",
      daysPerYear: String(lt.daysPerYear),
      isPaid: lt.isPaid,
      carryForward: lt.carryForward,
      maxCarryForward: lt.maxCarryForward ? String(lt.maxCarryForward) : "",
      applicable: lt.applicable !== false,
      adminOnly:  lt.adminOnly === true,
    });
    setShowLeaveForm(true);
  };

  const openShiftEdit = (s: any) => {
    setEditShift(s);
    // Server returns workDays as string labels ("Mon","Tue",…) and
    // breakMinutes as Int. The form state uses numeric day indices and
    // a string-typed grace input, so map both directions here. Defensive
    // against legacy rows that stored numeric indices in workDays.
    const rawDays: unknown[] = Array.isArray(s.workDays) ? s.workDays
      : Array.isArray(s.workingDays) ? s.workingDays : [];
    const workingDays = rawDays
      .map((d) => typeof d === "number" ? d : DAYS_LABEL.indexOf(String(d)))
      .filter((n): n is number => n >= 0);
    const breakRaw = s.breakMinutes ?? s.gracePeriodMinutes ?? 15;
    setShiftForm({
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      gracePeriodMinutes: String(breakRaw),
      // Empty string = "inherit the main grace" (stored NULL).
      halfDayGraceMinutes: s.halfDayGraceMinutes == null ? "" : String(s.halfDayGraceMinutes),
      workingDays,
      saturdayPolicy: s.saturdayPolicy ?? "all",
      saturdayWeeks: Array.isArray(s.saturdayWeeks) ? s.saturdayWeeks : [],
    });
    setShowShiftForm(true);
  };

  const saveLeave = async () => {
    const method = editLeave ? "PUT" : "POST";
    const body = editLeave ? { ...leaveForm, id: editLeave.id } : leaveForm;
    const res = await fetch("/api/hr/admin/leave-types", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { setShowLeaveForm(false); setEditLeave(null); mutate("/api/hr/admin/leave-types"); }
    else alert((await res.json()).error);
  };

  const saveShift = async () => {
    const method = editShift ? "PUT" : "POST";
    // Convert numeric day indices → string labels so the Shift.workDays
    // JSON column stays in the canonical "Mon"/"Tue"/… form that
    // auto-lop and the rest of the codebase expect.
    const workDays = shiftForm.workingDays
      .map((i) => DAYS_LABEL[i])
      .filter(Boolean);
    // Saturday rule only matters when Saturday is actually a working day.
    const satSelected = shiftForm.workingDays.includes(6);
    const payload = {
      name: shiftForm.name,
      startTime: shiftForm.startTime,
      endTime: shiftForm.endTime,
      breakMinutes: shiftForm.gracePeriodMinutes,
      // "" → NULL (inherit breakMinutes) server-side.
      halfDayGraceMinutes: shiftForm.halfDayGraceMinutes,
      workDays,
      saturdayPolicy: satSelected ? shiftForm.saturdayPolicy : "all",
      saturdayWeeks: satSelected && shiftForm.saturdayPolicy === "weeks" ? shiftForm.saturdayWeeks : [],
      // Brand stamp: an all-brands admin creates the shift for the brand
      // tab they're on (NB / YT). Scoped HR can send anything — the server
      // always stamps their OWN brand. On the "All brands" tab this stays
      // undefined → a deliberately shared (both-brands) template.
      brand: initialBrand && initialBrand !== "all" ? initialBrand : undefined,
    };
    const body = editShift ? { ...payload, id: editShift.id } : payload;
    const res = await fetch("/api/hr/admin/shifts", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    // Revalidate the SAME key the list reads — it's brand-suffixed, so a
    // bare "/api/hr/admin/shifts" mutate would never refresh a brand view.
    if (res.ok) { setShowShiftForm(false); setEditShift(null); mutate(`/api/hr/admin/shifts${shiftsBrandParam}`); }
    else alert((await res.json()).error);
  };

  const toggleDay = (d: number) => {
    setShiftForm(f => {
      const removing = f.workingDays.includes(d);
      const workingDays = removing ? f.workingDays.filter(x => x !== d) : [...f.workingDays, d].sort();
      // Clear the Saturday rule when Saturday is de-selected so a re-add starts fresh.
      const satGone = d === 6 && removing;
      return {
        ...f,
        workingDays,
        saturdayPolicy: satGone ? "all" : f.saturdayPolicy,
        saturdayWeeks:  satGone ? []    : f.saturdayWeeks,
      };
    });
  };

  // Company tab scope — splits Department Breakdown into NB Media vs
  // YT Labs so HR can see each brand's org structure in isolation.
  // "all" combines both. Seeds from the URL brand when present
  // (sidebar flyout), else default to NB Media (parent brand).
  type CompanyTab = "NB Media" | "YT Labs" | "all";
  const [companyTab, setCompanyTab] = useState<CompanyTab>(initialBrand ?? "NB Media");
  // Sync to URL brand changes (flyout navigation).
  useEffect(() => {
    if (initialBrand != null) setCompanyTab(initialBrand);
  }, [initialBrand]);

  // Apply the company scope to the employees list before grouping by
  // department. Empty businessUnit → bucketed as "NB Media" so legacy
  // rows stay visible there by default.
  const scopedEmployees = employees.filter((e: any) => {
    if (companyTab === "all") return true;
    const bu = e.employeeProfile?.businessUnit || "NB Media";
    return bu === companyTab;
  });

  // Dept breakdown from employees — group full employee records by
  // department so the breakdown row can show team avatars instead of
  // a percentage bar. Sort departments by team size, biggest first.
  // For non-"all" tabs we also seed the canonical YT Labs / NB Media
  // departments so HR can see the brand's structure even when zero
  // employees are assigned (helps with the YT Labs cold start).
  const deptEmployees: Record<string, any[]> = {};
  if (companyTab === "YT Labs") {
    DEPARTMENTS_YT_LABS.forEach((d) => { deptEmployees[d] = []; });
  } else if (companyTab === "NB Media") {
    DEPARTMENTS.forEach((d) => { deptEmployees[d] = []; });
  }
  scopedEmployees.forEach((e: any) => {
    const d = e.employeeProfile?.department || "Unassigned";
    if (!deptEmployees[d]) deptEmployees[d] = [];
    deptEmployees[d].push(e);
  });
  const depts = Object.entries(deptEmployees).sort((a, b) => b[1].length - a[1].length);

  // Manager breakdown — anyone with orgLevel manager / hod / hr_manager
  // counts as a manager. We then attach their direct reports (users
  // whose User.managerId points at them) so the panel can show the
  // team alongside the manager. Scoped to the selected company tab
  // so YT Labs view shows only YT Labs managers + their reports.
  const isManagerRole = (u: any) =>
    u?.orgLevel === "manager" || u?.orgLevel === "hod" || u?.orgLevel === "hr_manager";
  const managers = scopedEmployees.filter(isManagerRole);
  const reportsByManagerId: Record<number, any[]> = {};
  scopedEmployees.forEach((e: any) => {
    if (e.managerId) {
      if (!reportsByManagerId[e.managerId]) reportsByManagerId[e.managerId] = [];
      reportsByManagerId[e.managerId].push(e);
    }
  });
  const managersGrouped: Array<{ manager: any; reports: any[] }> = managers
    .map((m: any) => ({ manager: m, reports: reportsByManagerId[m.id] ?? [] }))
    .sort((a: { reports: any[] }, b: { reports: any[] }) => b.reports.length - a.reports.length);

  // Sub-tab inside Departments: "By Department" vs "By Manager".
  const [deptView, setDeptView] = useUrlTab<"dept" | "manager">("deptView", "dept", ["dept", "manager"] as const);

  if (!isAdmin) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <AlertCircle className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="text-[14px] font-semibold text-slate-600 dark:text-slate-300">Admin access required</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* Header — sticky below the global app header (h-[68px]) so it
          stays visible while the right-side content scrolls. */}
      <div className="sticky top-[68px] z-20 bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-[#008CFF]" />
          <div>
            <h1 className="text-[15px] font-bold text-slate-800 dark:text-white">
              HR Dashboard
              {brandLabel ? (
                <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#008CFF]/10 text-[#008CFF]">
                  {brandLabel}
                </span>
              ) : null}
            </h1>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Attendance, holidays, assets, leave types, shifts & org structure</p>
          </div>
        </div>
      </div>

      <div className="flex gap-0 h-full items-start">

        {/* Sidebar tabs — every section is an in-page state tab.
            `sticky top-[145px]` (= global header 68px + HR header ~77px)
            keeps the rail pinned just below the two stacked headers.
            `max-h-[calc(100vh-145px)] overflow-y-auto` lets the rail
            itself scroll internally when its list is taller than the
            remaining viewport (e.g. with Permissions flyout expanded). */}
        <div className="w-[240px] shrink-0 p-4 space-y-1 border-r border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/40 sticky top-[145px] z-10 max-h-[calc(100vh-145px)] overflow-y-auto">
          {visibleTabs.map((t) => {
            const active = tab === t.key;
            const base = `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left ${
              active
                ? "bg-[#008CFF]/10 text-[#008CFF]"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            }`;
            // Approvals + Probation Reviews carry count badges.
            const badge =
              t.key === "approvals" && approvalsTotal > 0 ? approvalsTotal
              : t.key === "reviews" && (probationTotal + pipTotal) > 0 ? (probationTotal + pipTotal)
              : null;
            // Reviews — hover-flyout with Probation / PIP children (same
            // pattern as the Permissions rail item). Each child selects the
            // sub-tab; the parent stays highlighted while on the Reviews tab.
            if (t.key === "reviews") {
              const childBase = (sel: boolean) =>
                `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium transition-colors text-left ${
                  sel ? "bg-[#008CFF]/10 text-[#008CFF]" : "text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                }`;
              return (
                <div key={t.key} {...reviewsHandlers}>
                  <button
                    type="button"
                    onClick={() => { setTab("reviews"); setReviewsRailOpen((v) => !v); }}
                    aria-expanded={reviewsRailOpen}
                    className={`${base} !gap-2`}
                  >
                    <t.icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 whitespace-nowrap">{t.label}</span>
                    {badge !== null && (
                      <span className={`inline-flex shrink-0 items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums leading-none ${
                        active ? "bg-[#008CFF] text-white" : "bg-[#008CFF]/15 text-[#008CFF]"
                      }`}>
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                    <svg className={`w-3.5 h-3.5 shrink-0 opacity-60 transition-transform ${reviewsRailOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  {reviewsRailOpen && (
                    <div className="ml-3 mt-0.5 pl-3 border-l border-slate-200 dark:border-white/[0.06] space-y-0.5">
                      <button type="button" onClick={() => { setTab("reviews"); setReviewsSub("probation"); }} className={childBase(active && reviewsSub === "probation")}>
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                        <span className="flex-1">Probation</span>
                        {probationTotal > 0 && <span className="text-[10px] font-bold tabular-nums">{probationTotal > 99 ? "99+" : probationTotal}</span>}
                      </button>
                      <button type="button" onClick={() => { setTab("reviews"); setReviewsSub("pip"); }} className={childBase(active && reviewsSub === "pip")}>
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400" />
                        <span className="flex-1">PIP</span>
                        {pipTotal > 0 && <span className="text-[10px] font-bold tabular-nums">{pipTotal > 99 ? "99+" : pipTotal}</span>}
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={base}>
                <t.icon className="w-4 h-4" />
                <span className="flex-1">{t.label}</span>
                {badge !== null && (
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums leading-none ${
                    active ? "bg-[#008CFF] text-white" : "bg-[#008CFF]/15 text-[#008CFF]"
                  }`}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* ── Rail links — full-page destinations, not inline tabs.
                Each one is conditionally rendered based on tier. */}
          <div className="pt-2 mt-2 border-t border-slate-200 dark:border-white/[0.06]" />
          {showOnboardRail && (
            <Link
              href={
                // Carry the current brand into onboarding so the form's
                // Number Series / Legal Entity / Business Unit land
                // pre-set to YT Labs (or NB Media). The onboarding
                // page reads ?brand= and seeds its initial form
                // accordingly; HR can still override.
                initialBrand && initialBrand !== "all"
                  ? `/dashboard/hr/onboard?brand=${slugForBrand(initialBrand)}`
                  : "/dashboard/hr/onboard"
              }
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
            >
              <UserPlus className="w-4 h-4" />
              <span className="flex-1">Onboard Employee</span>
              <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          {showTabPermsRail && (
            // Permissions group — hover-flyout. Mouse-enter opens the
            // submenu; mouse-leave (anywhere in the wrapper) starts a
            // 200ms grace timer before closing, so the cursor can move
            // from the trigger into the submenu without it snapping shut.
            // The trigger is still a real <button> so keyboard users and
            // touch devices can toggle by click.
            //
            // Shown in every brand view now that the Permissions pages
            // auto-scope by brand (the rail link carries ?brand=): YT Labs
            // and NB Media each manage their own employees; "All brands"
            // sees everyone.
            <div {...permsHandlers}>
              <button
                type="button"
                onClick={() => setPermsOpen((v) => !v)}
                aria-expanded={permsOpen}
                aria-controls="hr-rail-permissions-children"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
              >
                <ShieldCheck className="w-4 h-4" />
                <span className="flex-1">Permissions</span>
                <svg
                  className={`w-3.5 h-3.5 opacity-60 transition-transform ${permsOpen ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {permsOpen && (
                <div id="hr-rail-permissions-children" className="ml-3 mt-0.5 pl-3 border-l border-slate-200 dark:border-white/[0.06] space-y-0.5">
                  <Link
                    href={`/dashboard/hr/admin/permissions${permBrandQs}`}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
                    <span className="flex-1">Tab Permissions</span>
                  </Link>
                  <Link
                    href={`/dashboard/hr/admin/designations${permBrandQs}`}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
                    <span className="flex-1">Designations</span>
                  </Link>
                  <Link
                    href={`/dashboard/hr/admin/permissions/payroll-attendance${permBrandQs}`}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
                    <span className="flex-1">Payroll &amp; Attendance</span>
                  </Link>
                </div>
              )}
            </div>
          )}
          {(() => {
            // Build a `?brand=…` suffix once so every brand-aware rail
            // link below stays consistent. We propagate the brand only
            // when a specific brand is locked (NB Media / YT Labs) —
            // "all" and the no-param case leave the destination
            // unfiltered, matching the panel-level behaviour.
            const brandQs = initialBrand && initialBrand !== "all"
              ? `?brand=${slugForBrand(initialBrand)}`
              : "";
            return (
              <>
                {showManageKpisRail && (
                  <Link
                    href={`/dashboard/kpis/manage${brandQs}`}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span className="flex-1">Manage KPIs</span>
                    <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )}
                {showMasterSheetRail && (
                  <Link
                    href={`/dashboard/hr/admin/master-sheet${brandQs}`}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span className="flex-1">Master Sheet</span>
                    <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )}
                {showHiringRail && (
                  <Link
                    href={`/dashboard/hr/hiring${brandQs}`}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                  >
                    <Briefcase className="w-4 h-4" />
                    <span className="flex-1">Hiring</span>
                    <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )}
                {showOffboardRail && (
                  <Link
                    href={`/dashboard/hr/offboard${brandQs}`}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                  >
                    <UserMinus className="w-4 h-4" />
                    <span className="flex-1">Offboard Employee</span>
                    <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )}
                {/* Templates rail — reusable letter / email / document
                    templates HR uses across onboarding, offboarding,
                    appraisals, etc. Same visibility as other HR-admin
                    rails. */}
                <Link
                  href={`/dashboard/hr/admin/templates${brandQs}`}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
                >
                  <FileText className="w-4 h-4" />
                  <span className="flex-1">Templates</span>
                  <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </>
            );
          })()}
        </div>

        {/* Content */}
        {/* min-w-0 lets this flex column shrink to the available width instead
            of growing to its content's intrinsic size — without it, wide inner
            tables (e.g. the Approvals leave list) push past the viewport and
            get clipped rather than scrolling inside their own box. */}
        <div className="flex-1 min-w-0 p-6 space-y-4">

          {/* ── Attendance Dashboard ── */}
          {tab === "attendance-dashboard" && <AttendanceDashboardPanel initialBrand={initialBrand} />}

          {/* ── Approvals — full multi-tab panel (Leave / Comp Offs / WFH / …) ── */}
          {tab === "approvals" && <ApprovalsPanel embedded initialBrand={initialBrand} />}

          {/* ── Reviews — Probation + PIP approvals as sub-tabs ── */}
          {tab === "reviews" && (
            <div className="max-w-3xl">
              <div className="mb-3">
                <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{reviewsSub === "pip" ? "PIP Reviews" : "Probation Reviews"}</h2>
                <p className="text-[12px] text-slate-500">Manager recommendations awaiting you. Approve to apply, or send back. Switch between Probation and PIP from the Reviews menu on the left.</p>
              </div>
              {reviewsSub === "probation" ? <ProbationApprovalsCard standalone brand={initialBrand} /> : <PerformancePlanApprovalsCard standalone brand={initialBrand} />}
            </div>
          )}

          {/* ── Regularization Balance — per-user monthly quota usage ── */}
          {tab === "regularize-balance" && <RegularizationBalancePanel initialBrand={initialBrand} />}
          {tab === "wfh-balances"       && <WfhBalancesPanel initialBrand={initialBrand} />}

          {/* ── Leaves — admin can edit / cancel / delete any leave ── */}
          {tab === "leaves" && <LeavesAdminPanel leaveTypes={leaveTypes} initialBrand={initialBrand} />}

          {/* ── Assets ── */}

          {/* ── Payroll — runs, generate, lock, mark paid, structures ── */}
          {tab === "payroll" && canSeeSalary && <RunPayrollPanel embedded />}

          {/* ── Salary Structures — full org salary table (gagan-only) ── */}
          {tab === "salary-structures" && isSalaryDev && <SalaryStructuresList />}

          {/* ── Pulse & Surveys — Keka-parity engagement bank.
              Two sub-tabs:
                • Weekly Pulse   — 4-week × 5-question rotation
                • Monthly Survey — eNPS + Likert engagement drivers
              HR adds / edits / deletes any question. Employee-facing
              answer flow + aggregate dashboards come in a later PR. */}
          {tab === "pulse-surveys" && <PulseSurveysPanel initialBrand={initialBrand} />}

          {/* ── Leave Types ── */}
          {tab === "leave-types" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">Leave Types</h2>
                <button onClick={() => { setEditLeave(null); setLeaveForm({ name:"",description:"",daysPerYear:"12",isPaid:true,carryForward:false,maxCarryForward:"",applicable:true,adminOnly:false }); setShowLeaveForm(true); }}
                  className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold">
                  <Plus className="w-3.5 h-3.5" />Add Leave Type
                </button>
              </div>
              <div className="space-y-2">
                {leaveTypes.map((lt: any) => (
                  <div key={lt.id} className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-10 rounded-full ${lt.isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`} />
                      <div>
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-white">{lt.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {lt.daysPerYear} days/year
                          {lt.isPaid ? " · Paid" : " · Unpaid"}
                          {lt.carryForward ? ` · Carry forward${lt.maxCarryForward ? ` (max ${lt.maxCarryForward})` : ""}` : ""}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => openLeaveEdit(lt)}
                      className="flex items-center gap-1 h-7 px-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 rounded-lg text-[11px] font-medium">
                      <Pencil className="w-3 h-3" />Edit
                    </button>
                  </div>
                ))}
                {leaveTypes.length === 0 && (
                  <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-8 text-center">
                    <p className="text-[13px] text-slate-500 dark:text-slate-400">No leave types configured yet</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Leave Policies ── */}
          {tab === "leave-policies" && <LeavePoliciesPanel />}

          {/* ── Shift Templates ── */}
          {tab === "shifts" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">Shift Templates</h2>
                <button onClick={() => { setEditShift(null); setShiftForm({ name:"",startTime:"09:00",endTime:"18:00",gracePeriodMinutes:"15",halfDayGraceMinutes:"",workingDays:[1,2,3,4,5],saturdayPolicy:"all",saturdayWeeks:[] }); setShowShiftForm(true); }}
                  className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold">
                  <Plus className="w-3.5 h-3.5" />Add Shift
                </button>
              </div>
              <div className="space-y-2">
                {shifts.map((s: any) => (
                  <div key={s.id} className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-10 rounded-full ${s.isActive ? "bg-[#008CFF]" : "bg-slate-300 dark:bg-white/20"}`} />
                      <div>
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-white">{s.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {s.startTime} – {s.endTime}
                          {" · "}Grace: {s.breakMinutes ?? s.gracePeriodMinutes ?? 0}min
                          {(() => {
                            const st = hmToMin(s.startTime), en = hmToMin(s.endTime);
                            if (st === null || en === null || en <= st) return null;
                            return <>{" · "}2nd half: {minToHm(Math.round((st + en) / 2))}</>;
                          })()}
                          {s.halfDayGraceMinutes != null && <>{" · "}½-day grace: {s.halfDayGraceMinutes}min</>}
                          {" · "}{(Array.isArray(s.workDays) ? s.workDays : [])
                            .map((d: unknown) => typeof d === "number" ? DAYS_LABEL[d] : String(d))
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setApplyShift(s); setApplyScope("all"); setApplyUsers([]); }}
                        className="flex items-center gap-1 h-7 px-3 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[11px] font-semibold">
                        Apply
                      </button>
                      <button onClick={() => openShiftEdit(s)}
                        className="flex items-center gap-1 h-7 px-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 rounded-lg text-[11px] font-medium">
                        <Pencil className="w-3 h-3" />Edit
                      </button>
                    </div>
                  </div>
                ))}
                {shifts.length === 0 && (
                  <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-8 text-center">
                    <p className="text-[13px] text-slate-500 dark:text-slate-400">No shift templates configured yet</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Departments ── */}
          {tab === "departments" && (() => {
            // Helpers used by both sub-tabs.
            // Professional, harmonious palette — uniformly mid-saturation
            // tones (≈ Tailwind 600 weights) that look balanced when
            // shown side-by-side. Skips the loud reds / hot pinks so the
            // breakdown reads as polished rather than party-coloured.
            const palette = [
              "#0f6ecd", // brand blue
              "#0d9488", // teal
              "#059669", // emerald
              "#7c3aed", // violet
              "#0284c7", // sky
              "#d97706", // amber
              "#4338ca", // indigo
              "#0891b2", // cyan
            ];
            const personName = (m: any) =>
              m.name || [m.employeeProfile?.firstName, m.employeeProfile?.lastName].filter(Boolean).join(" ") || m.email || "—";
            const personRole = (m: any) =>
              m.employeeProfile?.designation || m.orgLevel || "";
            const Av = ({ m, size = 28 }: { m: any; size?: number }) => {
              const name = personName(m);
              const initials = name.split(" ").map((p: string) => p[0] || "").join("").slice(0, 2).toUpperCase();
              const bg = palette[name.charCodeAt(0) % palette.length];
              const url = m.profilePictureUrl || m.employeeProfile?.profilePictureUrl;
              return (
                <span
                  title={name}
                  aria-label={name}
                  className="inline-block rounded-full ring-2 ring-white dark:ring-[#001529] cursor-default transition-transform hover:scale-110 hover:z-10"
                  style={{ width: size, height: size }}
                >
                  {url ? (
                    <img src={url} alt={name} className="h-full w-full rounded-full object-cover" />
                  ) : (
                    <span
                      className="flex h-full w-full items-center justify-center rounded-full font-bold text-white"
                      style={{ background: bg, fontSize: Math.round(size * 0.36) }}
                    >
                      {initials}
                    </span>
                  )}
                </span>
              );
            };
            const totalEmployees = scopedEmployees.length;
            // Count per company for the tab chips so HR sees brand sizes
            // at a glance.
            const nbCount = employees.filter((e: any) => (e.employeeProfile?.businessUnit || "NB Media") === "NB Media").length;
            const ytCount = employees.filter((e: any) => e.employeeProfile?.businessUnit === "YT Labs").length;

            return (
              <>
                {/* Company tab strip — hidden when initialBrand is set
                    (the HR Dashboard sidebar flyout already chose). */}
                {initialBrand == null && (
                  <div className="flex items-center gap-1.5 mb-2">
                    {([
                      { key: "NB Media", count: nbCount },
                      { key: "YT Labs",  count: ytCount },
                      { key: "all",      count: employees.length },
                    ] as const).map(({ key, count }) => {
                      const active = companyTab === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setCompanyTab(key as CompanyTab)}
                          className={`px-3.5 h-8 rounded-lg text-[12px] font-semibold transition-colors inline-flex items-center gap-2 ${
                            active
                              ? "bg-[#008CFF] text-white shadow-sm"
                              : "bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10"
                          }`}
                        >
                          <span>{key === "all" ? "All" : key}</span>
                          <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold !text-white ${
                            active ? "bg-white/20" : "bg-[#008CFF]"
                          }`} style={{ color: "#fff" }}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Header + sub-tabs */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-[15px] font-bold text-slate-800 dark:text-white">
                      {deptView === "dept" ? "Department Breakdown" : "Manager Breakdown"}
                    </h2>
                    <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                      {deptView === "dept"
                        ? `${depts.length} ${depts.length === 1 ? "department" : "departments"} · ${totalEmployees} employees`
                        : `${managersGrouped.length} ${managersGrouped.length === 1 ? "manager" : "managers"}`}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg bg-slate-100 dark:bg-white/[0.05] p-1 self-start">
                    {[
                      { key: "dept",    label: "By Department" },
                      { key: "manager", label: "By Manager"    },
                    ].map((t) => {
                      const active = deptView === (t.key as typeof deptView);
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setDeptView(t.key as typeof deptView)}
                          className={`px-3 py-1.5 rounded-md text-[12.5px] font-semibold transition-all ${
                            active
                              ? "bg-white dark:bg-[#001529] text-[#008CFF] shadow-sm"
                              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* By Department — card grid */}
                {deptView === "dept" && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {depts.map(([dept, members]) => {
                      const accentBg = palette[dept.charCodeAt(0) % palette.length];
                      return (
                        <div
                          key={dept}
                          className="group relative rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/80 overflow-hidden transition-shadow hover:shadow-[0_4px_18px_rgba(15,23,42,0.06)]"
                        >
                          {/* Soft accent strip — a fade-out gradient looks
                              less aggressive than a flat coloured bar. */}
                          <span
                            aria-hidden
                            className="absolute inset-x-0 top-0 h-[3px]"
                            style={{ background: `linear-gradient(90deg, ${accentBg}, ${accentBg}80 65%, transparent)` }}
                          />
                          <div className="px-4 pt-4 pb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {/* Pastel chip — tinted background + dark
                                  text reads as an enterprise badge, not a
                                  child's sticker. */}
                              <span
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-bold text-[13px] ring-1"
                                style={{
                                  background: `${accentBg}14`,
                                  color: accentBg,
                                  boxShadow: `inset 0 0 0 1px ${accentBg}33`,
                                }}
                              >
                                {dept.slice(0, 2).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-[13.5px] font-bold text-slate-800 dark:text-white">{dept}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {members.length} {members.length === 1 ? "member" : "members"}
                                </p>
                              </div>
                            </div>
                            <span className="text-[20px] font-bold tabular-nums text-slate-300 dark:text-white/15">
                              {members.length}
                            </span>
                          </div>
                          <div className="px-4 pb-4">
                            {members.length === 0 ? (
                              <p className="text-[12px] text-slate-400">No employees</p>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {members.slice(0, 14).map((m: any) => <Av key={m.id} m={m} size={28} />)}
                                {members.length > 14 && (
                                  <span
                                    title={members.slice(14).map(personName).join(", ")}
                                    className="inline-flex h-7 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.06] px-2 text-[10px] font-bold text-slate-600 dark:text-slate-300"
                                  >
                                    +{members.length - 14}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {depts.length === 0 && (
                      <div className="md:col-span-2 xl:col-span-3 rounded-xl border border-dashed border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/80 px-6 py-10 text-center text-[13px] text-slate-500">
                        No employees imported yet.
                      </div>
                    )}
                  </div>
                )}

                {/* By Manager — list of managers with department + reports */}
                {deptView === "manager" && (
                  <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/80 overflow-hidden">
                    {managersGrouped.length === 0 ? (
                      <div className="px-6 py-12 text-center text-[13px] text-slate-500">
                        No employees with the Manager / HoD role.
                      </div>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                        {managersGrouped.map(({ manager: m, reports }) => {
                          const dept = m.employeeProfile?.department || "Unassigned";
                          const accentBg = palette[dept.charCodeAt(0) % palette.length];
                          return (
                            <li key={m.id} className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex items-start gap-3 min-w-0">
                                <Av m={m} size={40} />
                                <div className="min-w-0">
                                  <p className="truncate text-[13.5px] font-semibold text-slate-800 dark:text-white">
                                    {personName(m)}
                                  </p>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                                    {personRole(m) && (
                                      <span className="text-slate-500 dark:text-slate-400">{personRole(m)}</span>
                                    )}
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ring-1"
                                      style={{
                                        background: `${accentBg}14`,
                                        color: accentBg,
                                        boxShadow: `inset 0 0 0 1px ${accentBg}33`,
                                      }}
                                    >
                                      {dept}
                                    </span>
                                    <span className="text-slate-400">
                                      · {reports.length} {reports.length === 1 ? "report" : "reports"}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="shrink-0 flex flex-wrap items-center gap-1.5 sm:justify-end">
                                {reports.length === 0 ? (
                                  <span className="text-[11.5px] text-slate-400">No direct reports</span>
                                ) : (
                                  <>
                                    {reports.slice(0, 8).map((r: any) => <Av key={r.id} m={r} size={24} />)}
                                    {reports.length > 8 && (
                                      <span
                                        title={reports.slice(8).map(personName).join(", ")}
                                        className="inline-flex h-6 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.06] px-2 text-[10px] font-bold text-slate-600 dark:text-slate-300"
                                      >
                                        +{reports.length - 8}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </>
            );
          })()}
          {/* ── Holidays ── */}
          {tab === "holidays" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">Company Holidays</h2>
                <button onClick={() => { setEditingHolidayId(null); setHolidayForm({ name:"", date: new Date().toISOString().slice(0,10), isOptional: false }); setShowHolidayForm(true); }}
                  className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold">
                  <Plus className="w-3.5 h-3.5" />Add Holiday
                </button>
              </div>
              <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-white/[0.04]">
                      {["DATE","HOLIDAY NAME","TYPE",""].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[9px] uppercase tracking-widest text-[#008CFF] font-bold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(holidays as any[]).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((h: any) => {
                      // The DB row carries `type` (public | company | optional);
                      // only "optional" maps to the amber "Optional" badge.
                      const isOptional = h.type === "optional";
                      return (
                      <tr key={h.id} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                        <td className="px-5 py-3 text-[12px] text-slate-600 dark:text-slate-400 font-medium">
                          {new Date(h.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-5 py-3 text-[13px] font-semibold text-slate-800 dark:text-white">{h.name}</td>
                        <td className="px-5 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOptional ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
                            {isOptional ? "Optional" : "Mandatory"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => openHolidayEdit(h)}
                              className="h-7 w-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-700"
                              title="Edit holiday">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteHoliday(h.id)}
                              className="h-7 w-7 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/10 text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20"
                              title="Delete holiday">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {holidays.length === 0 && (
                  <div className="py-12 text-center">
                    <Palmtree className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <p className="text-[13px] text-slate-400">No holidays added yet</p>
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </div>

      {/* Modal: Leave Type */}
      {showLeaveForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[440px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{editLeave ? "Edit" : "Add"} Leave Type</h3>
              <button onClick={() => setShowLeaveForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              {[{ field: "name", label: "Name", placeholder: "e.g. Annual Leave" }, { field: "description", label: "Description", placeholder: "" }].map(({ field, label, placeholder }) => (
                <div key={field}>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</label>
                  <input value={(leaveForm as any)[field]} onChange={e => setLeaveForm(f => ({ ...f, [field]: e.target.value }))}
                    placeholder={placeholder}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
                </div>
              ))}
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Days Per Year</label>
                <input type="number" value={leaveForm.daysPerYear} onChange={e => setLeaveForm(f => ({ ...f, daysPerYear: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={leaveForm.isPaid} onChange={e => setLeaveForm(f => ({ ...f, isPaid: e.target.checked }))} className="w-4 h-4" />
                  Paid Leave
                </label>
                <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={leaveForm.carryForward} onChange={e => setLeaveForm(f => ({ ...f, carryForward: e.target.checked }))} className="w-4 h-4" />
                  Carry Forward
                </label>
              </div>
              {leaveForm.carryForward && (
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Max Carry Forward Days</label>
                  <input type="number" value={leaveForm.maxCarryForward} onChange={e => setLeaveForm(f => ({ ...f, maxCarryForward: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
                </div>
              )}
              {/* Visibility & restricted-admin toggles. "Applicable" controls
                  whether the type shows up in apply-leave dropdowns at all;
                  "Admin only" gates it to CEO / HR Manager / developer for
                  sensitive buckets like Carry Over Leave that HR needs to
                  draw down on behalf without exposing them to staff. */}
              <div className="rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 space-y-2">
                <label className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={leaveForm.applicable}
                    onChange={e => setLeaveForm(f => ({ ...f, applicable: e.target.checked }))}
                    className="w-4 h-4 mt-0.5"
                  />
                  <span>
                    <span className="font-semibold">Applicable</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      Off = balance-only / encashed-at-exit (hidden from apply form).
                    </span>
                  </span>
                </label>
                <label className={`flex items-start gap-2 text-[13px] cursor-pointer ${leaveForm.applicable ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
                  <input
                    type="checkbox"
                    checked={leaveForm.adminOnly}
                    disabled={!leaveForm.applicable}
                    onChange={e => setLeaveForm(f => ({ ...f, adminOnly: e.target.checked }))}
                    className="w-4 h-4 mt-0.5"
                  />
                  <span>
                    <span className="font-semibold">Admin-only</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      Only CEO, HR Manager, and developers can apply. Hidden from everyone else.
                    </span>
                  </span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowLeaveForm(false)}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={saveLeave}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Holiday */}
      {showHolidayForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{editingHolidayId != null ? "Edit Holiday" : "Add Holiday"}</h3>
              <button onClick={closeHolidayForm}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Holiday Name *</label>
                <input value={holidayForm.name} onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Republic Day"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Date *</label>
                <DateField value={holidayForm.date} onChange={(v) => setHolidayForm(f => ({ ...f, date: v }))}
                  className="mt-1 w-full" />
              </div>
              <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={holidayForm.isOptional} onChange={e => setHolidayForm(f => ({ ...f, isOptional: e.target.checked }))} className="w-4 h-4 accent-[#008CFF]" />
                Optional holiday (employees can choose)
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={closeHolidayForm}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={saveHoliday} disabled={!holidayForm.name || !holidayForm.date}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Shift */}
      {showShiftForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[440px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{editShift ? "Edit" : "Add"} Shift</h3>
              <button onClick={() => setShowShiftForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Shift Name</label>
                <input value={shiftForm.name} onChange={e => setShiftForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. General Shift"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[{ field: "startTime", label: "Start Time" }, { field: "endTime", label: "End Time" }].map(({ field, label }) => (
                  <div key={field}>
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</label>
                    <input type="time" value={(shiftForm as any)[field]} onChange={e => setShiftForm(f => ({ ...f, [field]: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Grace Period (minutes)</label>
                  <input type="number" min={0} value={shiftForm.gracePeriodMinutes} onChange={e => setShiftForm(f => ({ ...f, gracePeriodMinutes: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Half-Day Grace (minutes)</label>
                  <input type="number" min={0} value={shiftForm.halfDayGraceMinutes} placeholder="Same as grace"
                    onChange={e => setShiftForm(f => ({ ...f, halfDayGraceMinutes: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white placeholder:text-slate-400" />
                </div>
              </div>

              {/* Live half-day boundary preview — mid-point of start/end, plus
                  the second-half late cutoff derived from the half-day grace
                  (falling back to the main grace when blank). */}
              {(() => {
                const s = hmToMin(shiftForm.startTime), e = hmToMin(shiftForm.endTime);
                if (s === null || e === null || e <= s) return null;
                const mid = Math.round((s + e) / 2);
                const mainGrace = Number.parseInt(shiftForm.gracePeriodMinutes, 10);
                const hdRaw = Number.parseInt(shiftForm.halfDayGraceMinutes, 10);
                const hdGrace = Number.isFinite(hdRaw) ? hdRaw : (Number.isFinite(mainGrace) ? mainGrace : 0);
                return (
                  <div className="rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2 text-[11.5px] text-slate-600 dark:text-slate-300">
                    1st half <span className="font-semibold">{shiftForm.startTime}–{minToHm(mid)}</span>
                    {" · "}2nd half <span className="font-semibold">{minToHm(mid)}–{shiftForm.endTime}</span>
                    {" · "}2nd-half arrivals late after <span className="font-semibold">{minToHm(mid + hdGrace)}</span>
                  </div>
                );
              })()}
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 block">Working Days</label>
                <div className="flex gap-2">
                  {DAYS_LABEL.map((d, i) => (
                    <button key={i} onClick={() => toggleDay(i)}
                      className={`w-9 h-9 rounded-full text-[11px] font-bold transition-colors ${
                        shiftForm.workingDays.includes(i)
                          ? "bg-[#008CFF] text-white"
                          : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400"
                      }`}>{d}</button>
                  ))}
                </div>
              </div>

              {/* Saturday rule — only when Saturday is a working day */}
              {shiftForm.workingDays.includes(6) && (
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 block">Saturday Working</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: "all",       label: "Every Saturday",            policy: "all",       weeks: [] as number[] },
                      { key: "alternate", label: "Alternate (1 on / 1 off)",  policy: "alternate", weeks: [] as number[] },
                      { key: "1_3",       label: "1st & 3rd",                 policy: "weeks",     weeks: [1, 3] },
                      { key: "2_4",       label: "2nd & 4th",                 policy: "weeks",     weeks: [2, 4] },
                    ] as const).map((opt) => {
                      const active =
                        opt.policy === "all"       ? shiftForm.saturdayPolicy === "all"
                        : opt.policy === "alternate" ? shiftForm.saturdayPolicy === "alternate"
                        : shiftForm.saturdayPolicy === "weeks" &&
                          JSON.stringify([...shiftForm.saturdayWeeks].sort()) === JSON.stringify([...opt.weeks].sort());
                      return (
                        <button key={opt.key} type="button"
                          onClick={() => setShiftForm(f => ({ ...f, saturdayPolicy: opt.policy, saturdayWeeks: [...opt.weeks] }))}
                          className={`h-9 rounded-lg text-[12px] font-semibold border transition-colors ${
                            active
                              ? "border-[#008CFF] bg-[#008CFF]/10 text-[#008CFF]"
                              : "border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-[#008CFF]/40"
                          }`}>{opt.label}</button>
                      );
                    })}
                  </div>
                  {shiftForm.saturdayPolicy === "alternate" && (
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      Every other Saturday, counted from the date you apply this shift — the apply-week Saturday works, the next is off, then on, and so on.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowShiftForm(false)}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={saveShift}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Apply shift to employees ── */}
      {applyShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[440px]">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Apply &quot;{applyShift.name}&quot;</h3>
              <button onClick={() => setApplyShift(null)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-3">Assign this shift to:</p>
            <div className="space-y-2">
              {([
                { key: "all",      label: "All active employees" },
                { key: "nb_media", label: "NB Media" },
                { key: "yt_labs",  label: "YT Labs" },
                { key: "specific", label: "Specific employees" },
              ] as const).map((opt) => (
                <button key={opt.key} type="button" onClick={() => setApplyScope(opt.key)}
                  className={`w-full flex items-center gap-2.5 h-10 px-3 rounded-lg border text-[13px] font-medium transition-colors ${
                    applyScope === opt.key
                      ? "border-[#008CFF] bg-[#008CFF]/10 text-[#008CFF]"
                      : "border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-[#008CFF]/40"
                  }`}>
                  <span className={`w-3.5 h-3.5 rounded-full border-2 ${applyScope === opt.key ? "border-[#008CFF] bg-[#008CFF]" : "border-slate-300 dark:border-white/20"}`} />
                  {opt.label}
                </button>
              ))}
            </div>
            {applyScope === "specific" && (
              <div className="mt-3">
                <EmployeePicker selected={applyUsers} onChange={setApplyUsers} placeholder="Search employees…" />
              </div>
            )}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setApplyShift(null)}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={submitApply} disabled={applyBusy || (applyScope === "specific" && applyUsers.length === 0)}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] disabled:opacity-50 text-white rounded-lg text-[13px] font-semibold">
                {applyBusy ? "Applying…" : "Apply Shift"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
