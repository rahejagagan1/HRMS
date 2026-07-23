"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { canViewSalary, isSalaryDeveloper, canViewAllBrands } from "@/lib/access";
import { useSearchParams } from "next/navigation";
import { brandFromSlug } from "@/lib/hr-brand-scope";
import { readBrandStatus } from "@/lib/hr/payroll-run-status";
import { DateField } from "@/components/ui/date-field";
import {
  ChevronLeft, ChevronRight, Calendar,
  CheckCircle2, PlayCircle, UserPlus, Wallet, ShieldCheck, Lock,
  Calendar as CalendarIcon, Briefcase, SlidersHorizontal, Hourglass, UserCheck,
  X,
} from "lucide-react";

// ─── Keka-style "Run Payroll" surface for HR admins ──────────────────────────
// 12-month strip, the selected month's headline stats, and the 6-step
// run-payroll workflow. The 6 steps wrap the existing payroll engine
// (/api/hr/payroll/runs + /generate + /[id]/transition + /bonus); the
// page is the orchestration layer, not the business logic.
//
// Real APIs used:
//   /api/hr/payroll/runs                    (list + create)
//   /api/hr/payroll/runs/[id]/totals        (aggregate stats — new)
//   /api/hr/payroll/runs/[id]/activity      (audit feed — new)
//   /api/hr/payroll/runs/[id]/transition    (lock / pay / re-open)
//   /api/hr/payroll/generate                (compute payslips)
//   /api/hr/payroll/bonus                   (one-off bonuses for the cycle)
//   /api/hr/employees                       (total employee count)

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG  = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function fmtInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "INR 0.00";
  // Show the actual value (with paise) — never round payroll amounts on screen.
  return `INR ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timeAgo(iso: string): string {
  const t  = new Date(iso).getTime();
  const dt = Math.max(0, Date.now() - t);
  const m  = Math.floor(dt / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

type PayrollRun = {
  id: number;
  month: number;   // 0-indexed (Jan=0)
  year: number;
  // Legacy whole-run status (fallback). The real per-brand status lives in
  // `brandStatus` — read it via readBrandStatus(run, brand).
  status: "draft" | "generated" | "processing" | "locked" | "paid";
  brandStatus?: Record<string, any> | null;
  _count?: { payslips: number };
};

type MonthCell = {
  key: string;
  year: number;
  month0: number;
  isCurrent: boolean;
  run: PayrollRun | null;
  status: "completed" | "current" | "upcoming";
};

function buildStrip(today: Date, runs: PayrollRun[], brand: string): MonthCell[] {
  const cells: MonthCell[] = [];
  const curY = today.getFullYear();
  const curM = today.getMonth();
  const FUTURE = 10;
  // Extend the strip back to the EARLIEST payroll run so past cycles stay
  // reachable no matter the current month — payroll began May 2026 here, so
  // opening it in (say) Dec 2026 must still let HR scroll back to May 2026.
  // At least 1 past month is always shown even before any run exists.
  const curIdx = curY * 12 + curM;
  let earliestIdx = curIdx - 1;
  for (const r of runs) {
    const idx = r.year * 12 + r.month;
    if (idx < earliestIdx) earliestIdx = idx;
  }
  const PAST = Math.max(1, curIdx - earliestIdx);
  for (let offset = -PAST; offset <= FUTURE; offset++) {
    const d = new Date(curY, curM + offset, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const run = runs.find((r) => r.year === y && r.month === m) ?? null;
    const isCurrent = offset === 0;
    // Completion is per-brand — a shared run may be locked for NB Media but
    // still open for YT Labs, so read the selected brand's slice.
    const runStatus = run ? readBrandStatus(run, brand).status : null;
    const status: MonthCell["status"] =
      runStatus === "paid" || runStatus === "locked" ? "completed" :
      isCurrent                                       ? "current"   :
                                                        "upcoming";
    cells.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, year: y, month0: m, isCurrent, run, status });
  }
  return cells;
}

const MODULE_TABS = [
  { key: "home",         label: "HOME",        href: "/dashboard/hr/home"       },
  { key: "attendance",   label: "ATTENDANCE",  href: "/dashboard/hr/attendance" },
  { key: "leave",        label: "LEAVE",       href: "/dashboard/hr/leaves"     },
  { key: "performance",  label: "PERFORMANCE", href: "/dashboard/hr/goals"      },
  { key: "payroll",      label: "MY FINANCES", href: "/dashboard/hr/payroll"    },
];

const PAYROLL_TABS = [
  { key: "analytics", label: "PAYROLL ANALYTICS", href: "#" },
  { key: "run",       label: "RUN PAYROLL",       href: "/dashboard/hr/payroll/run" },
  { key: "admin",     label: "PAYROLL ADMIN",     href: "/dashboard/hr/admin?tab=payroll" },
  { key: "approvals", label: "APPROVALS",         href: "/dashboard/hr/approvals" },
  { key: "loans",     label: "LOANS",             href: "#" },
  { key: "benefits",  label: "BENEFITS",          href: "#" },
  { key: "reports",   label: "REPORTS",           href: "#" },
  { key: "settings",  label: "SETTINGS",          href: "#" },
];

// Exported as a named component so the HR Admin page can embed this UI
// in its tab=payroll slot (without showing the standalone-page tabs).
// `embedded=true` skips the module + payroll tab strips and the outer
// page chrome so the panel slots cleanly into the admin layout.
export function RunPayrollPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: session } = useSession();
  const user = (session?.user ?? null) as any;

  const today = useMemo(() => new Date(), []);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // For step-action feedback
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Entity switcher — controls which company label is shown above the
  // month strip. Payroll data filtering by entity is a follow-up; for
  // now this is a label state so HR sees they're contextually viewing
  // one brand vs the other.
  // Seed the brand from the dashboard's ?brand= (set by the HR Dashboard
  // flyout) so opening payroll from the YT Labs dashboard lands on YT Labs.
  const searchParams = useSearchParams();
  const [payrollEntity, setPayrollEntity] = useState<"NB Media" | "YT Labs">(
    brandFromSlug(searchParams?.get("brand") ?? null) === "YT Labs" ? "YT Labs" : "NB Media",
  );
  const [entityOpen, setEntityOpen] = useState(false);

  // Org-wide brand isolation (2026-07-15): only all-brands viewers
  // (developers / VIEW_ALL_BRANDS designation holders) may switch the
  // payroll entity. Everyone else — including a brand's HR Manager —
  // is locked to their own brand, whatever ?brand= says. The payroll
  // APIs clamp server-side too (resolveBrandScope); this keeps the UI
  // honest about it.
  const seesAllBrands = canViewAllBrands(user);
  useEffect(() => {
    if (user && !seesAllBrands) {
      const own = (user as any)?.businessUnit === "YT Labs" ? "YT Labs" : "NB Media";
      setPayrollEntity((cur) => (cur === own ? cur : own));
    }
  }, [user, seesAllBrands]);

  const isAdmin = !!user && canViewSalary(user);
  // Unlocking a locked payroll is restricted to the salary-trusted developer
  // (gagan). HR / CEO can lock and mark paid, but only gagan can reopen a
  // locked run — the server enforces the same rule on the transition route.
  const canUnlock = !!user && isSalaryDeveloper(user);

  const { data: runsRaw } = useSWR<PayrollRun[]>(isAdmin ? "/api/hr/payroll/runs" : null, fetcher);
  const runs = Array.isArray(runsRaw) ? runsRaw : [];

  const { data: empData } = useSWR<any>(isAdmin ? `/api/hr/employees?count=1&brand=${encodeURIComponent(payrollEntity)}` : null, fetcher);
  const totalEmployees = (Array.isArray(empData) ? empData.length : empData?.total) ?? 0;

  const cells = useMemo(() => buildStrip(today, runs, payrollEntity), [today, runs, payrollEntity]);
  const selected = cells.find((c) => c.key === selectedKey)
                ?? cells.find((c) => c.isCurrent)
                ?? cells[0];

  // Effective status of the selected run FOR THE SELECTED BRAND. All the
  // gating below (steps, action buttons, badge, exports) reads this instead
  // of the shared run.status, so NB Media and YT Labs lock independently.
  const selectedRunStatus = selected?.run ? readBrandStatus(selected.run, payrollEntity).status : null;

  // Phase 2 — totals (real aggregates from the payslip rows).
  const totalsUrl = selected?.run ? `/api/hr/payroll/runs/${selected.run.id}/totals?brand=${encodeURIComponent(payrollEntity)}` : null;
  const { data: totals } = useSWR<any>(isAdmin && totalsUrl ? totalsUrl : null, fetcher);

  // Phase 4 — activity feed for the right rail.
  const activityUrl = selected?.run ? `/api/hr/payroll/runs/${selected.run.id}/activity` : null;
  const { data: activity } = useSWR<any>(isAdmin && activityUrl ? activityUrl : null, fetcher);

  // Previous-month totals — used to render the "APR INR -25,14,177 ↓"
  // delta lines under each money stat. We grab the PayrollRun for the
  // calendar month before the selected one and hit its /totals endpoint.
  // When the month before doesn't have a run yet (or this is the first
  // payroll cycle ever), the trend lines just don't render — no error.
  const prevRun = useMemo(() => {
    if (!selected) return null;
    const m = selected.month0 === 0 ? 11           : selected.month0 - 1;
    const y = selected.month0 === 0 ? selected.year - 1 : selected.year;
    return runs.find((r) => r.year === y && r.month === m) ?? null;
  }, [selected, runs]);
  const prevTotalsUrl = prevRun ? `/api/hr/payroll/runs/${prevRun.id}/totals?brand=${encodeURIComponent(payrollEntity)}` : null;
  const { data: prevTotals } = useSWR<any>(isAdmin && prevTotalsUrl ? prevTotalsUrl : null, fetcher);
  const prevMonthLabel = prevRun ? MONTHS_LONG[prevRun.month] : null;

  if (user && !isAdmin) {
    return (
      <div className="min-h-screen bg-[#f4f7f8] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-slate-200 p-10 max-w-md text-center">
          <h2 className="text-[15px] font-semibold text-slate-800 mb-2">Access restricted</h2>
          <p className="text-[12.5px] text-slate-500">Run Payroll is only available to HR admins.</p>
        </div>
      </div>
    );
  }

  const monthLabelShort = selected ? `${MONTHS_LONG[selected.month0]}-${selected.year}` : "";
  const monthDayCount   = selected ? daysInMonth(selected.year, selected.month0 + 1) : 0;
  const monthRangeText  = selected ? `(${MONTHS_LONG[selected.month0]} 1 - ${MONTHS_LONG[selected.month0]} ${monthDayCount}, ${monthDayCount} days)` : "";

  // statusForSteps still gates the Process / Lock / Mark-Paid buttons in
  // the bottom action row — those buttons mutate the brand's status slice,
  // not stepStates. Reads the selected brand's status (per-brand lock).
  const statusForSteps = selectedRunStatus;

  // Step completion now reads from PayrollRun.stepStates (per-step
  // "complete"/"pending" set by Mark-as-Complete buttons). Engine-status
  // is no longer the source of truth — the 6 outer cards are prep steps,
  // and the lock/pay actions live below the grid.
  // Step completion is per-brand — a shared PayrollRun holds both brands'
  // slices, so scope the read/write to the selected brand.
  const stepStateUrl = selected?.run?.id ? `/api/hr/payroll/runs/${selected.run.id}/step-state?brand=${encodeURIComponent(payrollEntity)}` : null;
  const { data: stepStateData } = useSWR<{ states: Record<string, string> }>(stepStateUrl, fetcher);
  const stepStates: Record<string, string> = stepStateData?.states ?? {};
  // Step 7 (Review & Finalise) is the only step not stored in stepStates —
  // it auto-completes when HR clicks Lock (run.status moves to "locked"
  // or "paid"). Locking IS the act of confirming the review, so we don't
  // need a separate "Mark Reviewed" toggle.
  const stepDone = (n: number) => {
    if (n === 7) {
      return selectedRunStatus === "locked" || selectedRunStatus === "paid";
    }
    return stepStates[String(n)] === "complete";
  };
  const stepsCompleted = [1, 2, 3, 4, 5, 6, 7].filter(stepDone).length;

  // Wraps the PATCH for "Mark as Complete" inside any Step panel.
  // Creates a PayrollRun on the fly if none exists yet — without it,
  // there's no row to attach stepStates JSON to.
  async function markStepComplete(step: number) {
    try {
      const run = await ensureRun();
      if (!run) return;
      const res = await fetch(`/api/hr/payroll/runs/${run.id}/step-state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, state: "complete", brand: payrollEntity }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setBanner({ kind: "err", text: j?.error || "Could not mark step complete" });
        return;
      }
      await mutate(`/api/hr/payroll/runs/${run.id}/step-state?brand=${encodeURIComponent(payrollEntity)}`);
      await mutate("/api/hr/payroll/runs");
      setBanner({ kind: "ok", text: `Step ${step} marked as complete.` });
    } catch (e: any) {
      setBanner({ kind: "err", text: e?.message || "Could not mark step complete" });
    }
  }

  // ─── Step action handlers ──────────────────────────────────────────────
  // All payroll-mutating actions go through the existing engine endpoints;
  // we're only acting as the orchestrator UI here.

  // Ensure a PayrollRun row exists for the selected month before any
  // generate / transition call can run (they require an id).
  async function ensureRun(): Promise<PayrollRun | null> {
    if (!selected) return null;
    if (selected.run) return selected.run;
    const res = await fetch("/api/hr/payroll/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: selected.month0, year: selected.year }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || "Could not create run");
    }
    const run = await res.json();
    await mutate("/api/hr/payroll/runs");
    return run;
  }

  async function doRunSalary() {
    if (!selected) return;
    setBusyStep("run-salary"); setBanner(null);
    try {
      const run = await ensureRun();
      if (!run) throw new Error("No run");
      const res = await fetch("/api/hr/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // brand scopes the run to one business unit's employees only.
        body: JSON.stringify({ runId: run.id, brand: payrollEntity }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Generate failed");
      const data = await res.json();
      setBanner({ kind: "ok", text: `Payslips generated for ${data.count ?? "all"} ${payrollEntity} employees.` });
      await mutate("/api/hr/payroll/runs");
      if (run.id) await mutate(`/api/hr/payroll/runs/${run.id}/totals?brand=${encodeURIComponent(payrollEntity)}`);
    } catch (e: any) {
      setBanner({ kind: "err", text: e?.message || "Generate failed" });
    } finally {
      setBusyStep(null);
    }
  }

  // Generic transition (lock / pay / reopen). The /[id]/transition route
  // gates which transitions are valid — we just pass the desired action.
  async function doTransition(action: "lock" | "mark_paid" | "reopen") {
    if (!selected?.run) {
      setBanner({ kind: "err", text: "Generate payslips first before locking." });
      return;
    }
    setBusyStep(action === "reopen" ? "pre-check" : "finalize");
    setBanner(null);
    try {
      const res = await fetch(`/api/hr/payroll/runs/${selected.run.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // brand scopes lock / mark_paid / reopen to this brand's slice only.
        body: JSON.stringify({ action, brand: payrollEntity }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Transition failed");
      setBanner({ kind: "ok", text: `Run ${action === "reopen" ? "reopened" : action + "ed"}.` });
      await mutate("/api/hr/payroll/runs");
      await mutate(`/api/hr/payroll/runs/${selected.run.id}/totals`);
      await mutate(`/api/hr/payroll/runs/${selected.run.id}/activity`);
    } catch (e: any) {
      setBanner({ kind: "err", text: e?.message || "Transition failed" });
    } finally {
      setBusyStep(null);
    }
  }

  // Pre-Payroll Check modal state — opens a side panel showing every
  // generated payslip with its key numbers so HR can review before lock.
  const [preCheckOpen, setPreCheckOpen] = useState(false);
  // Step 1 (Leave, Attendance & Payable Units) panel.
  const [step1Open, setStep1Open] = useState(false);
  // Step 2 (New Joinees & Exits) panel.
  const [step2Open, setStep2Open] = useState(false);
  // Step 3 (Bonus, Salary Revisions & Overtime) panel.
  const [step3Open, setStep3Open] = useState(false);
  // Step 4 (Reimbursement, Adhoc Payment, Deduction) panel.
  const [step4Open, setStep4Open] = useState(false);
  // Step 5 (Salaries on Hold & Arrears) panel.
  const [step5Open, setStep5Open] = useState(false);
  // Step 6 (Override PT, ESI, TDS, LWF) panel.
  const [step6Open, setStep6Open] = useState(false);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className={embedded ? "" : "min-h-screen bg-[#f4f7f8]"}>
      {/* The module / payroll-area top tabs are STANDALONE-only — when
          the panel is embedded inside the HR Admin layout, the admin's
          inner sidebar provides the navigation context and these
          additional strips would just stack two tab rows on top of
          each other. */}
      {!embedded && (
        <>
          <div className="flex items-center bg-white border-b border-slate-200 px-4 overflow-x-auto">
            {MODULE_TABS.map((t) => (
              <Link key={t.key} href={t.href}
                className={`px-4 py-3 text-[11px] font-bold tracking-widest border-b-2 transition-colors whitespace-nowrap ${
                  t.key === "payroll" ? "border-[#6f42c1] text-[#6f42c1]" : "border-transparent text-slate-400 hover:text-slate-600"
                }`}>{t.label}</Link>
            ))}
          </div>
          <div className="flex items-center bg-white border-b border-slate-100 px-4 overflow-x-auto">
            {PAYROLL_TABS.map((t) => (
              <Link key={t.key} href={t.href}
                className={`relative px-4 py-3 text-[11px] font-bold tracking-widest transition-colors whitespace-nowrap ${
                  t.key === "run" ? "text-[#0f4e93]" : "text-slate-400 hover:text-slate-600"
                }`}>
                {t.label}
                {t.key === "run" && (
                  <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#0f4e93]" />
                )}
              </Link>
            ))}
          </div>
        </>
      )}

      <div className={embedded ? "space-y-5" : "mx-auto max-w-7xl space-y-5 p-6"}>
        <div className="relative flex items-center gap-2">
          <h1 className="text-[20px] font-bold text-slate-800">{payrollEntity}</h1>
          {/* Entity switcher — all-brands viewers only (org-wide brand
              isolation, 2026-07-15). Scoped HR sees just their brand name. */}
          {seesAllBrands && (
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600"
              aria-label="Switch entity"
              onClick={() => setEntityOpen(o => !o)}
            >▾</button>
          )}
          {entityOpen && seesAllBrands && (
            <div className="absolute top-full left-0 mt-1 z-20 min-w-[200px] rounded-lg border border-slate-200 bg-white shadow-lg py-1">
              {(["NB Media", "YT Labs"] as const).map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => { setPayrollEntity(opt); setEntityOpen(false); }}
                  className={`block w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 ${
                    payrollEntity === opt ? "font-semibold text-slate-900" : "text-slate-700"
                  }`}
                >{opt}</button>
              ))}
            </div>
          )}
        </div>

        <MonthStrip cells={cells} selectedKey={selected?.key ?? null} onSelect={setSelectedKey} />

        <div className="flex items-baseline gap-3">
          <h2 className="text-[18px] font-bold text-slate-800">{monthLabelShort}</h2>
          <span className="text-[12.5px] text-slate-500">{monthRangeText}</span>
          {selected?.run && (
            <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
              {selectedRunStatus}
            </span>
          )}
        </div>

        <StatsRow
          totalEmployees={totalEmployees}
          calendarDays={monthDayCount}
          processedCount={totals?.payslipCount ?? 0}
          totalPayrollCost={totals?.totalPayrollCost ?? 0}
          employeeDeposit={totals?.employeeDeposit ?? 0}
          totalDeductions={totals?.totalDeductions ?? 0}
          totalContributions={totals?.totalContributions ?? 0}
          prevMonthLabel={prevMonthLabel}
          prevTotalPayrollCost={prevTotals?.totalPayrollCost ?? null}
          prevEmployeeDeposit={prevTotals?.employeeDeposit ?? null}
          prevTotalDeductions={prevTotals?.totalDeductions ?? null}
          prevTotalContributions={prevTotals?.totalContributions ?? null}
        />

        {banner && (
          <div className={`rounded-lg border px-3 py-2 text-[12.5px] flex items-center gap-2 ${
            banner.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                 : "bg-rose-50 border-rose-200 text-rose-700"
          }`}>
            <span>{banner.text}</span>
            <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setBanner(null)}><X size={12} /></button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)] p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[14px] font-semibold text-slate-800">Run Payroll</h3>
              <span className="text-[11.5px] text-slate-500">{stepsCompleted} of 7 steps completed</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-[#3b82f6] rounded-full transition-[width] duration-300" style={{ width: `${(stepsCompleted / 7) * 100}%` }} />
            </div>

            <div className="mb-4 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2 text-[12px] text-slate-700">
              Ready to run payroll? Click <a className="font-semibold text-[#0f4e93] hover:underline" href="#">here</a> for a step-by-step guide.{" "}
              <a className="font-semibold text-[#0f4e93] hover:underline" href="#">Labour Codes 2025</a> are now in effect — please review your settings.
            </div>

            {/* Six data-prep steps. Each card opens its own sub-flow when
                clicked (Step 1/2 are scaffolds for now); engine actions
                ((Process Payroll / Review / Lock) moved to the action row
                below so the cards remain pure data-prep, matching Keka. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <StepCard step={1} title="Leave, Attendance & Payable Units"  subtitle={stepDone(1) ? "Marked as complete" : "No Action taken"} Icon={CalendarIcon}
                onClick={() => setStep1Open(true)} done={stepDone(1)} />
              <StepCard step={2} title="New Joinees & Exits"                subtitle={stepDone(2) ? "Marked as complete" : "No Action taken"} Icon={UserPlus}
                onClick={() => setStep2Open(true)} done={stepDone(2)} />
              <StepCard step={3} title="Bonus, Salary Revisions & Overtime" subtitle={stepDone(3) ? "Marked as complete" : "No Action taken"} Icon={Briefcase}
                onClick={() => setStep3Open(true)} done={stepDone(3)} />
              <StepCard step={4} title="Reimbursement, Adhoc Payment, Deduction" subtitle={stepDone(4) ? "Marked as complete" : "No Action taken"} Icon={SlidersHorizontal}
                onClick={() => setStep4Open(true)} done={stepDone(4)} />
              <StepCard step={5} title="Salaries on Hold & Arrears"         subtitle={stepDone(5) ? "Marked as complete" : "No Action taken"} Icon={Hourglass}
                onClick={() => setStep5Open(true)} done={stepDone(5)} />
              <StepCard step={6} title="Override (PT, ESI, TDS, LWF)"       subtitle={stepDone(6) ? "Marked as complete" : "No Action taken"} Icon={UserCheck}
                onClick={() => setStep6Open(true)} done={stepDone(6)} />
              {/* Step 7 — final review of the whole org's payslips before
                  locking. Auto-completes once the run is locked / paid;
                  clicking the card opens the same PreCheckPanel HR used
                  to use via the action-row "Review all employees" button.
                  Disabled until payslips exist (nothing to review yet). */}
              <StepCard step={7} title="Review & Finalise"
                subtitle={stepDone(7) ? "Locked — review confirmed" : (totals?.payslipCount ?? 0) > 0 ? "Open to review every payslip" : "Process payroll first"}
                Icon={ShieldCheck}
                onClick={() => setPreCheckOpen(true)}
                done={stepDone(7)} />
            </div>

            {/* Bottom action row — Process / Review / Lock — gated by run
                status. These are the only buttons that actually mutate
                the PayrollRun; the six step cards above just feed data
                that the Process step then consumes. */}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={doRunSalary}
                disabled={busyStep === "run-salary" || statusForSteps === "locked" || statusForSteps === "paid"}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busyStep === "run-salary" ? "Processing…" : statusForSteps === "generated" ? "Re-process Payroll" : "Process Payroll"}
              </button>
              {/* Unlock — only while THIS brand's run is locked (not paid),
                  and only for the salary-trusted developer (gagan). Reopens
                  locked → generated for the selected brand so payslips can be
                  fixed and re-locked; the other brand is untouched. */}
              {statusForSteps === "locked" && canUnlock && (
                <button
                  onClick={() => doTransition("reopen")}
                  disabled={busyStep === "pre-check"}
                  title={`Unlock ${payrollEntity} — return to generated so payslips can be edited before paying`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-[12.5px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Lock size={13} />
                  {busyStep === "pre-check" ? "Unlocking…" : "Unlock Payroll"}
                </button>
              )}
              <button
                onClick={() => statusForSteps === "locked" ? doTransition("mark_paid") : doTransition("lock")}
                disabled={!selected?.run || busyStep === "finalize" || (totals?.payslipCount ?? 0) === 0 || statusForSteps === "paid"}
                className="px-5 py-2 rounded-lg bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busyStep === "finalize" ? "Working…" :
                 statusForSteps === "locked" ? "Mark Paid" : "Lock Payroll"}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <RailCard title="Activity">
              {!activity ? (
                <p className="text-[12px] text-slate-400">Loading…</p>
              ) : activity.items?.length > 0 ? (
                <ul className="space-y-2">
                  {activity.items.slice(0, 8).map((a: any) => (
                    <li key={a.id} className="text-[11.5px] leading-snug">
                      <span className="font-semibold text-slate-700">{a.actorName || "system"}</span>{" "}
                      <span className="text-slate-500">{labelForAction(a.action)}</span>
                      <span className="block text-[10.5px] text-slate-400 mt-0.5">{timeAgo(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-slate-400">No activity yet for this cycle.</p>
              )}
            </RailCard>
            <RailCard title="Help Resources">
              <ul className="space-y-2 text-[12.5px]">
                <li><a className="text-[#0f4e93] hover:underline" href="#">How to override statutory contributions &amp; deductions?</a></li>
                <li><a className="text-[#0f4e93] hover:underline" href="#">Handle ad-hoc payments &amp; deductions</a></li>
                <li><a className="text-[#0f4e93] hover:underline" href="#">Reverse a finalised payroll</a></li>
              </ul>
            </RailCard>
          </div>
        </div>
      </div>

      {/* Pre-Payroll Check side panel */}
      {preCheckOpen && selected?.run && (
        <PreCheckPanel
          runId={selected.run.id}
          monthLabel={monthLabelShort}
          runStatus={selectedRunStatus}
          brand={payrollEntity}
          onClose={() => setPreCheckOpen(false)}
        />
      )}

      {/* Step 1 — Leave, Attendance & Payable Units side panel */}
      {step1Open && selected && (
        <Step1Panel
          year={selected.year}
          month0={selected.month0}
          monthLabel={monthLabelShort}
          brand={payrollEntity}
          onClose={() => setStep1Open(false)}
          onMarkedComplete={() => markStepComplete(1)}
        />
      )}

      {/* Step 2 — New Joinees & Exits side panel */}
      {step2Open && selected && (
        <Step2Panel
          year={selected.year}
          month0={selected.month0}
          monthLabel={monthLabelShort}
          brand={payrollEntity}
          onClose={() => setStep2Open(false)}
          onMarkedComplete={() => markStepComplete(2)}
        />
      )}

      {/* Step 3 — Bonus, Salary Revisions & Overtime side panel */}
      {step3Open && selected && (
        <Step3Panel
          year={selected.year}
          month0={selected.month0}
          monthLabel={monthLabelShort}
          brand={payrollEntity}
          onClose={() => setStep3Open(false)}
          onMarkedComplete={() => markStepComplete(3)}
        />
      )}

      {/* Step 4 — Reimbursement, Adhoc Payment, Deduction side panel */}
      {step4Open && selected && (
        <Step4Panel
          year={selected.year}
          month0={selected.month0}
          monthLabel={monthLabelShort}
          brand={payrollEntity}
          onClose={() => setStep4Open(false)}
          onMarkedComplete={() => markStepComplete(4)}
        />
      )}

      {/* Step 5 — Salaries on Hold & Arrears side panel */}
      {step5Open && selected && (
        <Step5Panel
          year={selected.year}
          month0={selected.month0}
          monthLabel={monthLabelShort}
          brand={payrollEntity}
          onClose={() => setStep5Open(false)}
          onMarkedComplete={() => markStepComplete(5)}
        />
      )}

      {/* Step 6 — Override (PT, ESI, TDS, LWF) side panel */}
      {step6Open && selected && (
        <Step6Panel
          year={selected.year}
          month0={selected.month0}
          monthLabel={monthLabelShort}
          brand={payrollEntity}
          onClose={() => setStep6Open(false)}
          onMarkedComplete={() => markStepComplete(6)}
        />
      )}
    </div>
  );
}

// Thin page wrapper — the actual logic lives in `RunPayrollPanel` so
// the HR Admin page can embed it inline.
export default function RunPayrollPage() {
  return <RunPayrollPanel />;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function labelForAction(action: string): string {
  // Human-friendly verbs for common audit actions. Falls back to the
  // raw action string so we never silently hide unknown events.
  const map: Record<string, string> = {
    "payroll_run.create":      "created the run",
    "payroll_run.lock":        "locked the run",
    "payroll_run.pay":         "marked the run paid",
    "payroll_run.reopen":      "re-opened the run",
    "payslip.generate":        "generated payslips",
    "bonus.create":            "added a bonus",
    "bonus.update":            "updated a bonus",
    "bonus.delete":            "removed a bonus",
    "salary_structure.update": "updated a salary structure",
  };
  return map[action] || action;
}

function MonthStrip({ cells, selectedKey, onSelect }: {
  cells: MonthCell[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="relative bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        <button className="shrink-0 flex items-center justify-center w-7 self-center text-slate-400 hover:text-slate-600">
          <ChevronLeft size={16} />
        </button>
        {cells.map((c) => {
          const isSelected = c.key === selectedKey;
          const isCurrent  = c.status === "current";
          return (
            <button
              key={c.key}
              onClick={() => onSelect(c.key)}
              className={`shrink-0 w-[110px] rounded-lg border px-3 py-2.5 text-left transition-all hover:shadow-sm ${
                isSelected ? "ring-2 ring-[#1e64ce] ring-offset-1" : ""
              }`}
              style={{
                backgroundColor: isCurrent ? "#1e64ce" : "white",
                borderColor:     isCurrent ? "#1e64ce" : "#e2e8f0",
              }}
            >
              <p className={`text-[12px] font-bold ${isCurrent ? "text-white" : "text-slate-800"}`}>
                {MONTHS_SHORT[c.month0]} {c.year}
              </p>
              <p className={`text-[10px] mt-0.5 ${isCurrent ? "text-white/80" : "text-slate-500"}`}>
                01 {MONTHS_LONG[c.month0]}-{daysInMonth(c.year, c.month0 + 1)} {MONTHS_LONG[c.month0]}
              </p>
              <div className="mt-1.5">
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ${
                    c.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                    c.status === "current"   ? "bg-white/20 text-white"          :
                                               "bg-slate-100 text-slate-500"
                  }`}
                >
                  {c.status === "completed" && <CheckCircle2 size={9} strokeWidth={3} />}
                  {c.status === "current"   && <PlayCircle   size={9} strokeWidth={3} />}
                  {c.status === "completed" ? "COMPLETED" : c.status === "current" ? "CURRENT" : "UPCOMING"}
                </span>
              </div>
            </button>
          );
        })}
        <button className="shrink-0 flex items-center justify-center w-7 self-center text-slate-400 hover:text-slate-600">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function StatsRow({
  totalEmployees, calendarDays, processedCount,
  totalPayrollCost, employeeDeposit, totalDeductions, totalContributions,
  prevMonthLabel,
  prevTotalPayrollCost, prevEmployeeDeposit, prevTotalDeductions, prevTotalContributions,
}: {
  totalEmployees: number;
  calendarDays: number;
  processedCount: number;
  totalPayrollCost: number;
  employeeDeposit: number;
  totalDeductions: number;
  totalContributions: number;
  prevMonthLabel: string | null;
  prevTotalPayrollCost:   number | null;
  prevEmployeeDeposit:    number | null;
  prevTotalDeductions:    number | null;
  prevTotalContributions: number | null;
}) {
  // Single horizontal row matching Keka's payroll header. The first
  // three blocks live inside one bordered group on the left (gray
  // background); everything past the `=` operator is per-stat with
  // optional previous-month trend lines beneath.
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-5 flex-wrap xl:flex-nowrap">
        {/* Left grouping: Employees / Calendar Days / Payroll Processed */}
        <div className="flex items-end gap-6 rounded-lg border border-slate-200 bg-slate-50 px-5 py-3">
          <StatBlock label="TOTAL EMPLOYEES" value={String(totalEmployees)} />
          <StatBlock label="CALENDAR DAYS"   value={String(calendarDays)} />
          <StatBlock label="PAYROLL PROCESSED" value={`${processedCount}/${totalEmployees} EMPLOYEES`} small />
        </div>

        <Operator>=</Operator>

        <MoneyStat
          label="Total Payroll Cost"
          value={totalPayrollCost}
          prevLabel={prevMonthLabel}
          prevValue={prevTotalPayrollCost}
        />

        <Operator>+</Operator>

        <MoneyStat
          label="Employee Deposit"
          value={employeeDeposit}
          prevLabel={prevMonthLabel}
          prevValue={prevEmployeeDeposit}
          info="Net pay only — excludes employer contributions and one-off payments."
        />

        <Operator>+</Operator>

        <MoneyStat
          label="Total Deductions"
          value={totalDeductions}
          prevLabel={prevMonthLabel}
          prevValue={prevTotalDeductions}
        />

        <Operator>+</Operator>

        <MoneyStat
          label="Total contributions"
          value={totalContributions}
          prevLabel={prevMonthLabel}
          prevValue={prevTotalContributions}
        />
      </div>
    </div>
  );
}

