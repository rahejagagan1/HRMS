"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import FilterDropdown from "@/components/hr/FilterDropdown";
import SelectField from "@/components/ui/SelectField";
import MonthField from "@/components/ui/month-field";
import {
  deriveDepartment,
  deriveLocation,
  deriveBusinessUnit,
  deriveCostCenter,
  deriveLegalEntity,
  departmentOptions,
  entityOptions,
  businessUnitOptions,
  legalEntityOptions,
  locationOptions,
} from "@/lib/hr-taxonomy";
import { DEPARTMENTS } from "@/lib/departments";
import { DEPARTMENTS_YT_LABS } from "@/lib/departments-yt-labs";
import { getUserRoleLabel } from "@/lib/user-role-options";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";

type TabKey =
  | "leave"
  | "leave_encashment"
  | "comp_off"
  | "regularize"
  | "wfh"
  | "half_day"
  | "shift_weekly_off";
const TABS: { key: TabKey; label: string }[] = [
  { key: "leave",              label: "Leave"             },
  { key: "leave_encashment",   label: "Leave Encashment"  },
  { key: "comp_off",           label: "Comp Offs"         },
  { key: "regularize",         label: "Regularizations"   },
  { key: "wfh",                label: "WFH / OD"          },
  { key: "half_day",           label: "Half Day"          },
  { key: "shift_weekly_off",   label: "Shift & Weekly off"},
];

// Compact "Applied · L1 · L2" timeline shown under the leave-type cell.
// Uses the data already returned by /api/hr/approvals?tab=leave — appliedAt,
// approver/approvedAt for L1, finalApprover/finalApprovedAt for L2.
function fmtDt(d: any): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    + ", "
    + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// Per-stage approver cell. Shows the outcome of a stage (Approved /