function Operator({ children }: { children: React.ReactNode }) {
  return <div className="text-[18px] font-bold text-slate-400 self-end pb-1">{children}</div>;
}

// Money-valued stat with an optional "PREV INR <delta> ↑/↓" trend line
// underneath. The delta is signed (current − prev), so a drop in cost
// from one month to the next reads as a negative number with a ↓ arrow.
function MoneyStat({ label, value, prevLabel, prevValue, info }: {
  label: string;
  value: number;
  prevLabel: string | null;
  prevValue: number | null;
  info?: string;
}) {
  const showDelta = prevLabel && prevValue != null;
  const delta = showDelta ? value - (prevValue as number) : null;
  const arrow = delta == null ? "" : delta > 0 ? "↑" : delta < 0 ? "↓" : "";
  // Red for any non-zero change — same look the Keka screenshot uses.
  // (You could swap to green for cost reductions if you prefer; HR
  // typically reads either direction as "needs attention" so we don't.)
  const trendColor = delta && delta !== 0 ? "text-rose-500" : "text-slate-400";

  return (
    <div className="min-w-[140px]">
      <p className="text-[11.5px] font-medium text-slate-500 flex items-center gap-1">
        {label}
        {info && <span title={info} className="text-slate-400 cursor-help">ⓘ</span>}
      </p>
      <p className="mt-0.5 text-[18px] font-bold text-slate-800 tabular-nums">{fmtInr(value)}</p>
      {showDelta && (
        <p className={`mt-0.5 text-[10.5px] font-semibold ${trendColor} tabular-nums`}>
          {prevLabel} {fmtInr(delta!)} <span className="ml-0.5">{arrow}</span>
        </p>
      )}
    </div>
  );
}

function StatBlock({ label, value, small, info }: { label: string; value: string; small?: boolean; info?: boolean }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
        {label}
        {info && <span title="Net pay only — excludes employer contributions and one-off payments." className="text-slate-400 cursor-help">ⓘ</span>}
      </p>
      <p className={`mt-1 ${small ? "text-[14px]" : "text-[18px]"} font-bold text-slate-800 tabular-nums`}>{value}</p>
    </div>
  );
}

function StepCard({ step, title, subtitle, Icon, href, onClick, done, busy, disabled }: {
  step: number;
  title: string;
  subtitle?: string;
  Icon: typeof Calendar;
  href?: string;
  onClick?: () => void;
  done?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  // Keka-style card: title in indigo, subtitle in grey ("Last Changes on …
  // BY Tanvi Dogra" once we wire per-step audit; "No Action taken"
  // otherwise). No CTA chevron inside the card — clicking the whole
  // card is the action.
  const isLink   = !!href && !onClick;
  const isAction = !!onClick;

  // One muted tint per step number — matches the soft-coloured circles
  // in the Keka mock (calendar=sky, joinees=rose, bonus=violet,
  // reimbursement=teal, salaries-on-hold=amber, override=indigo).
  const tints = [
    { bg: "bg-sky-50",    fg: "text-sky-600"    },
    { bg: "bg-rose-50",   fg: "text-rose-500"   },
    { bg: "bg-violet-50", fg: "text-violet-600" },
    { bg: "bg-teal-50",   fg: "text-teal-600"   },
    { bg: "bg-amber-50",  fg: "text-amber-600"  },
    { bg: "bg-indigo-50", fg: "text-indigo-600" },
  ];
  const tint = tints[(step - 1) % tints.length];

  const inner = (
    <div className="flex items-start gap-3">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
        done ? "bg-emerald-100 text-emerald-700" : `${tint.bg} ${tint.fg}`
      }`}>
        {done ? <CheckCircle2 size={20} /> : <Icon size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#0f4e93] truncate">
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-[11.5px] text-slate-500">{subtitle}</p>
        )}
      </div>
    </div>
  );

  const baseClass = `block rounded-lg border border-slate-200 p-4 transition-colors text-left w-full ${
    disabled ? "opacity-50 cursor-not-allowed"
             : "hover:border-[#0f4e93] hover:bg-sky-50/40 cursor-pointer"
  }`;

  if (isLink) return <Link href={href!} className={baseClass}>{inner}</Link>;
  if (isAction) {
    return (
      <button type="button" onClick={() => !disabled && !busy && onClick?.()} disabled={!!disabled || !!busy} className={baseClass}>
        {inner}
      </button>
    );
  }
  return <div className={baseClass}>{inner}</div>;
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left text-[13px] font-semibold text-slate-800">
        {title}
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

// ─── Pre-Payroll Check side panel ───────────────────────────────────────────
// Slides in from the right showing every payslip for the selected run with
// gross / deductions / net so HR can sanity-check before lock. Read-only.

function PreCheckPanel({ runId, monthLabel, runStatus, brand, onClose }: { runId: number; monthLabel: string; runStatus: string | null; brand: "NB Media" | "YT Labs"; onClose: () => void }) {
  // Pull payslips for the run. The /api/hr/payroll/payslips route already
  // supports a runId filter via query string.
  const { data: payslips = [] } = useSWR<any[]>(`/api/hr/payroll/payslips?runId=${runId}&brand=${encodeURIComponent(brand)}`, fetcher);
  const totalGross = payslips.reduce((s, p) => s + parseFloat(p.grossEarnings || 0), 0);
  const totalNet   = payslips.reduce((s, p) => s + parseFloat(p.netPay || 0), 0);
  const totalPf    = payslips.reduce((s, p) => s + parseFloat(p.pfEmployee || 0), 0);
  // Deductions stat excludes PF — PF is shown in its own column/stat so HR can
  // read the statutory PF figure separately from PT / TDS / other deductions.
  const totalDed   = payslips.reduce((s, p) => s + (parseFloat(p.totalDeductions || 0) - parseFloat(p.pfEmployee || 0)), 0);

  // Statutory + bank exports are gated until the run is locked or paid.
  // Showing them earlier risks HR emailing the bank a draft batch that
  // gets revised; the 409 from the API would protect us either way, but
  // disabling the buttons is the cleaner UX.
  const downloadsEnabled = runStatus === "locked" || runStatus === "paid";

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Pre-Payroll Check</p>
            <h3 className="text-[15px] font-semibold text-slate-800">{monthLabel} — {payslips.length} payslip(s)</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </header>

        <div className="px-5 py-3 grid grid-cols-4 gap-4 border-b border-slate-100">
          <StatBlock label="Gross"      value={fmtInr(totalGross)} small />
          <StatBlock label="PF"         value={fmtInr(totalPf)}    small />
          <StatBlock label="Deductions" value={fmtInr(totalDed)}   small />
          <StatBlock label="Net Pay"    value={fmtInr(totalNet)}   small />
        </div>

        <DownloadBar runId={runId} enabled={downloadsEnabled} runStatus={runStatus} brand={brand} />

        <div className="flex-1 overflow-y-auto">
          {payslips.length === 0 ? (
            <p className="text-center text-[12.5px] text-slate-500 py-10">No payslips yet — click "Generate payslips" first.</p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2">Employee</th>
                  <th className="px-2 py-2 text-center">Days</th>
                  <th className="px-2 py-2 text-right">Gross</th>
                  <th className="px-2 py-2 text-right">Arrears</th>
                  <th className="px-2 py-2 text-right">PF</th>
                  <th className="px-2 py-2 text-right">Deductions</th>
                  <th className="px-4 py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p: any) => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-800 whitespace-nowrap">{p.user?.name ?? `User ${p.userId}`}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-slate-600 whitespace-nowrap">
                      {Number(p.presentDays)}<span className="text-slate-400">/{p.workingDays}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtInr(parseFloat(p.grossEarnings))}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-700 whitespace-nowrap">
                      {parseFloat(p.bonus) > 0 ? fmtInr(parseFloat(p.bonus)) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-700 whitespace-nowrap">
                      {parseFloat(p.pfEmployee) > 0 ? fmtInr(parseFloat(p.pfEmployee)) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-700 whitespace-nowrap">{fmtInr(parseFloat(p.totalDeductions) - parseFloat(p.pfEmployee))}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{fmtInr(parseFloat(p.netPay))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  );
}

// ─── Post-lock download bar ────────────────────────────────────────────────
// Four downloads that finance / banks / EPFO actually consume:
//   • BatchPayment_Monthly_Statement — per-bank transfer file
//   • PT Monthly Statement           — Professional Tax filing
//   • EmployerECR                    — EPFO Electronic Challan-cum-Return
//   • Keka PayRegister               — master pay register
// Buttons stay disabled while the run is draft / generated / processing so
// HR can't email a half-finalised batch to the bank.
type ExportDef = { key: string; label: string; sub: string };
const PAYROLL_EXPORTS: ExportDef[] = [
  { key: "batch-payment", label: "Batch Payment", sub: "Per-bank transfer file" },
  { key: "pt-statement",  label: "PT Statement",  sub: "Professional Tax filing" },
  { key: "employer-ecr",  label: "Employer ECR",  sub: "EPFO upload (PF)" },
  { key: "pay-register",  label: "Pay Register",  sub: "Master register (Keka format)" },
];

function DownloadBar({ runId, enabled, runStatus, brand }: { runId: number; enabled: boolean; runStatus: string | null; brand: "NB Media" | "YT Labs" }) {
  const [busy, setBusy] = useState<string | null>(null);

  // Fetch the file as a blob first so 4xx errors (e.g. 422 "missing bank
  // info") surface as an alert with the JSON message instead of the
  // browser saving a JSON file with an xlsx extension.
  async function download(key: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/hr/payroll/runs/${runId}/exports/${key}?brand=${encodeURIComponent(brand)}`);
      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await res.json().catch(() => ({}));
          const extra = Array.isArray(j.missing) && j.missing.length > 0
            ? `\n\nMissing for:\n${j.missing.slice(0, 8).map((m: any) => `• ${m.name}${m.employeeId ? ` (${m.employeeId})` : ""}`).join("\n")}${j.missing.length > 8 ? `\n…and ${j.missing.length - 8} more` : ""}`
            : "";
          alert(`${j.error || res.statusText}${extra}`);
        } else {
          alert(`Download failed: ${res.statusText}`);
        }
        return;
      }
      // Parse filename from Content-Disposition or fall back to the key.
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m?.[1] || `${key}.xlsx`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Statutory & Bank Files</p>
        {!enabled && (
          <span className="text-[11px] text-slate-400">
            Lock the run to enable downloads{runStatus ? ` (current: ${runStatus})` : ""}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PAYROLL_EXPORTS.map(e => (
          <button key={e.key}
            disabled={!enabled || busy !== null}
            onClick={() => download(e.key)}
            className="flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-left hover:border-[#6f42c1] hover:bg-[#6f42c1]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <span className="text-[12.5px] font-semibold text-slate-800">
              {busy === e.key ? "Preparing…" : e.label}
            </span>
            <span className="text-[10.5px] text-slate-500">{e.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 3 — Bonus, Salary Revisions & Overtime ────────────────────────────
// Side panel with three sub-tabs:
//   • Bonus            — fully wired to /api/hr/payroll/bonus (list + add + delete)
//   • Salary Revisions — list of SalaryStructure rows whose effectiveFrom
//                        falls in the selected month (read-only summary)
//   • Overtime         — placeholder (no backend yet)
//
// `month0` is 0-indexed (Jan=0) so it matches PayrollRun.month.

type BonusItem = {
  id: number;
  userId: number;
  amount: string;
  reason: string | null;
  effectiveDate: string;
  bonusType: string | null;
  paymentStatus: string;
  name?: string;
  role?: string;
};

// Step 3 = Employee Salary Changes panel — 4-step internal wizard:
//   1. BONUS              — one-off bonuses (fully wired to /api/hr/payroll/bonus)
//   2. SALARY REVISION    — pending structure changes (placeholder; needs list endpoint)
//   3. OVERTIME PAYMENT   — OT entries (placeholder; no backend yet)
//   4. SHIFT ALLOWANCE    — shift allowance entries (placeholder; no backend yet)
//
// Sequential nav: Back + Save & Continue on steps 1-3; Back + Save & Close
// + Mark as Complete on step 4. The wizard's `currentStep` is local state
// — there's no per-substep persistence yet; once the outer PayrollRun
// stepStates JSON column lands, "Mark as Complete" will flip step 3 of
// the outer 6-step flow to done.
type SubStep = 1 | 2 | 3 | 4;
const SUB_STEPS: { n: SubStep; label: string }[] = [
  { n: 1, label: "BONUS" },
  { n: 2, label: "SALARY\nREVISION" },
  { n: 3, label: "OVERTIME\nPAYMENT" },
  { n: 4, label: "SHIFT\nALLOWANCE" },
];

function Step3Panel({ year, month0, monthLabel, brand, onClose, onMarkedComplete }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  onClose: () => void;
  onMarkedComplete?: () => void | Promise<void>;
}) {
  const [current, setCurrent] = useState<SubStep>(1);
  const [showAdd, setShowAdd] = useState(false);

  // Bonus list (step 1) — only data wired with a real backend right now.
  const bonusUrl = `/api/hr/payroll/bonus?month=${month0}&year=${year}&brand=${encodeURIComponent(brand)}`;
  const { data: bonusData } = useSWR<{ items: BonusItem[] }>(bonusUrl, fetcher);
  const bonusItems = bonusData?.items ?? [];

  async function handleDelete(id: number) {
    if (!confirm("Remove this bonus?")) return;
    const res = await fetch(`/api/hr/payroll/bonus?id=${id}`, { method: "DELETE" });
    if (res.ok) mutate(bonusUrl);
    else alert((await res.json().catch(() => ({})))?.error || "Delete failed");
  }

  function goBack()    { setCurrent((c) => (c > 1 ? ((c - 1) as SubStep) : c)); }
  function goNext()    { setCurrent((c) => (c < 4 ? ((c + 1) as SubStep) : c)); }
  async function complete() { try { await onMarkedComplete?.(); } finally { onClose(); } }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col">
        {/* ─── Header ─── */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">
            Employee Salary Changes: {monthLabel}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </header>

        {/* ─── Wizard indicator + nav buttons row ─── */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-slate-100">
          <div className="flex-1 flex items-center justify-center gap-10">
            {SUB_STEPS.map((s, i) => {
              const active = s.n === current;
              return (
                <div key={s.n} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
                      active
                        ? "bg-[#6f42c1] text-white border-2 border-[#6f42c1]"
                        : "bg-white text-slate-500 border-2 border-slate-300"
                    }`}
                  >
                    {s.n}
                  </div>
                  <span
                    className={`text-[11px] font-semibold tracking-wide whitespace-pre-line leading-tight ${
                      active ? "text-[#6f42c1]" : "text-slate-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Right-side buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {current > 1 && (
              <button
                onClick={goBack}
                className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            )}
            {current < 4 ? (
              <button
                onClick={goNext}
                className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]"
              >
                Save &amp; Continue
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Save &amp; Close
                </button>
                <button
                  onClick={complete}
                  className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]"
                >
                  Mark as Complete
                </button>
              </>
            )}
          </div>
        </div>

        {/* ─── Body — main column + Help Resources rail ─── */}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          <div className="flex gap-5 p-5">
            <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5">
              {current === 1 && (
                <BonusSubStep
                  items={bonusItems}
                  monthLabel={monthLabel}
                  onAdd={() => setShowAdd(true)}
                  onDelete={handleDelete}
                />
              )}
              {current === 2 && <SalaryRevisionSubStep   year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 3 && <OvertimePaymentSubStep  year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 4 && <ShiftAllowanceSubStep   year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
            </div>

            {/* Help Resources rail — distinct content per sub-step */}
            <aside className="hidden lg:block w-[280px] shrink-0">
              <HelpResources step={current} />
            </aside>
          </div>
        </div>
      </aside>

      {/* Add bonus modal */}
      {showAdd && (
        <AddBonusModal
          year={year}
          month0={month0}
          monthLabel={monthLabel}
          brand={brand}
          onClose={() => setShowAdd(false)}
          onAdded={() => { mutate(bonusUrl); setShowAdd(false); }}
        />
      )}
    </>
  );
}

// ─── Step 3 sub-steps ──────────────────────────────────────────────────────

function BonusSubStep({ items, monthLabel, onAdd, onDelete }: {
  items: BonusItem[];
  monthLabel: string;
  onAdd: () => void;
  onDelete: (id: number) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = items.filter((b) =>
    !search ||
    (b.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (b.bonusType || "").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Bonus</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        All pending bonuses to be paid (including any past unpaid bonuses) will be shown here.
        New bonuses can also be added using the <span className="font-semibold">+ Add bonus</span> button.
      </p>
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onAdd}
          className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5"
        >
          + Add bonus
        </button>
        <div className="ml-auto relative w-[260px]">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full h-8 pl-8 pr-3 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:border-[#6f42c1]"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">⌕</span>
        </div>
      </div>
      <KekaTable
        columns={["Employee", "Payout Date", "Bonus Type", "Amount", "Pay Action", "Comment"]}
        rightAlignedColumns={[3]}
      >
        {filtered.length === 0 ? (
          <EmptyRow colSpan={6} text={`No records found for ${monthLabel}.`} />
        ) : (
          filtered.map((b) => (
            <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50/60">
              <td className="px-4 py-3 text-slate-800">
                {b.name ?? `User ${b.userId}`}
                <span className="block text-[10.5px] text-slate-400">{b.role ?? "—"}</span>
              </td>
              <td className="px-4 py-3 text-slate-600 tabular-nums">{new Date(b.effectiveDate).toISOString().slice(0, 10)}</td>
              <td className="px-4 py-3 text-slate-600">{b.bonusType || "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtInr(parseFloat(b.amount))}</td>
              <td className="px-4 py-3 text-slate-600">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-50 text-emerald-700">
                  {b.paymentStatus === "paid_past" ? "Paid" : "Pay"}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-500 text-[12px]">
                {b.reason || <span className="text-slate-300">—</span>}
                <button
                  onClick={() => onDelete(b.id)}
                  className="ml-2 text-[11px] text-rose-500 hover:underline"
                >Remove</button>
              </td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={filtered.length} />
    </>
  );
}

function SalaryRevisionSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  type Row = {
    id: number; userId: number; userName: string | null; employeeId: string | null;
    oldCtc: string | null; newCtc: string | null; effectiveDate: string | null;
    changedAt: string; actorName: string | null;
  };
  const url = `/api/hr/payroll/salary-revisions?month=${month0}&year=${year}&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: Row[] }>(url, fetcher);
  const items = data?.items ?? [];

  function pct(oldS: string | null, newS: string | null) {
    const o = parseFloat(oldS ?? "0"); const n = parseFloat(newS ?? "0");
    if (!o || !n) return "—";
    const d = ((n - o) / o) * 100;
    return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
  }

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Salary Revision</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        SalaryStructure changes (CTC modified) effective in {monthLabel} — by effective date, regardless of when the edit was entered. Source: AuditLog. Edit individual structures via the employee profile's Finances tab.
      </p>
      <div className="flex items-center justify-end mb-3"><SearchBox /></div>
      <KekaTable columns={["Employee Number", "Employee Name", "Old CTC", "New CTC", "Change %", "Effective From", "By"]}>
        {items.length === 0 ? (
          <EmptyRow colSpan={7} text={`No salary revisions for ${monthLabel}.`} />
        ) : (
          items.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] font-mono text-slate-700">{r.employeeId ?? "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName ?? `User ${r.userId}`}</td>
              <td className="px-3 py-2 text-[12.5px] tabular-nums text-slate-600">{r.oldCtc ? fmtInr(parseFloat(r.oldCtc)) : "—"}</td>
              <td className="px-3 py-2 text-[12.5px] tabular-nums text-slate-800 font-semibold">{r.newCtc ? fmtInr(parseFloat(r.newCtc)) : "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-emerald-600 font-semibold">{pct(r.oldCtc, r.newCtc)}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{r.effectiveDate ? new Date(r.effectiveDate).toLocaleDateString() : "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-500">{r.actorName ?? "—"}</td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={items.length} />
    </>
  );
}

// Typed adhoc sub-step (overtime / shift_allowance / arrears) — reuses the
// AdhocLineItem table with a fixed `type` value so the engine treats it the
// same as a normal adhoc payment.
function TypedAdhocSubStep({ year, month0, monthLabel, brand, type, title, blurb }: {
  year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs";
  type: string; title: string; blurb: string;
}) {
  const url = `/api/hr/payroll/adhoc?month=${month0}&year=${year}&kind=payment&brand=${encodeURIComponent(brand)}`;
  type AdhocRow = { id: number; userId: number; userName: string; type: string | null; amount: string; comment: string | null };
  const { data } = useSWR<{ items: AdhocRow[] }>(url, fetcher);
  const filtered = (data?.items ?? []).filter((r) => r.type === type);

  async function remove(id: number) {
    if (!confirm("Remove this entry?")) return;
    const res = await fetch(`/api/hr/payroll/adhoc?id=${id}`, { method: "DELETE" });
    if (res.ok) mutate(url);
    else alert((await res.json().catch(() => ({})))?.error || "Delete failed");
  }

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">{title}</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">{blurb}</p>
      <div className="flex items-center justify-end mb-3"><SearchBox /></div>
      <KekaTable columns={["Employee", "Amount", "Comment", "Action"]} rightAlignedColumns={[1]}>
        {filtered.length === 0 ? (
          <EmptyRow colSpan={4} text={`No ${title.toLowerCase()} entries for ${monthLabel}.`} />
        ) : (
          filtered.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName}</td>
              <td className="px-3 py-2 text-[12.5px] text-right tabular-nums font-semibold">{fmtInr(parseFloat(r.amount))}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-500">{r.comment ?? "—"}</td>
              <td className="px-3 py-2"><button onClick={() => remove(r.id)} className="text-[11px] text-rose-500 hover:underline">Remove</button></td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={filtered.length} />
      <p className="mt-3 text-[11px] text-slate-400">
        These reuse <span className="font-mono">AdhocLineItem</span> (kind=payment, type={type}) so the engine includes them in gross.
        Add new entries from Step 4 → Adhoc Payments with type set to <span className="font-mono">{type}</span>.
      </p>
    </>
  );
}

function OvertimePaymentSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  return <TypedAdhocSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand}
    type="overtime"
    title="Overtime Payment"
    blurb={`Approved overtime payments queued for ${monthLabel}. Engine adds these to gross pay.`} />;
}

function ShiftAllowanceSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  return <TypedAdhocSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand}
    type="shift_allowance"
    title="Shift Allowance Payment"
    blurb={`Shift allowance entries for ${monthLabel}. Engine adds these to gross pay.`} />;
}

// ─── Step 3 helpers ─────────────────────────────────────────────────────────

function KekaTable({ columns, children, rightAlignedColumns = [], firstColumnIsCheckbox = false }: {
  columns: string[];
  children: React.ReactNode;
  rightAlignedColumns?: number[];
  // When true, prepends an empty header cell with a checkbox (header
  // checkbox is for "select all" — wired only when inline editing for
  // adhoc payments / deductions lands).
  firstColumnIsCheckbox?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {firstColumnIsCheckbox && (
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" disabled className="rounded border-slate-300" />
              </th>
            )}
            {columns.map((c, i) => (
              <th
                key={c}
                className={`px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 ${
                  rightAlignedColumns.includes(i) ? "text-right" : "text-left"
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center text-[12.5px] text-slate-400 py-14">
        {text}
      </td>
    </tr>
  );
}

function Pagination({ count }: { count: number }) {
  // Static for now — every sub-step shows ≤ a single page worth of rows.
  // Real pagination only matters once we have hundreds of bonuses, which
  // isn't a realistic Indian-org-size case for this UI.
  const totalPages = Math.max(1, Math.ceil(count / 25));
  return (
    <div className="mt-3 flex items-center justify-end gap-3 text-[11px] text-slate-500">
      <span>{count === 0 ? "0 to 0 of 0" : `1 to ${count} of ${count}`}</span>
      <span className="text-slate-300">|</span>
      <button disabled className="opacity-40">⏮</button>
      <button disabled className="opacity-40">‹</button>
      <span>Page {count === 0 ? 0 : 1} of {count === 0 ? 0 : totalPages}</span>
      <button disabled className="opacity-40">›</button>
      <button disabled className="opacity-40">⏭</button>
    </div>
  );
}

function HelpResources({ step }: { step: SubStep }) {
  // Sub-step-specific FAQ links. Match Keka's wording so it reads as
  // familiar to anyone who's used their product.
  const sets: Record<SubStep, { question: string }[]> = {
    1: [
      { question: "Why am I not able to see bonus for an employee?" },
      { question: "How can I pay more than 100% of promised bonus?" },
      { question: "How can I process bonus separately from salary?" },
      { question: "How can I manage TDS on bonus?" },
    ],
    2: [
      { question: "How do I revise an employee's salary mid-month?" },
      { question: "What does 'Release' do under Revision Action?" },
      { question: "Can I hold a salary revision for next cycle?" },
    ],
    3: [
      { question: "Why is zero overtime shown for few employees?" },
      { question: "Why am I not able to see overtime for an employee?" },
      { question: "How to add/update hourly pay formula for overtime?" },
      { question: "Why overtime paid hours are less than total overtime worked?" },
    ],
    4: [
      { question: "Why am I not able to see shift allowance for an employee?" },
    ],
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h5 className="text-[13px] font-semibold text-slate-800 mb-3 flex items-center justify-between">
        Help Resources
        <span className="text-slate-400 text-[14px]">▾</span>
      </h5>
      <ul className="space-y-2.5">
        {sets[step].map((q) => (
          <li key={q.question} className="flex items-start gap-2">
            <a href="#" className="text-[12px] text-slate-700 hover:text-[#6f42c1] hover:underline flex-1">{q.question}</a>
            <span className="text-slate-400">↗</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-[12px] font-semibold text-slate-800">Still need help?</p>
        <p className="text-[11.5px] text-slate-500 mt-0.5">If your question isn't answered above, we're here for you.</p>
      </div>
    </div>
  );
}

// Add-bonus modal — employee picker + amount + type + reason. Posts
// to /api/hr/payroll/bonus then mutates the parent list.
function AddBonusModal({ year, month0, monthLabel, brand, onClose, onAdded }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  onClose: () => void;
  onAdded: () => void;
}) {
  const { data: empData } = useSWR<any[]>(`/api/hr/employees?brand=${encodeURIComponent(brand)}`, fetcher);
  const employees = Array.isArray(empData) ? empData : (empData as any)?.employees ?? [];

  const [userId, setUserId]               = useState<number | "">("");
  const [amount, setAmount]               = useState<string>("");
  const [bonusType, setBonusType]         = useState<string>("Performance Bonus");
  const [reason, setReason]               = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>(() => {
    // Default to the 1st of the selected payroll month so the bonus
    // lands in the cycle by default.
    return `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const TYPES = [
    "Performance Bonus", "Referral Bonus", "Joining Bonus", "Retention Bonus",
    "Overtime", "Festival Bonus", "Other",
  ];

  async function submit() {
    setError(null);
    if (!userId) { setError("Pick an employee"); return; }
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError("Amount must be positive"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/payroll/bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount: amt, reason, effectiveDate, bonusType, paymentStatus: "due_future" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Could not add");
      }
      onAdded();
    } catch (e: any) {
      setError(e?.message || "Could not add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 pointer-events-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800">Add Bonus — {monthLabel}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Employee</label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              >
                <option value="">Select…</option>
                {employees.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Amount (INR)</label>
                <input
                  type="number" min={0} step={1}
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white tabular-nums"
                  placeholder="e.g. 5000"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Effective Date</label>
                <DateField
                  value={effectiveDate} onChange={(v) => setEffectiveDate(v)}
                  className="mt-1 w-full"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Type</label>
              <select
                value={bonusType} onChange={(e) => setBonusType(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Reason / Note (optional)</label>
              <textarea
                value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
                placeholder="e.g. Q1 over-performance"
              />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-[12.5px] text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              onClick={submit} disabled={saving}
              className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499] disabled:opacity-60"
            >
              {saving ? "Adding…" : "Add bonus"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Step 4 — Reimbursement, Adhoc Payment, Deduction ────────────────────────
// 4-step internal wizard (mirrors Step 3's chrome):
//   1. SALARY COMPONENT CLAIM — Flexi Benefit Plan / declared salary
//      components claimed this month (placeholder; no backend yet)
//   2. EXPENSES               — Cash Advance Requests + expense claims
//      (placeholder; the existing Expense model exists but isn't yet
//      filtered into this UI)
//   3. ADHOC PAYMENTS         — one-off positive payouts not tied to a
//      bonus type (placeholder; we may reuse EmployeeBonus with type
//      "Adhoc" once we wire the inline editor)
//   4. ADHOC DEDUCTIONS       — one-off negative deductions (no model
//      yet; would need a new ImEmployeeDeduction model or signed amounts
//      on EmployeeBonus)
//
// All four steps render the Keka-style scaffolding (info banner +
// search + columns + empty state + pagination) so HR sees the expected
// shape; backend wiring is per-step TODO.

type Step4SubStep = 1 | 2 | 3 | 4 | 5;
const STEP4_SUB_STEPS: { n: Step4SubStep; label: string }[] = [
  { n: 1, label: "SALARY\nCOMPONENT\nCLAIM" },
  { n: 2, label: "EXPENSES" },
  { n: 3, label: "ADHOC\nPAYMENTS" },
  { n: 4, label: "ADHOC\nDEDUCTIONS" },
];
// Advance Salary is an NB-Media-only sub-step (relieving top-up). Appended
// to the wizard only when the run is scoped to NB Media.
const STEP4_ADVANCE_SALARY: { n: Step4SubStep; label: string } = { n: 5, label: "ADVANCE\nSALARY" };

function Step4Panel({ year, month0, monthLabel, brand, onClose, onMarkedComplete }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  onClose: () => void;
  onMarkedComplete?: () => void | Promise<void>;
}) {
  const [current, setCurrent] = useState<Step4SubStep>(1);

  // Advance Salary sub-step only exists for NB Media runs.
  const subSteps = brand === "NB Media" ? [...STEP4_SUB_STEPS, STEP4_ADVANCE_SALARY] : STEP4_SUB_STEPS;
  const maxStep = subSteps.length;

  function goBack()   { setCurrent((c) => (c > 1 ? ((c - 1) as Step4SubStep) : c)); }
  function goNext()   { setCurrent((c) => (c < maxStep ? ((c + 1) as Step4SubStep) : c)); }
  async function complete() { try { await onMarkedComplete?.(); } finally { onClose(); } }

  // Avoid "unused parameter" TS warnings — these are reserved for when
  // the backend wiring lands per-sub-step.
  void year; void month0;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">
            Reimbursement, Adhoc Payment, Deduction: {monthLabel}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </header>

        {/* Wizard indicator + nav buttons */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-slate-100">
          <div className="flex-1 flex items-center justify-center gap-10">
            {subSteps.map((s) => {
              const active = s.n === current;
              return (
                <div key={s.n} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
                      active
                        ? "bg-[#6f42c1] text-white border-2 border-[#6f42c1]"
                        : "bg-white text-slate-500 border-2 border-slate-300"
                    }`}
                  >
                    {s.n}
                  </div>
                  <span
                    className={`text-[11px] font-semibold tracking-wide whitespace-pre-line leading-tight ${
                      active ? "text-[#6f42c1]" : "text-slate-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {current > 1 && (
              <button
                onClick={goBack}
                className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            )}
            {current < maxStep ? (
              <button
                onClick={goNext}
                className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]"
              >
                Save &amp; Continue
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Save &amp; Close
                </button>
                <button
                  onClick={complete}
                  className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]"
                >
                  Mark as Complete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          <div className="flex gap-5 p-5">
            <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5">
              {current === 1 && <SalaryComponentClaimSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 2 && <ExpensesSubStep             year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 3 && (
                <AdhocLineItemsSubStep
                  kind="payment"
                  year={year}
                  month0={month0}
                  monthLabel={monthLabel}
                  brand={brand}
                />
              )}
              {current === 5 && brand === "NB Media" && (
                <AdvanceSalarySubStep
                  year={year}
                  month0={month0}
                  monthLabel={monthLabel}
                  brand={brand}
                />
              )}
              {current === 4 && (
                <AdhocLineItemsSubStep
                  kind="deduction"
                  year={year}
                  month0={month0}
                  monthLabel={monthLabel}
                  brand={brand}
                />
              )}
            </div>
            <aside className="hidden lg:block w-[280px] shrink-0">
              <HelpResourcesStep4 step={current} />
            </aside>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Step 4 sub-steps ──────────────────────────────────────────────────────

function SalaryComponentClaimSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  // Salary-component claims live in the existing Expense table, but
  // distinguish themselves with category != travel/food/etc — for now
  // we expose any Expense row whose category is "component" or whose
  // title contains "FBP". When the dedicated FlexiBenefitClaim model lands
  // this query will switch over.
  type Row = { id: number; userId: number; userName: string; employeeId: string | null; title: string; category: string; amount: string; expenseDate: string; status: string };
  const url = `/api/hr/payroll/expenses?month=${month0}&year=${year}&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: Row[] }>(url, fetcher);
  const items = (data?.items ?? []).filter((r) => r.category === "component" || /fbp|component/i.test(r.title));

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Salary Component Claim</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        FBP / flexible-component claims with expense date in {monthLabel}. Source: Expense rows tagged as components.
      </p>
      <div className="flex items-center justify-end mb-3"><SearchBox /></div>
      <KekaTable columns={["Employee", "Component", "Amount", "Date", "Status"]} rightAlignedColumns={[2]}>
        {items.length === 0 ? (
          <EmptyRow colSpan={5} text={`No component claims for ${monthLabel}.`} />
        ) : (
          items.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{r.title}</td>
              <td className="px-3 py-2 text-[12.5px] text-right tabular-nums font-semibold">{fmtInr(parseFloat(r.amount))}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{new Date(r.expenseDate).toLocaleDateString()}</td>
              <td className="px-3 py-2"><StatusPill status={r.status} /></td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={items.length} />
    </>
  );
}

function ExpensesSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  type Row = { id: number; userId: number; userName: string; employeeId: string | null; title: string; category: string; amount: string; expenseDate: string; status: string };
  const url = `/api/hr/payroll/expenses?month=${month0}&year=${year}&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: Row[] }>(url, fetcher);
  const items = (data?.items ?? []).filter((r) => r.category !== "component" && !/fbp|component/i.test(r.title));

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Expenses</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        Pending and approved expense claims (travel, food, equipment, etc.) with expense date in {monthLabel}.
      </p>
      <div className="flex items-center justify-end mb-3"><SearchBox /></div>
      <KekaTable columns={["Employee", "Title", "Category", "Amount", "Date", "Status"]} rightAlignedColumns={[3]}>
        {items.length === 0 ? (
          <EmptyRow colSpan={6} text={`No expense claims for ${monthLabel}.`} />
        ) : (
          items.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{r.title}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-600 capitalize">{r.category}</td>
              <td className="px-3 py-2 text-[12.5px] text-right tabular-nums font-semibold">{fmtInr(parseFloat(r.amount))}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{new Date(r.expenseDate).toLocaleDateString()}</td>
              <td className="px-3 py-2"><StatusPill status={r.status} /></td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={items.length} />
    </>
  );
}

// Adhoc Payments + Adhoc Deductions share the exact same UI shape
// (table + Add Employee + import-previous + delete-selected); the only
// thing that differs is the `kind` field on the row and the labels.
// One component, one set of behaviors.
type AdhocItem = {
  id: number;
  userId: number;
  type: string | null;
  amount: string;
  comment: string | null;
  name?: string;
  role?: string;
};

function AdhocLineItemsSubStep({ kind, year, month0, monthLabel, brand }: {
  kind: "payment" | "deduction";
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
}) {
  const noun       = kind === "payment" ? "Payment"      : "Deduction";
  const nounLower  = kind === "payment" ? "payment"      : "deduction";
  const importThis = kind === "payment" ? "Import Adhoc Payments" : "Import Adhoc Deductions";

  const url = `/api/hr/payroll/adhoc?month=${month0}&year=${year}&kind=${kind}&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: AdhocItem[] }>(url, fetcher);
  const items = data?.items ?? [];

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = items.filter((it) =>
    !search ||
    (it.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (it.type || "").toLowerCase().includes(search.toLowerCase()),
  );

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((it) => it.id)));
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} adhoc ${nounLower}${selected.size === 1 ? "" : "s"}?`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/hr/payroll/adhoc", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Delete failed");
      setSelected(new Set());
      mutate(url);
    } catch (e: any) {
      setError(e?.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportPrev() {
    const srcMonth = month0 === 0 ? 11 : month0 - 1;
    const srcYear  = month0 === 0 ? year - 1 : year;
    if (!confirm(`Import adhoc ${nounLower}s from ${MONTHS_LONG[srcMonth]}-${srcYear} into ${monthLabel}? Employees who already have a row this month are skipped.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/hr/payroll/adhoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          copyFrom: { month: srcMonth, year: srcYear },
          toMonth: month0,
          toYear: year,
          kind,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Import failed");
      alert(`Imported ${j.inserted ?? 0} row(s) from ${MONTHS_LONG[srcMonth]}-${srcYear}.`);
      mutate(url);
    } catch (e: any) {
      setError(e?.message || "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function handleImportFile() {
    // CSV import — placeholder. When wired, parse the CSV client-side
    // into [{userId, type, amount, comment}] and POST each row (or
    // extend the API with a bulk-rows endpoint).
    alert(`Bulk CSV import for adhoc ${nounLower}s is coming soon. Use "+ Add Employee" or "Import Data From Previous Month" for now.`);
  }

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Adhoc {noun}s</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        {kind === "payment"
          ? "Adhoc payments that are supposed to be paid to the employees in this month, can be managed below."
          : "Adhoc deductions that are supposed to be deducted from the employees salary in this month, can be managed below."}
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAdd(true)}
            disabled={busy}
            className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5 disabled:opacity-50"
          >
            + Add Employee
          </button>
          <span className="text-[11px] text-slate-400 font-semibold">OR</span>
          <button
            onClick={handleImportPrev}
            disabled={busy}
            className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5 disabled:opacity-50"
          >
            Import Data From Previous Month
          </button>
          <span className="text-[11px] text-slate-400 font-semibold">OR</span>
          <button
            onClick={handleImportFile}
            disabled={busy}
            className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5 disabled:opacity-50"
          >
            {importThis}
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={busy || selected.size === 0}
            className={`px-3 py-1.5 rounded-md border text-[12px] font-semibold ${
              selected.size > 0
                ? "border-rose-300 text-rose-600 hover:bg-rose-50"
                : "border-slate-200 text-slate-400 opacity-50 cursor-not-allowed"
            }`}
          >
            Delete{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
        <div className="w-[260px]">
          <div className="relative w-full">
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full h-8 pl-8 pr-3 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:border-[#6f42c1]"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">⌕</span>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  className="rounded border-slate-300"
                />
              </th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Employee</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Adhoc {noun} Type</th>
              <th className="px-4 py-2.5 text-right text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Amount</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Comment</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[12.5px] text-slate-400 py-14">No records found</td>
              </tr>
            ) : (
              filtered.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggleOne(it.id)}
                      className="rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-800">
                    {it.name ?? `User ${it.userId}`}
                    <span className="block text-[10.5px] text-slate-400">{it.role ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{it.type || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtInr(parseFloat(it.amount))}</td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]">{it.comment || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={async () => {
                        if (!confirm("Remove this row?")) return;
                        await fetch(`/api/hr/payroll/adhoc?id=${it.id}`, { method: "DELETE" });
                        mutate(url);
                      }}
                      className="text-[11.5px] text-rose-500 hover:underline"
                    >Remove</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination count={filtered.length} />

      {showAdd && (
        <AddAdhocModal
          kind={kind}
          year={year}
          month0={month0}
          monthLabel={monthLabel}
          brand={brand}
          existingUserIds={new Set(items.map((it) => it.userId))}
          onClose={() => setShowAdd(false)}
          onAdded={() => { mutate(url); setShowAdd(false); }}
        />
      )}
    </>
  );
}

function AddAdhocModal({ kind, year, month0, monthLabel, brand, existingUserIds, onClose, onAdded }: {
  kind: "payment" | "deduction";
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  existingUserIds: Set<number>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const noun = kind === "payment" ? "Payment" : "Deduction";
  const { data: empData } = useSWR<any>(`/api/hr/employees?brand=${encodeURIComponent(brand)}`, fetcher);
  const employees: any[] = Array.isArray(empData) ? empData : (empData as any)?.employees ?? [];

  const [userId, setUserId]   = useState<number | "">("");
  const [type, setType]       = useState<string>(kind === "payment" ? "Other Payment" : "Other Deduction");
  const [amount, setAmount]   = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // A short opinionated dropdown of common types — same pattern as
  // AddBonusModal. HR can still type free-form by picking "Other" and
  // editing the field — but for now keeping it dropdown-only.
  const PAYMENT_TYPES   = ["Performance", "Joining Adhoc", "Referral Adhoc", "Reimbursement", "Travel", "Other Payment"];
  const DEDUCTION_TYPES = ["Salary Advance Recovery", "Loan Recovery", "Penalty", "Notice Period Recovery", "Other Deduction"];
  const TYPES = kind === "payment" ? PAYMENT_TYPES : DEDUCTION_TYPES;

  async function submit() {
    setError(null);
    if (!userId) { setError("Pick an employee"); return; }
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError("Amount must be positive"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/payroll/adhoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: month0, year, kind, userId, type, amount: amt, comment }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Could not add");
      }
      onAdded();
    } catch (e: any) {
      setError(e?.message || "Could not add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 pointer-events-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800">Add Adhoc {noun} — {monthLabel}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Employee</label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              >
                <option value="">Select…</option>
                {employees.map((u: any) => {
                  const already = existingUserIds.has(u.id);
                  return (
                    <option key={u.id} value={u.id} disabled={already}>
                      {u.name} ({u.role}){already ? " — already added this month" : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Type</label>
                <select
                  value={type} onChange={(e) => setType(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
                >
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Amount (INR)</label>
                <input
                  type="number" min={0} step={1}
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white tabular-nums"
                  placeholder="e.g. 2000"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Comment (optional)</label>
              <textarea
                value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
                placeholder={kind === "payment" ? "e.g. Q1 performance kicker" : "e.g. Outstanding salary advance"}
              />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-[12.5px] text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              onClick={submit} disabled={saving}
              className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499] disabled:opacity-60"
            >
              {saving ? "Adding…" : `Add ${noun.toLowerCase()}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Step 4 sub-helpers ────────────────────────────────────────────────────

function SearchBox() {
  return (
    <div className="relative w-[260px]">
      <input
        placeholder="Search"
        className="w-full h-8 pl-8 pr-3 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:border-[#6f42c1]"
      />
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">⌕</span>
    </div>
  );
}

function ImportToolbar({ addLabel, importPrev, importThis }: {
  addLabel: string;
  importPrev: string;
  importThis: string;
}) {
  // The "Delete" button is disabled until rows are selected via the
  // header checkbox. Wire-up pending until inline editing lands.
  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5">
          {addLabel}
        </button>
        <span className="text-[11px] text-slate-400 font-semibold">OR</span>
        <button className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5">
          {importPrev}
        </button>
        <span className="text-[11px] text-slate-400 font-semibold">OR</span>
        <button className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5">
          {importThis}
        </button>
        <button disabled className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-400 text-[12px] font-semibold opacity-50 cursor-not-allowed">
          Delete
        </button>
      </div>
      <div className="w-[260px]">
        <SearchBox />
      </div>
    </div>
  );
}

// ─── Step 4 sub-step 5: Advance Salary (NB Media only) ───────────────────────
// Relieving top-up: HR enters a number of days; the server computes
// days × (CTC / 12 / 30) and books it as an adhoc PAYMENT of type
// "Advance Salary", so the payroll engine adds it to that month's gross
// unchanged. Listed here filtered to that type.
type AdvanceSalaryItem = { id: number; userId: number; type: string | null; amount: string; comment: string | null; name?: string; role?: string; designationLabel?: string | null };

function AdvanceSalarySubStep({ year, month0, monthLabel, brand }: {
  year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs";
}) {
  const url = `/api/hr/payroll/adhoc?month=${month0}&year=${year}&kind=payment&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: AdvanceSalaryItem[] }>(url, fetcher);
  const items = (data?.items ?? []).filter((r) => r.type === "Advance Salary");
  const [showAdd, setShowAdd] = useState(false);

  async function remove(id: number) {
    if (!confirm("Remove this advance salary entry?")) return;
    const res = await fetch(`/api/hr/payroll/adhoc?id=${id}`, { method: "DELETE" });
    if (res.ok) mutate(url);
    else alert((await res.json().catch(() => ({})))?.error || "Delete failed");
  }

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Advance Salary</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        Pay a resigning / relieved employee some extra days&apos; salary for {monthLabel}. Computed at
        (CTC ÷ 12) ÷ 30 per day and added to that month&apos;s gross. It shows on the payslip as an Advance Salary line.
      </p>
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5"
        >
          + Add advance salary
        </button>
      </div>
      <KekaTable columns={["Employee", "Days / Reason", "Amount", "Action"]} rightAlignedColumns={[2]}>
        {items.length === 0 ? (
          <EmptyRow colSpan={4} text={`No advance salary entries for ${monthLabel}.`} />
        ) : (
          items.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] text-slate-800">
                {r.name ?? `User ${r.userId}`}
                <span className="block text-[10.5px] text-slate-400">{r.designationLabel ?? r.role ?? "—"}</span>
              </td>
              <td className="px-3 py-2 text-[12.5px] text-slate-600">{r.comment || "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-right tabular-nums font-semibold">{fmtInr(parseFloat(r.amount))}</td>
              <td className="px-3 py-2"><button onClick={() => remove(r.id)} className="text-[11px] text-rose-500 hover:underline">Remove</button></td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={items.length} />
      {showAdd && (
        <AddAdvanceSalaryModal
          year={year}
          month0={month0}
          monthLabel={monthLabel}
          brand={brand}
          onClose={() => setShowAdd(false)}
          onAdded={() => { mutate(url); setShowAdd(false); }}
        />
      )}
    </>
  );
}

function AddAdvanceSalaryModal({ year, month0, monthLabel, brand, onClose, onAdded }: {
  year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs";
  onClose: () => void; onAdded: () => void;
}) {
  const { data: empData } = useSWR<any>(`/api/hr/employees?brand=${encodeURIComponent(brand)}`, fetcher);
  const employees: any[] = Array.isArray(empData) ? empData : (empData as any)?.employees ?? [];

  const [userId, setUserId] = useState<number | "">("");
  // Month the advance is FOR — defaults to the month AFTER the run month
  // (you settle June, advance July). The per-day divisor = days in THIS
  // month, so a full month's days = exactly one month's salary.
  const defY = month0 === 11 ? year + 1 : year;
  const defM = month0 === 11 ? 0 : month0 + 1;
  const [forYm, setForYm] = useState<string>(`${defY}-${String(defM + 1).padStart(2, "0")}`);
  const ty = Number(forYm.split("-")[0]) || year;
  const tm = (Number(forYm.split("-")[1]) || 1) - 1;
  const daysInTarget = daysInMonth(ty, tm + 1);
  const forMonthLabel = new Date(Date.UTC(ty, tm, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  // Default the days to a FULL month of the target so the common
  // "advance one whole month" case is a single click.
  const [days, setDays]     = useState<string>(String(daysInMonth(defY, defM + 1)));
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Live preview — pull the selected employee's CTC so HR sees the amount
  // before saving. The server recomputes authoritatively on submit.
  const { data: ss } = useSWR<any>(userId ? `/api/hr/payroll/salary-structure?userId=${userId}` : null, fetcher);
  const ctc    = ss?.ctc ? parseFloat(String(ss.ctc)) : 0;
  const perDay = ctc > 0 ? (ctc / 12) / daysInTarget : 0;
  const daysNum = parseFloat(days);
  const hasDays = Number.isFinite(daysNum) && daysNum > 0;
  const preview = perDay > 0 && hasDays ? Math.round(perDay * daysNum) : 0;

  async function submit() {
    setError(null);
    if (!userId) { setError("Pick an employee"); return; }
    if (!hasDays) { setError("Enter a positive number of days"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/payroll/adhoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, month: month0, year, kind: "payment", days: daysNum, forMonth: tm, forYear: ty, comment: reason }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Could not add");
      }
      onAdded();
    } catch (e: any) {
      setError(e?.message || "Could not add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 pointer-events-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800">Advance Salary — {monthLabel}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
          </div>
          {error && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Employee</label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              >
                <option value="">Select…</option>
                {employees.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.designation?.label ?? u.role})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Advance for month</label>
              <input
                type="month" value={forYm}
                onChange={(e) => setForYm(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Days</label>
              <input
                type="number" min="0" step="0.5" value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="e.g. 5"
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              />
              <p className="mt-1 text-[11px] text-slate-400">Full {forMonthLabel} = {daysInTarget} days.</p>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Reason</label>
              <input
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Relieving adjustment"
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              />
            </div>
            {/* Live amount preview */}
            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-600">
              {userId && perDay > 0 ? (
                <>Per day (CTC/12 ÷ {daysInTarget}): <span className="font-semibold text-slate-800">{fmtInr(Math.round(perDay))}</span>
                  {hasDays && <> · Amount: <span className="font-semibold text-slate-800">{fmtInr(preview)}</span></>}
                </>
              ) : userId ? (
                <span className="text-rose-500">No CTC set for this employee — cannot compute.</span>
              ) : (
                <span className="text-slate-400">Select an employee to see the per-day rate.</span>
              )}
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              onClick={submit}
              disabled={saving || !userId || !hasDays || perDay <= 0}
              className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Add advance salary"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function HelpResourcesStep4({ step }: { step: Step4SubStep }) {
  const sets: Record<Step4SubStep, { question: string }[]> = {
    1: [
      { question: "How do salary component claims get reimbursed?" },
      { question: "Can I approve a claim during payroll?" },
    ],
    2: [
      { question: "How are cash advance requests paid out?" },
      { question: "Why am I not seeing an approved expense?" },
    ],
    3: [
      { question: "How can I import adhoc payments from a CSV?" },
      { question: "Adhoc payment vs bonus — which should I use?" },
    ],
    4: [
      { question: "How can I import adhoc deductions from a CSV?" },
      { question: "Can a deduction reduce net pay below zero?" },
    ],
    5: [
      { question: "How is Advance Salary calculated?" },
      { question: "Does Advance Salary attract PF / ESI / TDS?" },
    ],
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h5 className="text-[13px] font-semibold text-slate-800 mb-3 flex items-center justify-between">
        Need help?
        <span className="text-slate-400 text-[14px]">▾</span>
      </h5>
      <p className="text-[11.5px] text-slate-500 mb-3">If you have questions talk to us, we're here for you.</p>
      <ul className="space-y-2.5">
        {(sets[step] ?? []).map((q) => (
          <li key={q.question} className="flex items-start gap-2">
            <a href="#" className="text-[12px] text-slate-700 hover:text-[#6f42c1] hover:underline flex-1">{q.question}</a>
            <span className="text-slate-400">↗</span>
          </li>
        ))}
      </ul>
      <a href="#" className="mt-3 inline-block text-[12px] font-semibold text-[#6f42c1] hover:underline">Talk to us →</a>
    </div>
  );
}

// ─── Step 5 — Salaries on Hold & Arrears ────────────────────────────────────
// 3-step internal wizard:
//   1. SALARY PROCESSING ON HOLD — entire payroll skipped for these employees
//   2. SALARY PAYOUT ON HOLD     — payslip computed but money not released
//   3. ARREARS                   — auto-computed (read-only; source pending)

type Step5SubStep = 1 | 2 | 3;
const STEP5_SUB_STEPS: { n: Step5SubStep; label: string }[] = [
  { n: 1, label: "SALARY\nPROCESSING\nON HOLD" },
  { n: 2, label: "SALARY\nPAYOUT ON\nHOLD" },
  { n: 3, label: "ARREARS" },
];

function Step5Panel({ year, month0, monthLabel, brand, onClose, onMarkedComplete }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  onClose: () => void;
  onMarkedComplete?: () => void | Promise<void>;
}) {
  const [current, setCurrent] = useState<Step5SubStep>(1);

  function goBack()   { setCurrent((c) => (c > 1 ? ((c - 1) as Step5SubStep) : c)); }
  function goNext()   { setCurrent((c) => (c < 3 ? ((c + 1) as Step5SubStep) : c)); }
  async function complete() { try { await onMarkedComplete?.(); } finally { onClose(); } }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">
            Salary on Hold &amp; Arrears: {monthLabel}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </header>

        <div className="flex items-center justify-between px-8 py-4 border-b border-slate-100">
          <div className="flex-1 flex items-center justify-center gap-10">
            {STEP5_SUB_STEPS.map((s) => {
              const active = s.n === current;
              return (
                <div key={s.n} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
                      active
                        ? "bg-[#6f42c1] text-white border-2 border-[#6f42c1]"
                        : "bg-white text-slate-500 border-2 border-slate-300"
                    }`}
                  >
                    {s.n}
                  </div>
                  <span
                    className={`text-[11px] font-semibold tracking-wide whitespace-pre-line leading-tight ${
                      active ? "text-[#6f42c1]" : "text-slate-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {current > 1 && (
              <button onClick={goBack} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Back</button>
            )}
            {current < 3 ? (
              <button onClick={goNext} className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]">Save &amp; Continue</button>
            ) : (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Save &amp; Close</button>
                <button onClick={complete} className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]">Mark as Complete</button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50">
          <div className="flex gap-5 p-5">
            <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5">
              {current === 1 && <SalaryHoldSubStep kind="processing" year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 2 && <SalaryHoldSubStep kind="payout"     year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 3 && <ArrearsSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
            </div>
            <aside className="hidden lg:block w-[280px] shrink-0">
              <HelpResourcesStep5 step={current} />
            </aside>
          </div>
        </div>
      </aside>
    </>
  );
}

// Salary Processing on Hold + Salary Payout on Hold share this component;
// `kind` is the only behavioural switch (plus column count: processing
// adds an "Amount" column that payout doesn't have).

type SalaryHoldItem = {
  id: number;
  userId: number;
  kind: string;
  payAction: string | null;
  comment: string | null;
  name?: string;
  role?: string;
};

function SalaryHoldSubStep({ kind, year, month0, monthLabel, brand }: {
  kind: "processing" | "payout";
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
}) {
  const titleNoun    = kind === "processing" ? "Salary Processing on hold" : "Salary payout on hold";
  const importLabel  = kind === "processing" ? "Import Processing on Holds" : "Import Payout on Holds";
  const showAmount   = kind === "processing";

  const url = `/api/hr/payroll/salary-hold?month=${month0}&year=${year}&kind=${kind}&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: SalaryHoldItem[] }>(url, fetcher);
  const items = data?.items ?? [];

  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = items.filter((it) =>
    !search || (it.name || "").toLowerCase().includes(search.toLowerCase()),
  );

  async function handleRemove(id: number) {
    if (!confirm("Release this hold?")) return;
    await fetch(`/api/hr/payroll/salary-hold?id=${id}`, { method: "DELETE" });
    mutate(url);
  }

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">{titleNoun}</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        {kind === "processing"
          ? `In case of employees who are absconding or are on uninformed leave, you might want to hold/stop the processing of their salary. Use the "Salary processing on hold" option to stop/hold the processing of salary for selected employees. They will also be excluded from statutory contribution/deduction calculation and will only be considered if you decide to process their salary in the future.`
          : `In case you wish to process the salary but hold the payout of employees (in cases such as, employee is under notice period, on uninformed leave for a while, etc) use "Salary payout on hold" option. The salary of such employees will be processed, i.e. they will be included for statutory contribution/deduction calculation and only the payout of salary will be put on hold. You can decide to payout this salary anytime in future.`}
      </p>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5">
          + Add Employee
        </button>
        <button
          onClick={() => alert(`CSV ${importLabel.toLowerCase()} import is coming soon.`)}
          className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5"
        >
          {importLabel}
        </button>
        <div className="ml-auto relative w-[260px]">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full h-8 pl-8 pr-3 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:border-[#6f42c1]"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">⌕</span>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Employee</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Pay Period</th>
              {showAmount && (
                <th className="px-4 py-2.5 text-right text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Amount</th>
              )}
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Pay Action</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Comment</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={showAmount ? 6 : 5} className="text-center text-[12.5px] text-slate-400 py-14">No records found</td>
              </tr>
            ) : (
              filtered.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-800">
                    {it.name ?? `User ${it.userId}`}
                    <span className="block text-[10.5px] text-slate-400">{it.role ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{monthLabel}</td>
                  {showAmount && (
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">—</td>
                  )}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-50 text-amber-700">
                      {it.payAction || "Hold"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]">{it.comment || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleRemove(it.id)} className="text-[11.5px] text-rose-500 hover:underline">Release</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination count={filtered.length} />

      {showAdd && (
        <AddSalaryHoldModal
          kind={kind}
          year={year}
          month0={month0}
          monthLabel={monthLabel}
          brand={brand}
          existingUserIds={new Set(items.map((it) => it.userId))}
          onClose={() => setShowAdd(false)}
          onAdded={() => { mutate(url); setShowAdd(false); }}
        />
      )}
    </>
  );
}

function AddSalaryHoldModal({ kind, year, month0, monthLabel, brand, existingUserIds, onClose, onAdded }: {
  kind: "processing" | "payout";
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  existingUserIds: Set<number>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const noun = kind === "processing" ? "Salary Processing on Hold" : "Salary Payout on Hold";
  const { data: empData } = useSWR<any>(`/api/hr/employees?brand=${encodeURIComponent(brand)}`, fetcher);
  const employees: any[] = Array.isArray(empData) ? empData : (empData as any)?.employees ?? [];

  const [userId, setUserId]       = useState<number | "">("");
  const [payAction, setPayAction] = useState<string>("Hold");
  const [comment, setComment]     = useState<string>("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!userId) { setError("Pick an employee"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/payroll/salary-hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: month0, year, kind, userId, payAction, comment }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Could not add");
      }
      onAdded();
    } catch (e: any) {
      setError(e?.message || "Could not add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 pointer-events-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800">{noun} — {monthLabel}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
          </div>
          {error && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Employee</label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              >
                <option value="">Select…</option>
                {employees.map((u: any) => {
                  const already = existingUserIds.has(u.id);
                  return (
                    <option key={u.id} value={u.id} disabled={already}>
                      {u.name} ({u.role}){already ? " — already on hold" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Pay Action</label>
              <select
                value={payAction} onChange={(e) => setPayAction(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              >
                <option value="Hold">Hold</option>
                <option value="Skip">Skip this month</option>
                <option value="Defer">Defer to next cycle</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Comment (optional)</label>
              <textarea
                value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
                placeholder={kind === "processing" ? "e.g. Absconding since Apr 25" : "e.g. Under notice period — release after clearance"}
              />
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-[12.5px] text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              onClick={submit} disabled={saving}
              className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499] disabled:opacity-60"
            >
              {saving ? "Saving…" : "Add to hold list"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ArrearsSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  return <TypedAdhocSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand}
    type="arrears"
    title="Arrears"
    blurb={`Past-dated dues being paid in ${monthLabel}. Engine adds these to gross pay. Source: AdhocLineItem with type=arrears.`} />;
}

// ─── Step 6 — Override (PT, ESI, TDS, LWF) ──────────────────────────────────
// 4-step internal wizard. One TaxOverride row per (user, month, year, kind):
//   1. PT  — Professional Tax (employee-side only; single Override Amount)
//   2. ESI — Employee State Insurance (both employee + employer overrides)
//   3. TDS — Income Tax Deducted at Source (employee-side only)
//   4. LWF — Labour Welfare Fund (both employee + employer overrides)

type Step6SubStep = 1 | 2 | 3 | 4;
type TaxKind = "PT" | "ESI" | "TDS" | "LWF";
const STEP6_SUB_STEPS: { n: Step6SubStep; label: string; kind: TaxKind }[] = [
  { n: 1, label: "PT OVERRIDE",  kind: "PT"  },
  { n: 2, label: "ESI OVERRIDE", kind: "ESI" },
  { n: 3, label: "TDS OVERRIDE", kind: "TDS" },
  { n: 4, label: "LWF OVERRIDE", kind: "LWF" },
];

function Step6Panel({ year, month0, monthLabel, brand, onClose, onMarkedComplete }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  onClose: () => void;
  onMarkedComplete?: () => void | Promise<void>;
}) {
  const [current, setCurrent] = useState<Step6SubStep>(1);

  function goBack()   { setCurrent((c) => (c > 1 ? ((c - 1) as Step6SubStep) : c)); }
  function goNext()   { setCurrent((c) => (c < 4 ? ((c + 1) as Step6SubStep) : c)); }
  async function complete() { try { await onMarkedComplete?.(); } finally { onClose(); } }

  const activeKind = STEP6_SUB_STEPS.find((s) => s.n === current)!.kind;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">
            Override (PT, ESI, TDS, LWF): {monthLabel}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </header>

        <div className="flex items-center justify-between px-8 py-4 border-b border-slate-100">
          <div className="flex-1 flex items-center justify-center gap-10">
            {STEP6_SUB_STEPS.map((s) => {
              const active = s.n === current;
              return (
                <div key={s.n} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
                      active
                        ? "bg-[#6f42c1] text-white border-2 border-[#6f42c1]"
                        : "bg-white text-slate-500 border-2 border-slate-300"
                    }`}
                  >
                    {s.n}
                  </div>
                  <span
                    className={`text-[11px] font-semibold tracking-wide leading-tight ${
                      active ? "text-[#6f42c1]" : "text-slate-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {current > 1 && (
              <button onClick={goBack} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Back</button>
            )}
            {current < 4 ? (
              <button onClick={goNext} className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]">Save &amp; Continue</button>
            ) : (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Save &amp; Close</button>
                <button onClick={complete} className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]">Mark as Complete</button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50">
          <div className="flex gap-5 p-5">
            <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5">
              <TaxOverrideSubStep
                kind={activeKind}
                year={year}
                month0={month0}
                monthLabel={monthLabel}
                brand={brand}
              />
            </div>
            <aside className="hidden lg:block w-[280px] shrink-0">
              <HelpResourcesStep6 kind={activeKind} />
            </aside>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Shared sub-step for all 4 kinds ────────────────────────────────────────
// PT & TDS have one override column; ESI & LWF have employee + employer.

type TaxOverrideItem = {
  id: number;
  userId: number;
  kind: string;
  employeeOverride: string | null;
  employerOverride: string | null;
  comment: string | null;
  name?: string;
  employeeId?: string | null;
};

function TaxOverrideSubStep({ kind, year, month0, monthLabel, brand }: {
  kind: TaxKind;
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
}) {
  const url = `/api/hr/payroll/tax-override?month=${month0}&year=${year}&kind=${kind}&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: TaxOverrideItem[] }>(url, fetcher);
  const items = data?.items ?? [];
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = items.filter((it) =>
    !search ||
    (it.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (it.employeeId || "").toLowerCase().includes(search.toLowerCase()),
  );

  const dualOverride = kind === "ESI" || kind === "LWF";

  const blurbs: Record<TaxKind, string> = {
    PT:  "All Professional Tax overrides that were added for this month will be shown here. New overrides can be added as well from here",
    ESI: "All ESI overrides that were added for this month will be shown here. New overrides can be added as well from here",
    TDS: "The TDS overrides that were added for this month will be shown here. New overrides can be added as well from here",
    LWF: "All LWF overrides that were added for this month will be shown here. New overrides can be added as well from here",
  };

  const titles: Record<TaxKind, string> = {
    PT: "PT Overrides", ESI: "ESI Overrides", TDS: "TDS Overrides", LWF: "LWF Overrides",
  };

  // Columns vary per kind — kept inline so each kind's exact header
  // labels match the Keka screenshots.
  function renderHeader() {
    if (kind === "PT") {
      return ["Employee Number", "Employee Name", "Gross Salary", "Regular PT", "PT Override Amount", "Override Month", "Comment", "Action"];
    }
    if (kind === "TDS") {
      return ["Employee Number", "Employee Name", "Gross Salary", "Regular TDS", "TDS Override Amount", "Override Month", "Comment", "Action"];
    }
    if (kind === "ESI") {
      return ["Employee Number", "Employee Name", "Remuneration", "Employee (Regular)", "Employee (Override)", "Employer (Regular)", "Employer (Override)", "Override Month", "Comment", "Action"];
    }
    return ["Employee Number", "Employee Name", "Gross Salary", "LWF Employee (Regular)", "Employee (Overridden)", "LWF Employer (Regular)", "Employer (Overridden)", "Override Month", "Comment", "Action"];
  }
  const cols = renderHeader();

  async function handleRemove(id: number) {
    if (!confirm("Remove this override?")) return;
    await fetch(`/api/hr/payroll/tax-override?id=${id}`, { method: "DELETE" });
    mutate(url);
  }

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">{titles[kind]}</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        {blurbs[kind]}
      </p>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[12px] font-semibold hover:bg-[#6f42c1]/5"
        >
          + Add Employee
        </button>
        <div className="ml-auto relative w-[260px]">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full h-8 pl-8 pr-3 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:border-[#6f42c1]"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">⌕</span>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {cols.map((c) => (
                <th key={c} className="px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="text-center text-[12.5px] text-slate-400 py-14">No records found</td>
              </tr>
            ) : (
              filtered.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-3 text-slate-600 tabular-nums">{it.employeeId || "—"}</td>
                  <td className="px-3 py-3 text-slate-800">{it.name ?? `User ${it.userId}`}</td>
                  {/* Gross / Remuneration — we don't have the per-employee
                       gross handy from this query yet. Placeholder for now;
                       could join SalaryStructure or fetch a Payslip per row
                       once perf becomes a concern. */}
                  <td className="px-3 py-3 text-slate-500">—</td>
                  {/* Regular (computed) value — also a TODO once the engine
                       exposes per-employee statutory amounts. */}
                  <td className="px-3 py-3 text-slate-500">—</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">
                    {it.employeeOverride ? fmtInr(parseFloat(it.employeeOverride)) : "—"}
                  </td>
                  {dualOverride && (
                    <>
                      <td className="px-3 py-3 text-slate-500">—</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">
                        {it.employerOverride ? fmtInr(parseFloat(it.employerOverride)) : "—"}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-3 text-slate-600">{monthLabel}</td>
                  <td className="px-3 py-3 text-slate-500 text-[11.5px]">{it.comment || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3">
                    <button onClick={() => handleRemove(it.id)} className="text-[11.5px] text-rose-500 hover:underline">Remove</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination count={filtered.length} />

      {showAdd && (
        <AddTaxOverrideModal
          kind={kind}
          year={year}
          month0={month0}
          monthLabel={monthLabel}
          brand={brand}
          existingUserIds={new Set(items.map((it) => it.userId))}
          onClose={() => setShowAdd(false)}
          onAdded={() => { mutate(url); setShowAdd(false); }}
        />
      )}
    </>
  );
}

function AddTaxOverrideModal({ kind, year, month0, monthLabel, brand, existingUserIds, onClose, onAdded }: {
  kind: TaxKind;
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  existingUserIds: Set<number>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const dual = kind === "ESI" || kind === "LWF";
  const { data: empData } = useSWR<any>(`/api/hr/employees?brand=${encodeURIComponent(brand)}`, fetcher);
  const employees: any[] = Array.isArray(empData) ? empData : (empData as any)?.employees ?? [];

  const [userId, setUserId]     = useState<number | "">("");
  const [empOver, setEmpOver]   = useState<string>("");
  const [erOver,  setErOver]    = useState<string>("");
  const [comment, setComment]   = useState<string>("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!userId) { setError("Pick an employee"); return; }
    const employeeOverride = empOver === "" ? null : Number(empOver);
    const employerOverride = dual && erOver !== "" ? Number(erOver) : null;
    if (employeeOverride === null && employerOverride === null) {
      setError("Enter at least one override amount");
      return;
    }
    if (employeeOverride !== null && (!Number.isFinite(employeeOverride) || employeeOverride < 0)) {
      setError("Employee override must be ≥ 0"); return;
    }
    if (employerOverride !== null && (!Number.isFinite(employerOverride) || employerOverride < 0)) {
      setError("Employer override must be ≥ 0"); return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/payroll/tax-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: month0, year, kind, userId, employeeOverride, employerOverride, comment }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Could not add");
      }
      onAdded();
    } catch (e: any) {
      setError(e?.message || "Could not add");
    } finally {
      setSaving(false);
    }
  }

  const empLabel = dual ? "Employee Override (INR)" : `${kind} Override Amount (INR)`;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 pointer-events-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800">{kind} Override — {monthLabel}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
          </div>
          {error && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Employee</label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
              >
                <option value="">Select…</option>
                {employees.map((u: any) => {
                  const already = existingUserIds.has(u.id);
                  return (
                    <option key={u.id} value={u.id} disabled={already}>
                      {u.name} ({u.role}){already ? ` — already has a ${kind} override this month` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className={dual ? "grid grid-cols-2 gap-3" : ""}>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{empLabel}</label>
                <input
                  type="number" min={0} step={1}
                  value={empOver} onChange={(e) => setEmpOver(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white tabular-nums"
                  placeholder="e.g. 200"
                />
              </div>
              {dual && (
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Employer Override (INR)</label>
                  <input
                    type="number" min={0} step={1}
                    value={erOver} onChange={(e) => setErOver(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white tabular-nums"
                    placeholder="e.g. 750"
                  />
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Comment (optional)</label>
              <textarea
                value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-slate-200 bg-white"
                placeholder={`e.g. ${kind} state-specific override per HR review`}
              />
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-200 text-[12.5px] text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              onClick={submit} disabled={saving}
              className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499] disabled:opacity-60"
            >
              {saving ? "Saving…" : `Save ${kind} override`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function HelpResourcesStep6({ kind }: { kind: TaxKind }) {
  const sets: Record<TaxKind, { question: string }[]> = {
    PT: [
      { question: "How are PT slabs determined for an employee?" },
      { question: "What happens when I override PT for an employee?" },
    ],
    ESI: [
      { question: "How is ESI computed for an employee?" },
      { question: "When should employer-side ESI be overridden?" },
    ],
    TDS: [
      { question: "Why is TDS shown as zero for some employees?" },
      { question: "Can I roll back a TDS override?" },
    ],
    LWF: [
      { question: "Which states require LWF for our employees?" },
      { question: "What does overriding LWF employee/employer do downstream?" },
    ],
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h5 className="text-[13px] font-semibold text-slate-800 mb-2">Need help?</h5>
      <p className="text-[11.5px] text-slate-500 mb-3">If you have questions talk to us, we're here for you.</p>
      <ul className="space-y-2.5">
        {sets[kind].map((q) => (
          <li key={q.question} className="flex items-start gap-2">
            <a href="#" className="text-[12px] text-slate-700 hover:text-[#6f42c1] hover:underline flex-1">{q.question}</a>
            <span className="text-slate-400">↗</span>
          </li>
        ))}
      </ul>
      <a href="#" className="mt-3 inline-block text-[12px] font-semibold text-[#6f42c1] hover:underline">Talk to us →</a>
    </div>
  );
}

// ─── Step 1 — Leave, Attendance & Payable Units ─────────────────────────────
// 4-sub-step wizard:
//   1. LEAVE APPLIED  — wired: lists every LeaveApplication overlapping
//                       the month + per-row approve / reject + bulk
//   2. NO ATTENDANCE  — placeholder (compute pending)
//   3. LOP SUMMARY    — placeholder (compute pending — would aggregate
//                       absent + half-day weekdays minus paid leaves)
//   4. LOP REVERSAL   — placeholder (no model yet)

type Step1SubStep = 1 | 2 | 3 | 4;
const STEP1_SUB_STEPS: { n: Step1SubStep; label: string }[] = [
  { n: 1, label: "LEAVE\nAPPLIED" },
  { n: 2, label: "NO\nATTENDANCE" },
  { n: 3, label: "LOP\nSUMMARY" },
  { n: 4, label: "LOP\nREVERSAL" },
];

function Step1Panel({ year, month0, monthLabel, brand, onClose, onMarkedComplete }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  onClose: () => void;
  onMarkedComplete?: () => void | Promise<void>;
}) {
  const [current, setCurrent] = useState<Step1SubStep>(1);
  function goBack()   { setCurrent((c) => (c > 1 ? ((c - 1) as Step1SubStep) : c)); }
  function goNext()   { setCurrent((c) => (c < 4 ? ((c + 1) as Step1SubStep) : c)); }
  async function complete() { try { await onMarkedComplete?.(); } finally { onClose(); } }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">
            Leave, Attendance &amp; Payable Units: {monthLabel}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </header>

        <div className="flex items-center justify-between px-8 py-4 border-b border-slate-100">
          <div className="flex-1 flex items-center justify-center gap-10">
            {STEP1_SUB_STEPS.map((s) => {
              const active = s.n === current;
              return (
                <div key={s.n} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
                      active
                        ? "bg-[#6f42c1] text-white border-2 border-[#6f42c1]"
                        : "bg-white text-slate-500 border-2 border-slate-300"
                    }`}
                  >
                    {s.n}
                  </div>
                  <span
                    className={`text-[11px] font-semibold tracking-wide whitespace-pre-line leading-tight ${
                      active ? "text-[#6f42c1]" : "text-slate-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {current > 1 && (
              <button onClick={goBack} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Back</button>
            )}
            {current < 4 ? (
              <button onClick={goNext} className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]">Save &amp; Continue</button>
            ) : (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Save &amp; Close</button>
                <button onClick={complete} className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]">Mark as Complete</button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50">
          <div className="flex gap-5 p-5">
            <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5">
              {current === 1 && <LeaveAppliedSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 2 && <NoAttendanceSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 3 && <LopSummarySubStep    year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 4 && <LopReversalSubStep   year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
            </div>
            <aside className="hidden lg:block w-[280px] shrink-0">
              <HelpResourcesStep1 step={current} />
            </aside>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Step 1 sub-step 1: Leave Applied (wired) ───────────────────────────────

type CycleLeave = {
  id: number;
  userId: number;
  userName?: string;
  userRole?: string;
  leaveTypeName?: string;
  fromDate: string;
  toDate: string;
  totalDays: string;
  status: string;
  reason: string | null;
  approverName?: string | null;
};

function LeaveAppliedSubStep({ year, month0, monthLabel, brand }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
}) {
  const url = `/api/hr/payroll/cycle-leaves?month=${month0}&year=${year}&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: CycleLeave[] }>(url, fetcher);
  const items = data?.items ?? [];

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = items.filter((it) =>
    !search ||
    (it.userName ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (it.leaveTypeName ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((it) => it.id)));
  }
  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Hit the existing /api/hr/leaves/[id] for each selected — sequential
  // not concurrent so the audit-log entries are ordered.
  async function bulkAction(action: "approve" | "reject") {
    if (selected.size === 0) return;
    if (!confirm(`${action === "approve" ? "Approve" : "Reject"} ${selected.size} leave application(s)?`)) return;
    setBusy(true); setError(null);
    try {
      const ids = Array.from(selected);
      let okCount = 0;
      for (const id of ids) {
        const r = await fetch(`/api/hr/leaves/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (r.ok) okCount++;
      }
      setSelected(new Set());
      mutate(url);
      if (okCount < ids.length) {
        setError(`${okCount}/${ids.length} processed — others may need direct manager approval.`);
      }
    } catch (e: any) {
      setError(e?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function singleAction(id: number, action: "approve" | "reject") {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/hr/leaves/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Action failed");
      mutate(url);
    } catch (e: any) {
      setError(e?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function fmtDateLabel(iso: string, totalDays: string, reason: string | null): string {
    const d = new Date(iso);
    const base = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const half = /\[(First Half|Second Half|Half Day)\]/i.exec(reason ?? "");
    return half ? `${base} (${half[1]}) — ${totalDays} days` : `${base} — ${totalDays} days`;
  }

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Leave Applied</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        All leave (approved or pending) that falls under this payroll cycle month will be displayed here.
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => bulkAction("approve")}
          disabled={busy || selected.size === 0}
          className={`px-3 py-1.5 rounded-md text-[12px] font-semibold ${
            selected.size > 0
              ? "bg-[#6f42c1] text-white hover:bg-[#5a3499]"
              : "bg-slate-100 text-slate-400 cursor-not-allowed"
          }`}
        >
          Approve{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
        <button
          onClick={() => bulkAction("reject")}
          disabled={busy || selected.size === 0}
          className={`px-3 py-1.5 rounded-md text-[12px] font-semibold ${
            selected.size > 0
              ? "bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200"
              : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
          }`}
        >
          Reject
        </button>
        <div className="ml-auto relative w-[260px]">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full h-8 pl-8 pr-3 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:border-[#6f42c1]"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">⌕</span>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  className="rounded border-slate-300"
                />
              </th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Employee</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Date</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Total Days</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">LeaveType</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Approver</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-[12.5px] text-slate-400 py-14">No leave applications for {monthLabel}.</td>
              </tr>
            ) : (
              filtered.map((it) => {
                const isFinal = it.status === "approved" || it.status === "rejected";
                return (
                  <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggleOne(it.id)}
                        disabled={isFinal}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      <span className="text-[#6f42c1] font-semibold">{it.userName ?? `User ${it.userId}`}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {fmtDateLabel(it.fromDate, it.totalDays, it.reason)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">{it.totalDays}</td>
                    <td className="px-4 py-3 text-slate-600">{it.leaveTypeName || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={it.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{it.approverName ?? "—"}</td>
                    <td className="px-4 py-3">
                      {!isFinal ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => singleAction(it.id, "approve")}
                            disabled={busy}
                            title="Approve"
                            className="w-7 h-7 rounded-full border border-emerald-300 text-emerald-600 hover:bg-emerald-50 flex items-center justify-center"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => singleAction(it.id, "reject")}
                            disabled={busy}
                            title="Reject"
                            className="w-7 h-7 rounded-full border border-rose-300 text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pagination count={filtered.length} />
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"           ? "bg-emerald-50 text-emerald-700" :
    status === "partially_approved" ? "bg-sky-50 text-sky-700"        :
    status === "pending"            ? "bg-amber-50 text-amber-700"    :
    status === "rejected"           ? "bg-rose-50 text-rose-700"      :
                                      "bg-slate-100 text-slate-600";
  const label =
    status === "partially_approved" ? "Partially Approved" :
    status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

// ─── Step 1 sub-step 2: No Attendance ───────────────────────────────────────

function NoAttendanceSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  const url = `/api/hr/payroll/attendance-summary?month=${month0}&year=${year}&kind=no_attendance&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: { userId: number; userName: string; employeeId: string | null }[] }>(url, fetcher);
  const items = data?.items ?? [];
  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">No Attendance</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        Employees with no attendance records this month. They were never clocked in and have no approved leave covering {monthLabel}.
      </p>
      <div className="flex items-center justify-end mb-3"><SearchBox /></div>
      <KekaTable columns={["Employee Number", "Employee Name"]}>
        {items.length === 0 ? (
          <EmptyRow colSpan={2} text={`No 'no-attendance' employees for ${monthLabel}.`} />
        ) : (
          items.map((r) => (
            <tr key={r.userId} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] font-mono text-slate-700">{r.employeeId ?? "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName}</td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={items.length} />
    </>
  );
}

// ─── Step 1 sub-step 3: LOP Summary ─────────────────────────────────────────

function LopSummarySubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  const url = `/api/hr/payroll/attendance-summary?month=${month0}&year=${year}&kind=lop&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: { userId: number; userName: string; employeeId: string | null; absentDays: string; halfDays: string; lwpDays?: string; lopDays: string }[] }>(url, fetcher);
  const items = data?.items ?? [];
  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Loss of Pay</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        Per-employee LOP for {monthLabel}: absent + auto-LOP days + 0.5 × half-days + unpaid-leave (LWP) days. The engine subtracts these from paid days when computing the payslip.
      </p>
      <div className="flex items-center justify-end mb-3"><SearchBox /></div>
      <KekaTable columns={["Employee Number", "Employee Name", "Absent", "Half-Days", "LWP", "Final LOP"]}>
        {items.length === 0 ? (
          <EmptyRow colSpan={6} text={`No LOP entries for ${monthLabel}.`} />
        ) : (
          items.map((r) => (
            <tr key={r.userId} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] font-mono text-slate-700">{r.employeeId ?? "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName}</td>
              <td className="px-3 py-2 text-[12.5px] text-rose-600 font-semibold">{r.absentDays}</td>
              <td className="px-3 py-2 text-[12.5px] text-amber-600 font-semibold">{r.halfDays}</td>
              <td className="px-3 py-2 text-[12.5px] text-orange-600 font-semibold">{r.lwpDays ?? "0"}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-800 font-semibold">{r.lopDays}</td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={items.length} />
    </>
  );
}

// ─── Step 1 sub-step 4: LOP Reversal ────────────────────────────────────────

function LopReversalSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  const url = `/api/hr/payroll/attendance-summary?month=${month0}&year=${year}&kind=lop_reversal&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: { id: number; userId: number; userName: string; employeeId: string | null; leaveType: string; fromDate: string; toDate: string; totalDays: string }[] }>(url, fetcher);
  const items = data?.items ?? [];
  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Loss of Pay Reversal</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        Approved paid-leave applications that overlap {monthLabel}. These reverse any LOP that would otherwise be stamped for the same day.
      </p>
      <div className="flex items-center justify-end mb-3"><SearchBox /></div>
      <KekaTable columns={["Employee Number", "Employee Name", "Leave Type", "From", "To", "Days"]}>
        {items.length === 0 ? (
          <EmptyRow colSpan={6} text={`No reversals for ${monthLabel}.`} />
        ) : (
          items.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] font-mono text-slate-700">{r.employeeId ?? "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{r.leaveType}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{new Date(r.fromDate).toLocaleDateString()}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{new Date(r.toDate).toLocaleDateString()}</td>
              <td className="px-3 py-2 text-[12.5px] text-emerald-700 font-semibold">{r.totalDays}</td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={items.length} />
    </>
  );
}

// ─── Step 2 — New Joinees & Exits ───────────────────────────────────────────
// 3-sub-step wizard:
//   1. NEW JOINEES           — wired: employees with DOJ in this month,
//                              with editable Pay Action per row
//   2. EMPLOYEE IN EXIT PROCESS — placeholder (split into "in exit" + "pending exit")
//   3. FULL & FINAL SETTLEMENT  — placeholder (F&F backend pending)

type Step2SubStep = 1 | 2 | 3;
const STEP2_SUB_STEPS: { n: Step2SubStep; label: string }[] = [
  { n: 1, label: "NEW JOINEES" },
  { n: 2, label: "EMPLOYEE IN\nEXIT PROCESS" },
  { n: 3, label: "FULL & FINAL\nSETTLEMENT" },
];

function Step2Panel({ year, month0, monthLabel, brand, onClose, onMarkedComplete }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
  onClose: () => void;
  onMarkedComplete?: () => void | Promise<void>;
}) {
  const [current, setCurrent] = useState<Step2SubStep>(1);
  function goBack()   { setCurrent((c) => (c > 1 ? ((c - 1) as Step2SubStep) : c)); }
  function goNext()   { setCurrent((c) => (c < 3 ? ((c + 1) as Step2SubStep) : c)); }
  async function complete() { try { await onMarkedComplete?.(); } finally { onClose(); } }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-5xl bg-white shadow-2xl z-50 flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">
            Employee Changes: {monthLabel}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </header>

        <div className="flex items-center justify-between px-8 py-4 border-b border-slate-100">
          <div className="flex-1 flex items-center justify-center gap-10">
            {STEP2_SUB_STEPS.map((s) => {
              const active = s.n === current;
              return (
                <div key={s.n} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
                      active
                        ? "bg-[#6f42c1] text-white border-2 border-[#6f42c1]"
                        : "bg-white text-slate-500 border-2 border-slate-300"
                    }`}
                  >
                    {s.n}
                  </div>
                  <span
                    className={`text-[11px] font-semibold tracking-wide whitespace-pre-line leading-tight ${
                      active ? "text-[#6f42c1]" : "text-slate-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {current > 1 && (
              <button onClick={goBack} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Back</button>
            )}
            {current < 3 ? (
              <button onClick={goNext} className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]">Save &amp; Continue</button>
            ) : (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">Save &amp; Close</button>
                <button onClick={complete} className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold hover:bg-[#5a3499]">Mark as Complete</button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50">
          <div className="flex gap-5 p-5">
            <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5">
              {current === 1 && <NewJoineesSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 2 && <ExitProcessSubStep  year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
              {current === 3 && <FullAndFinalSubStep year={year} month0={month0} monthLabel={monthLabel} brand={brand} />}
            </div>
            <aside className="hidden lg:block w-[280px] shrink-0">
              <HelpResourcesStep2 step={current} />
            </aside>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Step 2 sub-step 1: New Joinees (wired) ─────────────────────────────────

type NewJoinee = {
  userId: number;
  employeeId: string | null;
  name: string;
  joiningDate: string;
  unitsWorked: number;
  monthlyAmount: number;
  payAction: string;
};

const PAY_ACTIONS = [
  "Hold salary processing this month",
  "Process as salary",
  "Void salary processing",
  "Hold salary payout this month",
  "Void Salary payout",
  "Already Paid",
  "Hold salary payout partially",
];

// Map a Keka pay-action to the SalaryHold (kind, payAction) tuple.
// "Process as salary" / "Already Paid" / "Void *" have no SalaryHold row.
function payActionToHold(s: string): { kind: "processing" | "payout"; payAction: string } | null {
  if (s === "Hold salary processing this month") return { kind: "processing", payAction: "Hold" };
  if (s === "Hold salary payout this month")     return { kind: "payout",     payAction: "Hold" };
  if (s === "Hold salary payout partially")      return { kind: "payout",     payAction: "Partial" };
  return null;
}

function NewJoineesSubStep({ year, month0, monthLabel, brand }: {
  year: number;
  month0: number;
  monthLabel: string;
  brand: "NB Media" | "YT Labs";
}) {
  const url = `/api/hr/payroll/new-joinees?month=${month0}&year=${year}&brand=${encodeURIComponent(brand)}`;
  const { data } = useSWR<{ items: NewJoinee[] }>(url, fetcher);
  const items = data?.items ?? [];

  const [search, setSearch] = useState("");
  // Local pending overrides until the user actually persists via the
  // Pay Action onChange handler. Once a SalaryHold round-trips, the
  // SWR refresh picks the new value up.
  const [draftActions, setDraftActions] = useState<Record<number, string>>({});
  const [drafts, setDrafts]   = useState<Record<number, string>>({}); // comments

  const filtered = items.filter((it) =>
    !search ||
    it.name.toLowerCase().includes(search.toLowerCase()) ||
    (it.employeeId ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  async function changePayAction(j: NewJoinee, next: string) {
    setDraftActions((prev) => ({ ...prev, [j.userId]: next }));
    const target = payActionToHold(next);
    if (target) {
      // Upsert a SalaryHold row.
      await fetch("/api/hr/payroll/salary-hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: j.userId, month: month0, year, kind: target.kind, payAction: target.payAction,
        }),
      });
    } else {
      // No hold → ensure any existing hold for this user is removed.
      // We don't have a bulk-by-user delete; this is best-effort.
      const r = await fetch(`/api/hr/payroll/salary-hold?month=${month0}&year=${year}&kind=processing`);
      const j1 = await r.json().catch(() => ({}));
      const existing = (j1?.items ?? []).find((it: any) => it.userId === j.userId);
      if (existing) await fetch(`/api/hr/payroll/salary-hold?id=${existing.id}`, { method: "DELETE" });
      const r2 = await fetch(`/api/hr/payroll/salary-hold?month=${month0}&year=${year}&kind=payout`);
      const j2 = await r2.json().catch(() => ({}));
      const existing2 = (j2?.items ?? []).find((it: any) => it.userId === j.userId);
      if (existing2) await fetch(`/api/hr/payroll/salary-hold?id=${existing2.id}`, { method: "DELETE" });
    }
    mutate(url);
  }

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">New Joinees</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        All the employees for whom payroll is enabled and whose date of joining falls under this month will be shown here.
      </p>

      <div className="flex items-center justify-end mb-3">
        <div className="relative w-[260px]">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full h-8 pl-8 pr-3 text-[12px] rounded-md border border-slate-200 bg-white focus:outline-none focus:border-[#6f42c1]"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]">⌕</span>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="w-8 px-3 py-2.5"></th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Employee</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Date of Joining</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">No. of Units Worked</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Salary</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Pay Action</th>
              <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Comments</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-[12.5px] text-slate-400 py-14">
                  No new joinees in {monthLabel}.
                </td>
              </tr>
            ) : (
              filtered.map((j) => {
                const current = draftActions[j.userId] ?? j.payAction;
                return (
                  <tr key={j.userId} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3 text-slate-400">▸</td>
                    <td className="px-4 py-3 text-slate-800">
                      <span className="font-semibold">{j.employeeId || "—"}</span>
                      <span className="block text-[11.5px] text-slate-500">{j.name}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">{new Date(j.joiningDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">{j.unitsWorked} Days</td>
                    <td className="px-4 py-3 text-slate-800 tabular-nums font-semibold">{fmtInr(j.monthlyAmount)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={current}
                        onChange={(e) => changePayAction(j, e.target.value)}
                        className="w-[200px] px-2 py-1 text-[12px] rounded-md border border-slate-200 bg-white"
                      >
                        {PAY_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={drafts[j.userId] ?? ""}
                          onChange={(e) => setDrafts((p) => ({ ...p, [j.userId]: e.target.value }))}
                          placeholder=""
                          className="w-[120px] h-7 px-2 text-[12px] rounded-md border border-slate-200 bg-white"
                        />
                        <button title="Comment" className="text-slate-400 hover:text-slate-600">💬</button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pagination count={filtered.length} />
    </>
  );
}

// ─── Step 2 sub-step 2: Employee in Exit Process (placeholder) ──────────────

function ExitProcessSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  const url = `/api/hr/payroll/exits?month=${month0}&year=${year}&brand=${encodeURIComponent(brand)}`;
  type ExitRow = {
    id: number; userId: number; userName: string; employeeId: string | null;
    designation: string | null; department: string | null;
    exitType: string; resignationDate: string; lastWorkingDay: string;
    noticePeriodDays: number; status: string;
  };
  const { data } = useSWR<{ thisMonth: ExitRow[]; alreadyExited: ExitRow[] }>(url, fetcher);
  const thisMonth     = data?.thisMonth     ?? [];
  const alreadyExited = data?.alreadyExited ?? [];

  function renderRow(r: ExitRow) {
    return (
      <tr key={r.id} className="border-t border-slate-100">
        <td className="px-3 py-2 text-[12.5px] font-mono text-slate-700">{r.employeeId ?? "—"}</td>
        <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName}</td>
        <td className="px-3 py-2 text-[12.5px] text-slate-600 capitalize">{r.exitType.replace(/_/g, " ")}</td>
        <td className="px-3 py-2 text-[12.5px] text-slate-700">{new Date(r.resignationDate).toLocaleDateString()}</td>
        <td className="px-3 py-2 text-[12.5px] text-slate-700">{new Date(r.lastWorkingDay).toLocaleDateString()}</td>
        <td className="px-3 py-2"><StatusPill status={r.status} /></td>
      </tr>
    );
  }

  return (
    <>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        Employees whose last working day falls in {monthLabel} appear under 'Employees in Exit Process'.
        Past exits that still need F&amp;F appear under 'Pending F&F'.
      </p>

      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Employees in Exit Process</h4>
      <KekaTable columns={["Employee Number", "Employee Name", "Exit Type", "Resignation Date", "Last Working Day", "Status"]}>
        {thisMonth.length === 0
          ? <EmptyRow colSpan={6} text={`No exits in ${monthLabel}.`} />
          : thisMonth.map(renderRow)}
      </KekaTable>
      <Pagination count={thisMonth.length} />

      <h4 className="mt-6 text-[15px] font-semibold text-slate-800 mb-3">Pending F&amp;F (earlier exits)</h4>
      <KekaTable columns={["Employee Number", "Employee Name", "Exit Type", "Resignation Date", "Last Working Day", "Status"]}>
        {alreadyExited.length === 0
          ? <EmptyRow colSpan={6} text="None pending." />
          : alreadyExited.map(renderRow)}
      </KekaTable>
      <Pagination count={alreadyExited.length} />
    </>
  );
}

// ─── Step 2 sub-step 3: Full & Final Settlement (placeholder) ───────────────

function FullAndFinalSubStep({ year, month0, monthLabel, brand }: { year: number; month0: number; monthLabel: string; brand: "NB Media" | "YT Labs" }) {
  const url = `/api/hr/payroll/exits?month=${month0}&year=${year}&brand=${encodeURIComponent(brand)}`;
  type ExitRow = {
    id: number; userId: number; userName: string; employeeId: string | null;
    exitType: string; lastWorkingDay: string; status: string;
    finalSettlementDone: boolean; ctc: string | null;
  };
  const { data } = useSWR<{ thisMonth: ExitRow[]; alreadyExited: ExitRow[] }>(url, fetcher);
  const pending = useMemo(() => {
    const all = [...(data?.thisMonth ?? []), ...(data?.alreadyExited ?? [])];
    return all.filter((r) => !r.finalSettlementDone);
  }, [data]);
  const [settleRow, setSettleRow] = useState<ExitRow | null>(null);

  return (
    <>
      <h4 className="text-[15px] font-semibold text-slate-800 mb-3">Full &amp; Final Settlement</h4>
      <p className="mb-4 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-[12px] text-slate-700">
        Pending F&amp;F across all exits. Clicking Settle adds an Adhoc payment for {monthLabel} and marks the exit as cleared.
      </p>
      <div className="flex items-center justify-end mb-3"><SearchBox /></div>
      <KekaTable columns={["Employee Number", "Employee Name", "Exit Type", "Last Working Day", "Status", "Action"]}>
        {pending.length === 0 ? (
          <EmptyRow colSpan={6} text="No pending F&F." />
        ) : (
          pending.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-[12.5px] font-mono text-slate-700">{r.employeeId ?? "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-800">{r.userName}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-600 capitalize">{r.exitType.replace(/_/g, " ")}</td>
              <td className="px-3 py-2 text-[12.5px] text-slate-700">{new Date(r.lastWorkingDay).toLocaleDateString()}</td>
              <td className="px-3 py-2"><StatusPill status={r.status} /></td>
              <td className="px-3 py-2">
                <button
                  onClick={() => setSettleRow(r)}
                  className="px-2.5 py-1 rounded-md border border-[#6f42c1]/40 text-[#6f42c1] text-[11.5px] font-semibold hover:bg-[#6f42c1]/5"
                >
                  Settle F&amp;F
                </button>
              </td>
            </tr>
          ))
        )}
      </KekaTable>
      <Pagination count={pending.length} />

      {settleRow && (
        <SettleFFModal
          row={settleRow}
          year={year}
          month0={month0}
          monthLabel={monthLabel}
          onClose={() => setSettleRow(null)}
          onSettled={() => { setSettleRow(null); mutate(url); }}
        />
      )}
    </>
  );
}

function SettleFFModal({ row, year, month0, monthLabel, onClose, onSettled }: {
  row: { id: number; userName: string; ctc: string | null };
  year: number;
  month0: number;
  monthLabel: string;
  onClose: () => void;
  onSettled: () => void;
}) {
  // Fallback if the exit-statement net can't be resolved: one month's CTC.
  const fallbackAmount = row.ctc ? Math.round(parseFloat(row.ctc) / 12).toString() : "";
  const [amount, setAmount] = useState("");
  const [amountSource, setAmountSource] = useState<"loading" | "exit-statement" | "fallback">("loading");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill the settlement amount with the Exit Statement's Net Payable — the
  // same figure the F&F letter prints — so HR doesn't retype it. Falls back to
  // one month's CTC if the net can't be computed. Stays fully editable.
  useEffect(() => {
    let cancelled = false;
    // Hard timeout so a slow/unreachable server can never leave the modal
    // stuck on "loading" with a disabled button — fall back to editable CTC/12.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    (async () => {
      try {
        const res = await fetch(`/api/hr/exits/${row.id}/settlement/final-amount`, { signal: controller.signal });
        if (res.ok) {
          const j = await res.json();
          const net = Number(j?.net);
          if (!cancelled && Number.isFinite(net) && net > 0) {
            setAmount(String(Math.round(net)));
            setAmountSource("exit-statement");
            return;
          }
        }
      } catch { /* network blip / timeout — fall back below */ }
      if (!cancelled) {
        setAmount(fallbackAmount);
        setAmountSource("fallback");
      }
    })().finally(() => clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/hr/payroll/exits/${row.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: month0, year, amount: Number(amount), comment }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Settle failed");
      onSettled();
    } catch (e: any) {
      setError(e?.message || "Settle failed");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-[60]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[70] w-[420px] p-5">
        <h3 className="text-[15px] font-semibold text-slate-800 mb-1">Settle F&amp;F — {row.userName}</h3>
        <p className="text-[11.5px] text-slate-500 mb-4">Cycle: {monthLabel}. Settlement is added as an adhoc payment so the engine picks it up.</p>
        <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">Settlement Amount (₹)</label>
        <input type="number" min={0} value={amount} onChange={(e) => { setAmount(e.target.value); setAmountSource("fallback"); }}
          placeholder={amountSource === "loading" ? "Loading exit statement net…" : ""}
          disabled={amountSource === "loading"}
          className="w-full mb-1 px-3 py-2 border border-slate-300 rounded-md text-[13px] disabled:bg-slate-50 disabled:text-slate-400" />
        <p className="mb-3 text-[11px] text-slate-500">
          {amountSource === "loading"
            ? "Fetching the Exit Statement net payable…"
            : amountSource === "exit-statement"
              ? "Auto-filled from the Exit Statement net payable. Editable."
              : "Auto-fill unavailable — showing one month's CTC. Please verify."}
        </p>
        <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">Comment</label>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
          className="w-full mb-3 px-3 py-2 border border-slate-300 rounded-md text-[13px]" />
        {error && <p className="mb-3 text-[12px] text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md border border-slate-300 text-[12.5px] font-semibold text-slate-700">Cancel</button>
          <button onClick={submit} disabled={busy || !amount || amountSource === "loading"}
            className="px-4 py-2 rounded-md bg-[#6f42c1] text-white text-[12.5px] font-semibold disabled:opacity-50">
            {busy ? "Settling…" : "Settle F&F"}
          </button>
        </div>
      </div>
    </>
  );
}

function HelpResourcesStep2({ step }: { step: Step2SubStep }) {
  const sets: Record<Step2SubStep, { question: string }[]> = {
    1: [
      { question: "How is the new joinee's pro-rated salary computed?" },
      { question: "What does each Pay Action option do?" },
    ],
    2: [
      { question: "How does notice-period assignment affect this view?" },
      { question: "What is the difference between 'Exit Process' and 'Pending Exit Requests'?" },
    ],
    3: [
      { question: "How is F&F settled amount computed?" },
      { question: "Can I finalise F&F partially?" },
    ],
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h5 className="text-[13px] font-semibold text-slate-800 mb-2">Need help?</h5>
      <p className="text-[11.5px] text-slate-500 mb-3">If you have questions talk to us, we're here for you.</p>
      <ul className="space-y-2.5">
        {sets[step].map((q) => (
          <li key={q.question} className="flex items-start gap-2">
            <a href="#" className="text-[12px] text-slate-700 hover:text-[#6f42c1] hover:underline flex-1">{q.question}</a>
            <span className="text-slate-400">↗</span>
          </li>
        ))}
      </ul>
      <a href="#" className="mt-3 inline-block text-[12px] font-semibold text-[#6f42c1] hover:underline">Talk to us →</a>
    </div>
  );
}

function HelpResourcesStep1({ step }: { step: Step1SubStep }) {
  const sets: Record<Step1SubStep, { question: string }[]> = {
    1: [{ question: "How do approved leaves affect payroll?" }],
    2: [{ question: "What counts as a 'No Attendance' day?" }],
    3: [
      { question: "How are LOP's auto populated in payroll?" },
      { question: "Why am I not seeing certain employees in LOP section?" },
      { question: "What are arrear LOPs?" },
    ],
    4: [
      { question: "How many months of LOP can be reversed?" },
      { question: "How does the employee get paid when an LOP is reversed?" },
      { question: "Why am I not able to add certain employees in LOP reversal?" },
      { question: "Does LOP reversal get auto populated based on cancelled leaves?" },
    ],
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h5 className="text-[13px] font-semibold text-slate-800 mb-3 flex items-center justify-between">
        Help Resources
        <span className="text-slate-400 text-[14px]">▾</span>
      </h5>
      <ul className="space-y-2.5">
        {sets[step].map((q) => (
          <li key={q.question} className="flex items-start gap-2">
            <a href="#" className="text-[12px] text-slate-700 hover:text-[#6f42c1] hover:underline flex-1">{q.question}</a>
            <span className="text-slate-400">↗</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HelpResourcesStep5({ step }: { step: Step5SubStep }) {
  const sets: Record<Step5SubStep, { question: string }[]> = {
    1: [
      { question: "What happens when employee's salary processing is hold?" },
      { question: "Salary processing on hold vs Salary payout on hold" },
      { question: "What happens when I select 'Process as Salary' for any previous on hold?" },
      { question: "What happens when I select 'Process as Arrears' for any previous on hold?" },
      { question: "How to convert a salary processing on hold into salary payout on hold?" },
    ],
    2: [
      { question: "What happens when an employee's salary payout is hold?" },
      { question: "Salary payout on hold vs Salary processing on hold" },
      { question: "Why am I not seeing an option to release a payout on hold?" },
      { question: "How to hold salary payout partially?" },
    ],
    3: [
      { question: "How are arrears computed?" },
      { question: "Can I edit an arrear amount?" },
    ],
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h5 className="text-[13px] font-semibold text-slate-800 mb-3 flex items-center justify-between">
        Help Resources
        <span className="text-slate-400 text-[14px]">▾</span>
      </h5>
      <ul className="space-y-2.5">
        {sets[step].map((q) => (
          <li key={q.question} className="flex items-start gap-2">
            <a href="#" className="text-[12px] text-slate-700 hover:text-[#6f42c1] hover:underline flex-1">{q.question}</a>
            <span className="text-slate-400">↗</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