// Rejected / Awaiting / —) and, for the actively-awaiting stage that the
// current user can decide on, inline approve/reject buttons.
//
//   L1: row.approver / row.approvedAt / row.approvalNote
//   L2: row.finalApprover / row.finalApprovedAt / row.finalApprovalNote
//
// Status → cell state mapping:
//   pending             → L1 = Awaiting,  L2 = —
//   partially_approved  → L1 = Approved,  L2 = Awaiting
//   approved            → L1 = Approved,  L2 = Approved
//   rejected (no L2 ts) → L1 = Rejected,  L2 = —
//   rejected (L2 ts)    → L1 = Approved,  L2 = Rejected
//
// Action visibility:
//   L1 buttons → status==="pending" AND user is row's L1 approver
//                (manager / HR-admin / CEO / developer — the API only
//                returns rows the viewer is allowed to action).
//   L2 buttons → status==="partially_approved" AND user is final approver
//                (HR-admin / CEO / developer).
function ApprovalCell({
  stage, row, canAct, onApprove, onReject, actioning,
}: {
  stage: "L1" | "L2";
  row: any;
  canAct: boolean;
  onApprove: () => void;
  onReject: () => void;
  actioning: boolean;
}) {
  const status: string = row.status;
  const l2Ts = row.finalApprovedAt || null;

  let outcome: "approved" | "rejected" | "awaiting" | "na" = "na";
  let actor: { name?: string } | null = null;
  let ts: any = null;
  let note: string | null = null;

  if (stage === "L1") {
    actor = row.approver || null;
    ts    = row.approvedAt || null;
    note  = row.approvalNote || null;
    if (status === "pending")                                     outcome = "awaiting";
    else if (status === "rejected" && !l2Ts)                      outcome = "rejected";
    else                                                          outcome = "approved";
  } else {
    actor = row.finalApprover || null;
    ts    = l2Ts;
    note  = row.finalApprovalNote || row.approvalNote || null;
    if (status === "pending")                                     outcome = "na";
    else if (status === "rejected" && !l2Ts)                      outcome = "na";
    else if (status === "partially_approved")                     outcome = "awaiting";
    else if (status === "approved")                               outcome = "approved";
    else if (status === "rejected" && l2Ts)                       outcome = "rejected";
  }

  if (outcome === "na") {
    return <span className="text-[12px] text-slate-300">—</span>;
  }

  const tone =
    outcome === "approved" ? "text-emerald-600 dark:text-emerald-300"
    : outcome === "rejected" ? "text-rose-600 dark:text-rose-300"
    : "text-amber-600 dark:text-amber-300";
  const dotBg =
    outcome === "approved" ? "bg-emerald-500"
    : outcome === "rejected" ? "bg-rose-500"
    : "bg-amber-500";
  const label =
    outcome === "approved" ? "Approved"
    : outcome === "rejected" ? "Rejected"
    : "Awaiting";

  return (
    <div className="min-w-[132px]">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotBg}`} />
        <span className={`text-[12px] font-semibold ${tone}`}>{label}</span>
      </div>
      {outcome === "awaiting" ? (
        canAct ? (
          <div className="flex items-center gap-1.5 mt-1.5">
            <button
              type="button"
              onClick={onApprove}
              disabled={actioning}
              title={`Approve at ${stage}`}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Check size={13} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={actioning}
              title={`Reject at ${stage}`}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </div>
        ) : null
      ) : (
        <>
          <p className="text-[11.5px] text-slate-700 dark:text-slate-200 mt-0.5 truncate" title={actor?.name || ""}>
            {actor?.name || "—"}
          </p>
          <p className="text-[10.5px] text-slate-400">{fmtDt(ts) || "—"}</p>
          {note && outcome === "rejected" ? (
            <p className="text-[10.5px] text-rose-500/80 mt-0.5 truncate max-w-[180px]" title={note}>
              {note}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  // Two-stage approval flow:
  //   pending             → L1 (manager) hasn't acted yet  → "Pending L1"
  //   partially_approved  → L1 approved, L2 (HR/CEO) hasn't acted → "Pending L2"
  //   approved            → both stages cleared
  //   rejected/cancelled  → terminal
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending:             { bg: "bg-amber-100 dark:bg-amber-500/15",   text: "text-amber-700 dark:text-amber-300",     label: "Pending L1"  },
    partially_approved:  { bg: "bg-[#008CFF]/10 dark:bg-[#008CFF]/15", text: "text-[#008CFF]",                          label: "Pending L2"  },
    approved:            { bg: "bg-emerald-100 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", label: "Approved"    },
    rejected:            { bg: "bg-rose-100 dark:bg-rose-500/15",     text: "text-rose-700 dark:text-rose-300",        label: "Rejected"    },
    cancelled:           { bg: "bg-slate-100 dark:bg-white/[0.05]",   text: "text-slate-500",                          label: "Cancelled"   },
  };
  const m = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.bg} ${m.text}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

// Google's CDN (`lh3.googleusercontent.com`) blocks <img> loads that
// send a Referer header — without `referrerPolicy="no-referrer"` the
// browser shows the broken-image icon (a green silhouette in some
// themes) instead of the photo. The onError swap covers expired /
// deleted URLs by flipping the img out for the initials chip at
// runtime so the user still sees something meaningful.
function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-[#008CFF] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
      {initials}
    </div>
  );
}

/**
 * Shared approvals UI. Renders the 7 top tabs (Leave / Leave Encashment /
 * Comp Offs / Regularizations / WFH OD / Half Day / Shift & Weekly off) and
 * the filter + table for the active one.
 *
 * Used by:
 *   • /dashboard/hr/approvals           (standalone page wrapper, embedded=false)
 *   • /dashboard/hr/admin "Approvals" tab (embedded=true — drops the full-screen wash)
 */
export default function ApprovalsPanel({
  embedded = false,
  initialBrand = null,
}: {
  embedded?: boolean;
  /** Locks the panel to a specific brand on mount (NB Media / YT Labs)
   *  — comes from the `?brand=` URL param on /dashboard/hr/admin. When
   *  null, the panel auto-detects from the viewer's businessUnit (or
   *  "all" for super-admins) as before. */
  initialBrand?: "NB Media" | "YT Labs" | "all" | null;
}) {
  const { data: session } = useSession();
  const me = session?.user as any;
  // L2 finaliser gate — mirrors the server's isHRAdmin: RBAC-first
  // (MANAGE_HR via designation permissions), legacy orgLevel fallback only
  // for sessions without resolved permissions.
  const isFinalApprover = hasResolvedPermissions(me)
    ? can(me, "MANAGE_HR")
    : (me?.orgLevel === "ceo" || me?.isDeveloper || me?.orgLevel === "hr_manager");

  const searchParams = useSearchParams();
  const router       = useRouter();
  const urlTab       = searchParams.get("tab") as TabKey | null;
  const validTab     = (v: string | null): TabKey => TABS.some((t) => t.key === v) ? (v as TabKey) : "leave";
  const [tab, setTab]         = useState<TabKey>(validTab(urlTab));
  useEffect(() => { setTab(validTab(urlTab)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [urlTab]);
  const [search, setSearch]   = useState("");
  const [picked, setPicked]   = useState<Set<number>>(new Set());
  const [actioning, setActioning] = useState(false);

  const [fBU,        setFBU]        = useState<Set<string>>(new Set());
  const [fDept,      setFDept]      = useState<Set<string>>(new Set());
  const [fLoc,       setFLoc]       = useState<Set<string>>(new Set());
  const [fCost,      setFCost]      = useState<Set<string>>(new Set());
  const [fLegal,     setFLegal]     = useState<Set<string>>(new Set());
  const [fStatus,    setFStatus]    = useState<Set<string>>(new Set());

  // Month filter — "YYYY-MM" for a specific IST calendar month, "" for
  // "All time". Drives BOTH the row list AND the per-tab count badges
  // (appliedAt for leave, createdAt for the rest). Defaults to the
  // current month so the page opens scoped to "this month's inbox"
  // instead of the full history.
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const monthQs = monthFilter ? `&month=${encodeURIComponent(monthFilter)}` : "";
  // Brand slug for the API — only NB Media / YT Labs narrow the query
  // server-side; "all" leaves the server's existing org-wide behaviour.
  // Keeps the server count + tab badge in sync with what the table
  // renders (the panel still does client-side filtering for the pill
  // toggle case, but here we want the server to do the heavy lifting).
  // Note: this uses the same value as `initialBrand`, NOT companyTab —
  // companyTab can drift via the in-panel pills when the panel is
  // mounted standalone (no initialBrand). The badges should still
  // reflect the URL-locked brand specifically.
  const brandQs =
    initialBrand === "YT Labs"  ? `&brand=yt-labs` :
    initialBrand === "NB Media" ? `&brand=nb-media` :
    "";

  // ── Company scope tabs ──────────────────────────────────────────────
  // YT Labs HR manager auto-lands on YT Labs; NB Media HR on NB Media;
  // founder / super-admin (CEO / developer) lands on "all" since they
  // straddle both brands. Falls back to "all" while profile loads.
  type CompanyTab = "NB Media" | "YT Labs" | "all";
  const [companyTab, setCompanyTab] = useState<CompanyTab>(initialBrand ?? "all");
  // URL-locked initial brand counts as a manual selection so the
  // viewer-profile auto-detect below doesn't clobber it once /api/hr/
  // profile resolves. The Brand Scope pills can still re-pick.
  const [companyTabTouched, setCompanyTabTouched] = useState<boolean>(initialBrand != null);
  const { data: viewerProfile } = useSWR<any>(
    me ? "/api/hr/profile" : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  // Sync to a changing URL param without remounting (sidebar flyout
  // navigates between brand variants of the same route).
  useEffect(() => {
    if (initialBrand == null) return;
    setCompanyTab(initialBrand);
    setCompanyTabTouched(true);
  }, [initialBrand]);
  useEffect(() => {
    if (companyTabTouched) return;
    const isSuperAdmin = me?.orgLevel === "ceo" || me?.isDeveloper;
    if (isSuperAdmin) {
      setCompanyTab("all");
      return;
    }
    const bu = viewerProfile?.employeeProfile?.businessUnit;
    if (bu === "YT Labs") setCompanyTab("YT Labs");
    else if (bu === "NB Media" || bu == null) setCompanyTab("NB Media");
  }, [viewerProfile, me, companyTabTouched]);

  const { data: summary } = useSWR<{ byTab: Record<string, number>; total: number }>(
    (() => {
      const qs = [
        monthFilter ? `month=${encodeURIComponent(monthFilter)}` : "",
        brandQs ? brandQs.slice(1) : "", // strip the leading "&"
      ].filter(Boolean).join("&");
      return `/api/hr/approvals/summary${qs ? `?${qs}` : ""}`;
    })(),
    fetcher,
    { refreshInterval: 30_000 }
  );
  // Default to "active" — shows pending + partially-approved + approved
  // (incl. upcoming/future-dated approved leaves), but hides rejected /
  // cancelled history. "Pending" narrows to actionable only; "All history"
  // adds the rejected / cancelled audit rows.
  const [scope, setScope] = useState<"pending" | "active" | "all">("active");
  const { data: tabData, isLoading, error } = useSWR(
    `/api/hr/approvals?tab=${tab}&scope=${scope}${monthQs}${brandQs}`,
    fetcher,
  );

  const rows: any[] = tabData?.items || [];

  const { buOpts, deptOpts, locOpts, legalOpts, statusOpts } = useMemo(() => {
    const users = rows.map((r) => r.user).filter(Boolean);
    const statusSet = new Set<string>();
    rows.forEach((r) => {
      if (r.status) statusSet.add(r.status);
    });
    // Business Unit / Legal Entity: always include the canonical
    // NB Media + YT Labs values (via businessUnitOptions / legalEntityOptions)
    // so HR can pick them even when the current approvals list has no
    // employees from a given brand yet.
    // Department: cascades from the Business Unit filter — picking NB
    // Media narrows the dept list to the NB Media canonical set; picking
    // YT Labs narrows to YT_-prefixed departments. With both / neither
    // selected, both lists merge so HR can search across brands.
    const fBuArray = Array.from(fBU);
    const onlyYTLabs = fBuArray.length === 1 && fBuArray[0] === "YT Labs";
    const onlyNBMedia = fBuArray.length === 1 && fBuArray[0] === "NB Media";
    let deptCanonical: string[];
    if (onlyYTLabs)  deptCanonical = DEPARTMENTS_YT_LABS;
    else if (onlyNBMedia) deptCanonical = DEPARTMENTS;
    else             deptCanonical = [...DEPARTMENTS, ...DEPARTMENTS_YT_LABS];
    // Union canonical with whatever the data has, dedup, then sort.
    const discovered = new Set<string>(deptCanonical);
    users.forEach((u) => {
      const v = u?.employeeProfile?.department;
      if (!v) return;
      // When a single brand is selected, only let same-brand custom values
      // through — a "Production" custom value from NB Media shouldn't pop
      // up while YT Labs is selected.
      if (onlyYTLabs && !v.startsWith("YT_") && v !== "HR Operations & TA") return;
      if (onlyNBMedia && v.startsWith("YT_")) return;
      discovered.add(v);
    });
    const deptListed = Array.from(discovered).sort().map((v) => ({ value: v, label: v }));
    return {
      buOpts:    businessUnitOptions(users),
      legalOpts: legalEntityOptions(users),
      deptOpts:  deptListed,
      locOpts:   locationOptions(users),
      statusOpts: Array.from(statusSet).sort().map((v) => ({
        // Match the StatusBadge wording so the filter shows "Pending L1" /
        // "Pending L2" instead of confusing raw enum values.
        // (legacy `partially_approved` → "Pending L2"; `pending` → "Pending L1".)
        // Falls through to title-case for terminal statuses.
        value: v,
        label: v === "partially_approved" ? "Pending L2"
              : v === "pending"            ? "Pending L1"
              : v.charAt(0).toUpperCase() + v.slice(1),
      })),
    };
  }, [rows, fBU]);

  // [collapse-rev-2026-05-19] Marker comment to nudge Turbopack into
  // producing a new chunk hash so the browser stops serving its cached
  // pre-collapse bundle. Pure no-op — does not affect runtime behaviour.
  const filtered = useMemo(() => {
    const matches = (selected: Set<string>, v: string) =>
      selected.size === 0 || (!!v && selected.has(v));
    const base = rows.filter((r: any) => {
      const u = r.user || {};
      const dp = deriveDepartment(u);
      const lc = deriveLocation(u);
      // Resolve actual brand values from the per-field derivers so the
      // filters match the dropdown options the user picks ("NB Media"
      // / "YT Labs" / "NB Media Productions"). The legacy `deriveEntity`
      // returns just "NB" which never matches the new full-brand
      // filter values — that's why "Business Unit: NB Media" looked
      // empty.
      const bu    = deriveBusinessUnit(u)   || "NB Media";
      const cc    = deriveCostCenter(u)     || "";
      const legal = deriveLegalEntity(u)    || "";
      // Company tab scope — applied before the user-controlled filters
      // so the counts on the existing filter dropdowns reflect just the
      // selected brand.
      if (companyTab !== "all") {
        if (bu !== companyTab) return false;
      }
      if (!matches(fBU,    bu))               return false;
      if (!matches(fLegal, legal))            return false;
      if (!matches(fCost,  cc))               return false;
      if (!matches(fDept,  dp))               return false;
      if (!matches(fLoc,   lc))               return false;
      if (!matches(fStatus,    r.status ?? ""))          return false;
      if (search && !(
        (u.name  || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.employeeProfile?.employeeId || "").toLowerCase().includes(search.toLowerCase())
      )) return false;
      return true;
    });
    // Collapse per-day WFH / OD rows that came from the same range
    // submission into one leader row. Group key = userId + reason +
    // createdAt-second + _kind (so a WFH and an OD with identical
    // metadata stay separate). The leader carries `_groupIds` so a
    // single approve/reject cascades to every underlying day.
    if (tab !== "wfh") return base;
    const buckets = new Map<string, any[]>();
    for (const r of base) {
      const key = [
        r.userId,
        (r.reason || "").trim(),
        Math.floor(new Date(r.createdAt).getTime() / 1000),
        r._kind ?? "wfh",
      ].join("|");
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }
    return Array.from(buckets.values()).map((group) => {
      const sorted = [...group].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const leader = sorted[0];
      return {
        ...leader,
        _groupIds:  sorted.map((g) => g.id),
        _groupSize: sorted.length,
        _rangeFrom: new Date(sorted[0].date),
        _rangeTo:   new Date(sorted[sorted.length - 1].date),
      };
    });
  }, [rows, tab, fBU, fDept, fLoc, fCost, fLegal, fStatus, search, companyTab]);

  // Count rows per company for the tab chip badges so HR sees brand
  // workload at a glance. Derived from the same `rows` source so the
  // numbers update live as new requests arrive (SWR refetches).
  const companyCounts = useMemo(() => {
    let nb = 0, yt = 0;
    rows.forEach((r: any) => {
      const bu = r.user?.employeeProfile?.businessUnit || "NB Media";
      if (bu === "YT Labs") yt++;
      else nb++;
    });
    return { nb, yt, all: rows.length };
  }, [rows]);

  const anyFilter = fBU.size || fDept.size || fLoc.size || fCost.size || fLegal.size || fStatus.size;
  const clearFilters = () => {
    setFBU(new Set()); setFDept(new Set()); setFLoc(new Set()); setFCost(new Set());
    setFLegal(new Set()); setFStatus(new Set());
  };

  const toggleRow = (id: number) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = () => {
    const allIds = filtered.map((r) => r.id);
    const allPicked = allIds.every((i) => picked.has(i));
    setPicked(allPicked ? new Set() : new Set(allIds));
  };

  const canActOn = (r: any) => {
    if (r.status === "pending")             return true;
    if (r.status === "partially_approved")  return isFinalApprover;
    return false;
  };

  // Each tab hits its own approve/reject endpoint. Leave uses the
  // per-id /api/hr/leaves/[id] route; the others take { id, action } in the body.
  const actOnIds = async (ids: number[], action: "approve" | "reject", note?: string) => {
    if (ids.length === 0 || actioning) return;
    setActioning(true);

    let doOne: (id: number) => Promise<Response>;
    if (tab === "leave") {
      doOne = (id) => fetch(`/api/hr/leaves/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action, approvalNote: note || null }),
      });
    } else if (tab === "regularize") {
      doOne = (id) => fetch(`/api/hr/attendance/regularize`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id, action, approvalNote: note || null }),
      });
    } else if (tab === "wfh") {
      // "WFH / OD" tab combines both; items carry _kind so we hit the right route.
      doOne = async (id) => {
        const row = rows.find((r: any) => r.id === id);
        const isOd = row?._kind === "on_duty";
        return fetch(isOd ? `/api/hr/attendance/on-duty` : `/api/hr/attendance/wfh`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ id, action, approvalNote: note || null }),
        });
      };
    } else if (tab === "comp_off") {
      doOne = (id) => fetch(`/api/hr/leaves/comp-off`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id, action, approvalNote: note || null }),
      });
    } else {
      // Tabs without an approve endpoint yet (half_day, etc.)
      setActioning(false);
      return;
    }

    await Promise.all(ids.map((id) => doOne(id)));
    mutate((k: any) =>
      typeof k === "string" && (
        k.startsWith("/api/hr/approvals") ||
        k.startsWith("/api/hr/approvals/summary") ||
        k.startsWith("/api/hr/leaves") ||
        k.startsWith("/api/hr/attendance/regularize") ||
        k.startsWith("/api/hr/attendance/wfh") ||
        k.startsWith("/api/hr/attendance/on-duty") ||
        k.startsWith("/api/hr/notifications")
      )
    );
    setPicked(new Set());
    setActioning(false);
  };

  // When the user picks Reject (single-row or bulk) we open a modal that
  // collects the reason. `pending` holds the ids to reject + a friendly
  // label so the modal can preview what's about to happen.
  const [rejectPending, setRejectPending] = useState<{ ids: number[]; label: string } | null>(null);

  const actOne = (id: number, action: "approve" | "reject") => {
    // If `id` is a collapsed range leader, fan out to every underlying
    // day. The `filtered` list carries `_groupIds` on the leader row.
    const row = filtered.find((r: any) => r.id === id);
    const ids = Array.isArray(row?._groupIds) && row._groupIds.length > 0 ? row._groupIds : [id];
    if (action === "reject") {
      const label = ids.length > 1 ? `all ${ids.length} day(s) in this range` : "this request";
      setRejectPending({ ids, label });
      return;
    }
    actOnIds(ids, action);
  };

  // When embedded in the HR Dashboard, drop the full-screen wash + the
  // page-level URL replace so we don't fight with the host page's tab rail.
  const updateUrl = (t: TabKey) => {
    if (embedded) return; // tab state stays local
    router.replace(`/dashboard/hr/approvals?tab=${t}`, { scroll: false });
  };

  // Shared bulk-action toolbar — visible across Leave and the
  // regularize / WFH / OD / comp-off tables whenever at least one row is
  // picked. Approve / Reject expand grouped WFH-range leaders via
  // `_groupIds` so the action covers every underlying day.
  const bulkActionBar = picked.size > 0 ? (
    <div className="flex items-center justify-between mb-3 rounded-lg border border-[#008CFF]/30 bg-[#008CFF]/[0.04] dark:bg-[#008CFF]/[0.08] px-3 py-2">
      <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
        {picked.size} selected
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            const acts = filtered
              .filter((r: any) => picked.has(r.id) && canActOn(r))
              .flatMap((r: any) => (Array.isArray(r._groupIds) && r._groupIds.length > 0 ? r._groupIds : [r.id]));
            actOnIds(acts, "approve");
          }}
          disabled={actioning}
          className="h-9 px-4 rounded-lg text-[12px] font-semibold bg-[#008CFF] text-white hover:bg-[#0070cc] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <Check size={14} strokeWidth={2.5} /> Approve
        </button>
        <button
          onClick={() => {
            const acts = filtered
              .filter((r: any) => picked.has(r.id) && canActOn(r))
              .flatMap((r: any) => (Array.isArray(r._groupIds) && r._groupIds.length > 0 ? r._groupIds : [r.id]));
            if (acts.length === 0) return;
            setRejectPending({
              ids: acts,
              label: acts.length === 1 ? "this request" : `${acts.length} requests`,
            });
          }}
          disabled={actioning}
          className="h-9 px-4 rounded-lg text-[12px] font-semibold border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:border-rose-400 hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 bg-white dark:bg-transparent"
        >
          <X size={14} strokeWidth={2.5} /> Reject
        </button>
        <button
          onClick={() => setPicked(new Set())}
          className="h-9 px-3 rounded-lg text-[11.5px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
        >
          Clear selection
        </button>
      </div>
    </div>
  ) : null;

  // Both brands run the two-stage L1 → L2 flow since 2026-07-21 (YT Labs
  // re-joined the NB flow — see src/lib/hr/single-stage-approval.ts), so the
  // "L2 Approval" column shows everywhere. Kept as a flag so a future
  // single-stage brand can hide it again with a one-line change.
  const hideL2 = false;

  const body = (
    <>
      {/* Approval module tabs */}
      <div className={embedded
        ? "bg-white border-b border-slate-200 dark:border-white/[0.06]"
        : "bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6"}>
        <div className={`flex items-center gap-0 overflow-x-auto ${embedded ? "px-0" : ""}`}>
          {TABS.map((t) => {
            const active = t.key === tab;
            const count = summary?.byTab?.[t.key] ?? 0;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setPicked(new Set()); updateUrl(t.key); }}
                className={`relative px-3 py-2 text-[12px] font-bold tracking-wider whitespace-nowrap transition-colors border-b-2 ${
                  active ? "border-[#008CFF] text-[#008CFF]"
                         : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                }`}
              >
                {t.label.toUpperCase()}
                {count > 0 && (
                  <span className={`ml-2 inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-full text-[10px] font-bold align-top text-white ${
                    active ? "bg-[#008CFF]" : "bg-[#008CFF]"
                  }`}>
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={embedded ? "py-3" : "px-6 py-3"}>
        {/* Always-visible, draggable scrollbars on the request tables so the
            horizontal bar at the bottom of a wide list is easy to grab. */}
        <style>{`
          .appr-scroll{ scrollbar-width: thin; scrollbar-color: #b6c2d1 #eef2f6; }
          .appr-scroll::-webkit-scrollbar{ height: 12px; width: 10px; }
          .appr-scroll::-webkit-scrollbar-track{ background:#eef2f6; }
          .appr-scroll::-webkit-scrollbar-thumb{ background:#b6c2d1; border-radius: 8px; border: 2px solid #eef2f6; }
          .appr-scroll::-webkit-scrollbar-thumb:hover{ background:#93a3b6; }
          .appr-scroll::-webkit-scrollbar-corner{ background:#eef2f6; }
        `}</style>
        {/* ── Page header card ──────────────────────────────────────
            Title + brand scope subtitle, with the inline search grouped
            right beside it on the LEFT (no justify-between) so HR can
            search without reaching to the far-right corner. */}
        <div className="mb-3 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold text-slate-800 dark:text-white">
              {tab === "leave"      ? "Leave approvals"             :
               tab === "regularize" ? "Regularization requests"     :
               tab === "wfh"        ? "WFH / On-Duty requests"      :
               tab === "comp_off"   ? "Comp-off requests"           :
                                      "Requests"}
            </h1>
            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
              {tab === "leave" && (
                <>
                  Scope: <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {companyTab === "all" ? "All brands" : companyTab}
                  </span>
                  <span className="mx-1.5 text-slate-300 dark:text-white/20">·</span>
                  Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{filtered.length}</span> of {rows.length} requests
                </>
              )}
              {tab !== "leave" && (
                <>
                  Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{filtered.length}</span> {filtered.length === 1 ? "request" : "requests"}
                </>
              )}
            </p>
          </div>
          <div className="relative flex-shrink-0 w-full sm:w-[280px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, or employee ID"
              className="w-full h-9 pl-9 pr-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white placeholder-slate-500 focus:outline-none focus:border-[#008CFF]/40 focus:ring-2 focus:ring-[#008CFF]/15 transition-shadow" />
          </div>
        </div>

        {/* Brand scope — pill toggle strip matching LeavesAdminPanel.
            Lets HR jump between NB Media, YT Labs, and All with one
            click, and reads at a glance how many requests live in
            each. Hidden when the panel is mounted from the HR
            Dashboard sidebar flyout (initialBrand set) since the
            brand is already chosen at the navigation step.
            Month picker sits in its own row below — narrows the list
            AND the per-tab badge counts to the chosen IST month. */}
        {(tab === "regularize" || tab === "wfh" || tab === "comp_off") && (
          <div className="mb-3 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 px-4 py-3 space-y-3">
            {initialBrand == null && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 mb-2">Brand scope</div>
                <BrandScopePills
                  value={companyTab}
                  counts={companyCounts}
                  onChange={(v) => { setCompanyTab(v); setCompanyTabTouched(true); }}
                />
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 mb-2">Filter by</div>
              <MonthField label="Month" value={monthFilter} onChange={setMonthFilter} width={170} />
            </div>
          </div>
        )}

        {/* Simple read/act table for regularize / wfh / on_duty / comp_off tabs */}
        {(tab === "regularize" || tab === "wfh" || tab === "comp_off") && bulkActionBar}
        {(tab === "regularize" || tab === "wfh" || tab === "comp_off") && (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-auto max-h-[58vh] appr-scroll">
            {isLoading ? (
              <div className="py-16 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
            ) : error ? (
              <p className="py-16 text-center text-[13px] text-rose-500">Couldn't load approvals</p>
            ) : filtered.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-slate-400">
                {rows.length === 0
                  ? "No pending requests"
                  : `No pending requests in ${companyTab === "all" ? "this view" : companyTab}`}
              </p>
            ) : (
              <table className="w-full min-w-[1050px]">
                <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-[#0a1e3a]/95 backdrop-blur-sm">
                  <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                    <th className="px-3 py-2 text-left">
                      <input type="checkbox"
                        checked={filtered.length > 0 && filtered.every((r) => picked.has(r.id))}
                        onChange={toggleAllVisible}
                        className="w-3.5 h-3.5 rounded border-slate-300 accent-[#008CFF]" />
                    </th>
                    {(tab === "regularize"
                      // Regularization: single-stage HR-only — no L1/L2 split.
                      ? ["EMPLOYEE", "DATE", "REQUESTED IN / OUT", "REASON", "STATUS", "APPROVAL NOTE", "ACTIONS"]
                      // WFH / OD / Comp-off: two-stage L1 → L2.
                      : ["EMPLOYEE", tab === "comp_off" ? "WORKED DATE" : "DATE", "DETAILS", "REASON", "L1 APPROVAL", ...(hideL2 ? [] : ["L2 APPROVAL"]), "REQUEST STATUS"]
                    ).map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any) => {
                    const u = r.user || {};
                    const dateObj = new Date(r.date || r.workedDate);
                    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                    const fmtShort = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
                    // Collapsed WFH/OD leaders carry `_rangeFrom` /
                    // `_rangeTo` + `_groupSize`. Show "From – To · 7 days"
                    // when it's a real range so HR can act on the whole
                    // span in one click. Single-day rows fall through to
                    // the plain date display.
                    const groupSize = Number(r._groupSize ?? 1);
                    const isRange = groupSize > 1 && r._rangeFrom && r._rangeTo;
                    const dateCell: React.ReactNode = isRange
                      ? (
                          <>
                            <span className="font-semibold text-slate-500">From</span> {fmtShort(new Date(r._rangeFrom))}{" "}
                            <span className="font-semibold text-slate-500">→ To</span> {fmt(new Date(r._rangeTo))}
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md bg-[#008CFF]/10 text-[#008CFF] text-[10px] font-bold tracking-wide">
                              {groupSize} DAYS
                            </span>
                          </>
                        )
                      : fmt(dateObj);
                    const fmtTime = (iso: string | null | undefined) => iso
                      ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })
                      : "—";
                    const details = tab === "regularize"
                      ? `${fmtTime(r.requestedIn)} → ${fmtTime(r.requestedOut)}`
                      : tab === "wfh" && r._kind === "on_duty"
                        ? `On Duty${r.location ? ` @ ${r.location}` : ""}`
                      : tab === "wfh"
                        ? "Work From Home"
                      : tab === "comp_off"
                        ? `${r.creditDays ?? 1} day(s)`
                        : "—";
                    const reason = r.reason || r.purpose || "—";
                    const isTwoStage = tab === "wfh" || tab === "comp_off";
                    // ApprovalCell expects approvedAt / finalApprover / finalApprovedAt
                    // shape used by leave rows. WFH / OD / Comp-off don't have those
                    // schema fields, so we synthesise them from the row's
                    // existing data — `updatedAt` is a fine proxy for the stage
                    // timestamp because it changes on every status transition.
                    const stageRow = {
                      ...r,
                      approvedAt:        r.approvedAt        ?? r.updatedAt,
                      finalApprovedAt:   r.finalApprovedAt   ?? (r.status === "approved" || (r.status === "rejected" && r.approvedById) ? r.updatedAt : null),
                      finalApprover:     r.finalApprover     ?? null,
                      finalApprovalNote: r.finalApprovalNote ?? null,
                    };
                    return (
                      <tr key={`${r._kind ?? tab}-${r.id}`} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/60 dark:hover:bg-white/[0.015]">
                        <td className="px-3 py-2">
                          <input type="checkbox"
                            checked={picked.has(r.id)}
                            onChange={() => toggleRow(r.id)}
                            disabled={!canActOn(r)}
                            className="w-3.5 h-3.5 rounded border-slate-300 accent-[#008CFF] disabled:opacity-30" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-3">
                            <Avatar name={u.name || "?"} url={u.profilePictureUrl} size={32} />
                            <div className="min-w-0">
                              <Link href={`/dashboard/hr/people/${u.id}`} className="text-[13px] font-semibold text-slate-800 dark:text-white hover:text-[#008CFF] truncate block">
                                {u.name}
                              </Link>
                              <span className="text-[11px] text-slate-500 truncate block">
                                {u.employeeProfile?.designation || getUserRoleLabel(u.role) || "—"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <p className="text-[12.5px] text-slate-700 dark:text-slate-300">{dateCell}</p>
                          <p className="text-[10.5px] text-slate-400 mt-0.5">
                            <span className="font-semibold text-slate-500">Submitted</span> · {fmtDt(r.createdAt)}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-300 whitespace-nowrap">{details}</td>
                        <td className="px-3 py-2 text-[12.5px] text-slate-600 dark:text-slate-400 max-w-[260px] truncate" title={reason}>{reason}</td>

                        {isTwoStage ? (
                          <>
                            <td className="px-3 py-2 align-top">
                              <ApprovalCell
                                stage="L1"
                                row={stageRow}
                                canAct={r.status === "pending" && canActOn(r)}
                                onApprove={() => actOne(r.id, "approve")}
                                onReject={() => actOne(r.id, "reject")}
                                actioning={actioning}
                              />
                            </td>
                            {!hideL2 && (
                              <td className="px-3 py-2 align-top">
                                <ApprovalCell
                                  stage="L2"
                                  row={stageRow}
                                  canAct={r.status === "partially_approved" && isFinalApprover}
                                  onApprove={() => actOne(r.id, "approve")}
                                  onReject={() => actOne(r.id, "reject")}
                                  actioning={actioning}
                                />
                              </td>
                            )}
                            <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                            <td className="px-3 py-2 text-[12px] text-slate-600 dark:text-slate-400 max-w-[220px] truncate" title={r.approvalNote ?? ""}>
                              {r.approvalNote || <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2">
                              {canActOn(r) ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => actOne(r.id, "approve")}
                                    disabled={actioning}
                                    title="Approve"
                                    className="w-7 h-7 rounded-full flex items-center justify-center bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    <Check size={13} strokeWidth={2.5} />
                                  </button>
                                  <button
                                    onClick={() => actOne(r.id, "reject")}
                                    disabled={actioning}
                                    title="Reject"
                                    className="w-7 h-7 rounded-full flex items-center justify-center bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    <X size={13} strokeWidth={2.5} />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-400">—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tabs that genuinely have no backing data yet */}
        {(tab === "leave_encashment" || tab === "half_day" || tab === "shift_weekly_off") && (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-12 text-center">
            <p className="text-[14px] font-semibold text-slate-700 dark:text-white mb-1">{TABS.find((t) => t.key === tab)?.label}</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Approvals for this module will be enabled here soon.</p>
          </div>
        )}

        {tab === "leave" && (
          <>
            {/* ── Filter card ────────────────────────────────────────
                Single bordered container groups the three logical
                filter layers (Brand scope → Quick status → Detailed
                filters) with tiny section labels so HR can scan from
                top to bottom rather than guessing which row does what. */}
            <div className="mb-3 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/60 px-4 py-3 space-y-3">
              {/* Section: Brand scope — pill toggle strip. One-click
                  jump between NB Media / YT Labs / All with count
                  badges visible at a glance. Hidden when initialBrand
                  is set — the sidebar flyout already locked the brand. */}
              {initialBrand == null && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 mb-2">Brand scope</div>
                  <BrandScopePills
                    value={companyTab}
                    counts={companyCounts}
                    onChange={(v) => { setCompanyTab(v); setCompanyTabTouched(true); }}
                  />
                </div>
              )}

              {/* Section: Detailed filters (dropdowns) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">Filter by</div>
                  {anyFilter ? (
                    <button type="button" onClick={clearFilters}
                      className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-[#008CFF] transition-colors">
                      Clear all filters
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <FilterDropdown label="Department"    options={deptOpts}      selected={fDept}      onChange={setFDept}      width={280} />
                  <FilterDropdown label="Leave Status"  options={statusOpts}    selected={fStatus}    onChange={setFStatus}    width={220} />
                  <MonthField label="Month" value={monthFilter} onChange={setMonthFilter} width={170} />
                </div>
              </div>
            </div>

            {bulkActionBar}

            {/* Table — its own scroll region so vertical scrolling stays
                inside the panel rather than scrolling the whole page.
                Header is sticky so column labels stay visible while
                scrolling rows. */}
            <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-auto max-h-[58vh] appr-scroll">
              {isLoading ? (
                <div className="py-16 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
              ) : error ? (
                <p className="py-16 text-center text-[13px] text-rose-500">Couldn't load approvals</p>
              ) : filtered.length === 0 ? (
                <p className="py-16 text-center text-[13px] text-slate-400">No pending leave approvals</p>
              ) : (
                <table className="w-full min-w-[1150px]">
                  <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-[#0a1e3a]/95 backdrop-blur-sm">
                    <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                      <th className="px-3 py-2 text-left">
                        <input type="checkbox"
                          checked={filtered.length > 0 && filtered.every((r) => picked.has(r.id))}
                          onChange={toggleAllVisible}
                          className="w-3.5 h-3.5 rounded border-slate-300 accent-[#008CFF]" />
                      </th>
                      {["EMPLOYEE","DEPARTMENT","LEAVE DATES","LEAVE TYPE","REASON","POC","L1 APPROVAL", ...(hideL2 ? [] : ["L2 APPROVAL"])].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r: any) => {
                      const u = r.user || {};
                      const profile = u.employeeProfile || {};
                      const from = new Date(r.fromDate);
                      const to   = new Date(r.toDate);
                      const same = from.toDateString() === to.toDateString();
                      const totalDays = parseFloat(String(r.totalDays ?? "1"));
                      const actionable = canActOn(r);

                      return (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/60 dark:hover:bg-white/[0.015]">
                          <td className="px-3 py-2">
                            <input type="checkbox"
                              checked={picked.has(r.id)}
                              onChange={() => toggleRow(r.id)}
                              disabled={!actionable}
                              className="w-3.5 h-3.5 rounded border-slate-300 accent-[#008CFF] disabled:opacity-30" />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-3">
                              <Avatar name={u.name || "?"} url={u.profilePictureUrl} size={36} />
                              <div className="min-w-0">
                                <Link href={`/dashboard/hr/people/${u.id}`} className="text-[13px] font-semibold text-slate-800 dark:text-white hover:text-[#008CFF] truncate block">
                                  {u.name}
                                </Link>
                                <span className="text-[11px] text-slate-500 truncate block">
                                  {profile.designation || getUserRoleLabel(u.role) || "—"}
                                  {profile.employeeId ? <span className="text-slate-400 font-mono"> · {profile.employeeId}</span> : null}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{profile.department || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <p className="text-[12.5px] text-slate-800 dark:text-white font-medium">
                              {same
                                ? from.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                                : `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {totalDays} day{totalDays === 1 ? "" : "s"}
                            </p>
                            <p className="text-[10.5px] text-slate-400 mt-0.5" title={`Applied · ${fmtDt(r.appliedAt)}`}>
                              Applied · {new Date(r.appliedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                          </td>
                          {/* Leave type — applied date moved to the hover
                              title so the cell stays narrow (it was forcing
                              the table wide and pushing L2 off-screen). */}
                          <td className="px-3 py-2 whitespace-nowrap text-[12.5px] text-slate-800 dark:text-white"
                              title={`Applied · ${fmtDt(r.appliedAt)}`}>
                            {r.leaveType?.name || "Leave"}
                          </td>
                          {/* Reason — truncated; full text on hover. */}
                          <td className="px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-300 max-w-[190px] truncate"
                              title={r.reason || ""}>
                            {r.reason ? r.reason : <span className="text-slate-400">—</span>}
                          </td>
                          {/* POC — the cover person the applicant named for
                              their absence. workStatus (handoff notes) shows
                              on hover. "—" when none was assigned. */}
                          <td className="px-3 py-2 max-w-[140px]" title={r.poc?.name ? `${r.poc.name}${r.workStatus ? ` · ${r.workStatus}` : ""}` : (r.workStatus || "")}>
                            {r.poc?.name ? (
                              <span className="inline-flex items-center gap-1.5 max-w-full">
                                <Avatar name={r.poc.name} url={r.poc.profilePictureUrl} size={20} />
                                <span className="min-w-0 truncate text-[12.5px] text-slate-700 dark:text-slate-300">{r.poc.name}</span>
                              </span>
                            ) : <span className="text-[12.5px] text-slate-400">—</span>}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <ApprovalCell
                              stage="L1"
                              row={r}
                              canAct={r.status === "pending" && actionable}
                              onApprove={() => actOne(r.id, "approve")}
                              onReject={() => actOne(r.id, "reject")}
                              actioning={actioning}
                            />
                          </td>
                          {!hideL2 && (
                            <td className="px-3 py-2 align-top">
                              <ApprovalCell
                                stage="L2"
                                row={r}
                                canAct={r.status === "partially_approved" && isFinalApprover}
                                onApprove={() => actOne(r.id, "approve")}
                                onReject={() => actOne(r.id, "reject")}
                                actioning={actioning}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Rejection-reason modal — replaces the browser prompt() so the
          experience matches the rest of the dashboard. */}
      {rejectPending && (
        <RejectReasonModal
          label={rejectPending.label}
          onCancel={() => setRejectPending(null)}
          onConfirm={(note) => {
            const ids = rejectPending.ids;
            setRejectPending(null);
            actOnIds(ids, "reject", note);
          }}
        />
      )}
    </>
  );

  return embedded ? body : (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">{body}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RejectReasonModal — collects a reason before firing the reject action.
// Submit is disabled until the reason has at least 3 non-whitespace chars,
// keeps Esc / outside-click behaviour predictable, and auto-focuses the
// textarea on open so HR can start typing immediately.
// ─────────────────────────────────────────────────────────────────────────────
function RejectReasonModal({
  label, onCancel, onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textareaRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && note.trim().length >= 3) {
        onConfirm(note.trim());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, onCancel, onConfirm]);

  const tooShort = note.trim().length < 3;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <div className="mt-0.5 h-9 w-9 rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
            <X size={18} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white">
              Reject {label}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
              Share a short reason so the requester knows what to fix. They'll see this
              note in their notification email.
            </p>
          </div>
        </div>

        <div className="px-6 py-5">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Reason for rejection
          </label>
          <textarea
            ref={textareaRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Coverage already arranged for this date — please pick another."
            rows={4}
            className="w-full resize-none rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1526] px-3 py-2.5 text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:focus:ring-rose-500/10"
            maxLength={500}
          />
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>{tooShort ? "At least 3 characters." : "Looks good."}</span>
            <span>{note.length}/500</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(note.trim())}
            disabled={tooShort}
            className="h-9 px-4 rounded-lg text-[13px] font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <X size={14} strokeWidth={2.5} /> Confirm Rejection
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Brand scope pill toggle ───────────────────────────────────────
// Three-button strip (NB Media / YT Labs / All) with live count
// badges. Used in two places in this panel — the standalone scope
// strip above the regularize/wfh/comp_off tables, and inside the
// Leave-approvals filter drawer. Same visual treatment as the
// equivalent control on the Leaves admin matrix.
type CompanyScope = "NB Media" | "YT Labs" | "all";
function BrandScopePills({
  value, counts, onChange,
}: {
  value: CompanyScope;
  counts: { nb: number; yt: number; all: number };
  onChange: (v: CompanyScope) => void;
}) {
  const items: Array<{ key: CompanyScope; label: string; count: number }> = [
    { key: "NB Media", label: "NB Media", count: counts.nb  },
    { key: "YT Labs",  label: "YT Labs",  count: counts.yt  },
    { key: "all",      label: "All",      count: counts.all },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {items.map(({ key, label, count }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`px-3.5 h-8 rounded-lg text-[12px] font-semibold transition-colors inline-flex items-center gap-2 ${
              active
                ? "bg-[#008CFF] text-white shadow-sm"
                : "bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10"
            }`}
          >
            <span>{label}</span>
            <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold !text-white ${
              active ? "bg-white/20" : "bg-[#008CFF]"
            }`} style={{ color: "#fff" }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
