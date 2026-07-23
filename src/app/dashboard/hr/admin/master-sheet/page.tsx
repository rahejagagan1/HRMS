"use client";

// HR Master Sheet — single-file Excel export bundling employees,
// attendance, leave balances, and the five request logs (Leaves /
// WFH / On-Duty / Regularizations / Comp-Off). HR-admin tier only.
// The actual workbook is built on the server at
// /api/hr/admin/master-sheet so we never have to ship Prisma data
// to the browser.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Download,
  FileSpreadsheet,
  Users,
  Calendar,
  Clock,
  FileText,
  IndianRupee,
  Fingerprint,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { isHRAdmin, canViewSalary, isLeadershipOrHR, canViewAllBrands } from "@/lib/access";
import SelectField from "@/components/ui/SelectField";

type BrandScope = "all" | "nb-media" | "yt-labs";
const BRAND_OPTIONS: Array<{ value: BrandScope; label: string }> = [
  { value: "all",      label: "All brands (NB Media + YT Labs)" },
  { value: "nb-media", label: "NB Media only" },
  { value: "yt-labs",  label: "YT Labs only" },
];

type StatusScope = "active" | "exited" | "all";
const STATUS_OPTIONS: Array<{ value: StatusScope; label: string }> = [
  { value: "active", label: "Active employees only" },
  { value: "exited", label: "Exited employees only" },
  { value: "all",    label: "All (active + exited)" },
];

type SheetKey = "employees" | "attendance" | "leaves" | "requests" | "salaries" | "identity";

type SheetDef = {
  key: SheetKey;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
};

const SHEETS: SheetDef[] = [
  { key: "employees",  label: "Employees",       desc: "Full directory — names, IDs, departments, roles, contact, statutory info.", icon: Users },
  { key: "attendance", label: "Attendance",      desc: "Daily clock-in/out with effective hours, status, and regularization flag.",  icon: Clock },
  { key: "leaves",     label: "Leave Balances",  desc: "Per-employee balance grid — total / used / pending / available.",            icon: Calendar },
  { key: "requests",   label: "Requests Log",    desc: "Five tabs: Leaves, WFH, On-Duty, Regularizations, Comp-Off.",                 icon: FileText },
];

// Salaries is compensation data — shown only to HR Manager / CEO / salary-dev
// (canViewSalary). Kept out of the default SHEETS list and appended per-user
// so it never renders for a broader HR-admin who can't see pay.
const SALARY_SHEET: SheetDef = {
  key: "salaries", label: "Salaries",
  desc: "Per-employee annual CTC and monthly salary. Restricted to HR Manager, CEO & admin.",
  icon: IndianRupee,
};

// Identity documents are PAN / Aadhaar PII — shown only to the HR-confidential
// tier (isLeadershipOrHR: HR team via designation, CEO, developers). Same
// per-user append pattern as Salaries so broader HR admins never see the card.
const IDENTITY_SHEET: SheetDef = {
  key: "identity", label: "Identity (PAN & Aadhaar)",
  desc: "Per-employee PAN and Aadhaar numbers with a PAN format check. Restricted to the HR team, CEO & admin.",
  icon: Fingerprint,
};

const PERIOD_OPTIONS = [
  { value: "both",      label: "Current + Last month"        },
  { value: "current",   label: "Current month only"          },
  { value: "last",      label: "Last month only"             },
  { value: "this-year", label: "This year"                   },
  { value: "last-year", label: "Last year"                   },
  { value: "all",       label: "All time (one sheet per year)" },
];

export default function MasterSheetPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = session?.user as any;

  // Default: nothing ticked — the user explicitly picks what to export
  // (per HR request 2026-07-15; the old default pre-ticked the four base
  // sheets, which made accidental full exports too easy).
  const [picked, setPicked] = useState<Set<SheetKey>>(new Set<SheetKey>());
  const [period, setPeriod] = useState<string>("both");
  // Brand scope — seeded from ?brand= so entering via the HR
  // Dashboard sidebar flyout (NB Media / YT Labs) lands on the right
  // option. Unknown / missing → "all". User can still flip the
  // selector before downloading.
  const [brand, setBrand] = useState<BrandScope>(() => {
    const raw = (searchParams?.get("brand") || "").toLowerCase();
    return raw === "yt-labs" || raw === "yt"      ? "yt-labs"
         : raw === "nb-media" || raw === "nb"     ? "nb-media"
         : "all";
  });
  // Employee status — default "active" so exited employees are excluded from
  // the export unless HR deliberately asks for them (or "all").
  const [empStatus, setEmpStatus] = useState<StatusScope>("active");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  // Org-wide brand isolation (2026-07-15): non-VIEW_ALL_BRANDS viewers are
  // locked to their own brand — the scope selector collapses to a single
  // option and any ?brand= trick is snapped back. The export API clamps
  // server-side too; this keeps the UI honest about it.
  const seesAllBrands = canViewAllBrands(user);
  const ownBrandScope: BrandScope = user?.businessUnit === "YT Labs" ? "yt-labs" : "nb-media";
  useEffect(() => {
    if (user && !seesAllBrands && brand !== ownBrandScope) setBrand(ownBrandScope);
  }, [user, seesAllBrands, ownBrandScope, brand]);
  const visibleBrandOptions = seesAllBrands
    ? BRAND_OPTIONS
    : BRAND_OPTIONS.filter((o) => o.value === ownBrandScope);

  if (status === "loading") {
    return <div className="p-6 text-[13px] text-slate-500">Loading…</div>;
  }
  if (!user || !isHRAdmin(user)) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-slate-400 mx-auto mb-2" />
          <p className="text-[14px] font-semibold text-slate-600 dark:text-slate-300">HR-admin access required</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-3 text-[12px] text-[#008CFF] hover:underline"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // Sensitive extras appended per-viewer after the base sheets: Salaries for
  // compensation-cleared viewers (canViewSalary), Identity (PAN/Aadhaar) for
  // the HR-confidential tier (isLeadershipOrHR).
  const visibleSheets = [
    ...SHEETS,
    ...(canViewSalary(user) ? [SALARY_SHEET] : []),
    ...(isLeadershipOrHR(user) ? [IDENTITY_SHEET] : []),
  ];

  const toggle = (k: SheetKey) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const download = async () => {
    if (picked.size === 0) { setErr("Pick at least one sheet."); return; }
    setBusy(true); setErr("");
    try {
      const sheets = Array.from(picked).join(",");
      const qs = new URLSearchParams({ sheets, period });
      // Only send `brand=` when narrowing — keeps the URL clean for
      // "all" exports and matches the API's "missing = all" default.
      if (brand !== "all") qs.set("brand", brand);
      // Default (active) matches the API's default, so only send when narrowing.
      if (empStatus !== "active") qs.set("status", empStatus);
      // Stream straight from the server — fetch+blob keeps us inside
      // the SPA shell so the error path can show an inline message
      // rather than navigating to a JSON error page.
      const res = await fetch(`/api/hr/admin/master-sheet?${qs.toString()}`);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Server returned ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const brandSlug = brand === "all" ? "all-brands" : brand;
      const statusSlug = empStatus === "active" ? "" : `-${empStatus}`;
      a.download = `master-sheet-${brandSlug}${statusSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message || "Download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">
      {/* Header — mirrors the rest of the HR admin pages */}
      <div className="sticky top-[68px] z-20 bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/hr/admin"
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-700"
            aria-label="Back to HR Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <FileSpreadsheet className="w-5 h-5 text-[#008CFF]" />
          <div>
            <h1 className="text-[15px] font-bold text-slate-800 dark:text-white inline-flex items-center gap-2">
              Master Sheet
              {brand !== "all" && (
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#008CFF]/10 text-[#008CFF]">
                  {brand === "yt-labs" ? "YT Labs" : "NB Media"}
                </span>
              )}
            </h1>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Export the live HR database as a single multi-tab Excel workbook.</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Sheet picker */}
        <section className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
          <h2 className="text-[13px] font-bold text-slate-800 dark:text-white uppercase tracking-wide">
            What to include
          </h2>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Each ticked item becomes one or more sheets in the workbook.
          </p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleSheets.map((s) => {
              const on = picked.has(s.key);
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggle(s.key)}
                  className={`text-left rounded-lg border p-4 transition-colors ${
                    on
                      ? "border-[#008CFF] bg-[#008CFF]/[0.05]"
                      : "border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${
                      on ? "bg-[#008CFF] text-white" : "bg-slate-100 dark:bg-white/5 text-slate-500"
                    }`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-white">{s.label}</p>
                        <input
                          type="checkbox"
                          checked={on}
                          readOnly
                          className="h-4 w-4 accent-[#008CFF] cursor-pointer pointer-events-none"
                        />
                      </div>
                      <p className="mt-1 text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">
                        {s.desc}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Brand scope — pick which brand's data the workbook covers.
            Defaults from `?brand=` so entering via the HR Dashboard
            sidebar flyout lands on the right brand; HR can flip to
            "All brands" before downloading for a combined export. */}
        <section className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
          <h2 className="text-[13px] font-bold text-slate-800 dark:text-white uppercase tracking-wide">
            Brand scope
          </h2>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Filters every sheet to employees from the chosen brand. Choose <strong>All brands</strong> for the full org.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {visibleBrandOptions.map((o) => {
              const on = brand === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setBrand(o.value)}
                  className={`text-left rounded-lg border px-4 py-3 transition-colors text-[12.5px] font-semibold ${
                    on
                      ? "border-[#008CFF] bg-[#008CFF]/[0.08] text-[#008CFF]"
                      : "border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-slate-700 dark:text-slate-300 hover:border-slate-300"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Employee status — Active (default) excludes anyone who has exited;
            Exited exports only past employees; All includes both. Exited =
            deactivated OR last-working-day already passed. */}
        <section className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
          <h2 className="text-[13px] font-bold text-slate-800 dark:text-white uppercase tracking-wide">
            Employee status
          </h2>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Filters every sheet by employment status. <strong>Active</strong> excludes exited employees; pick <strong>Exited</strong> or <strong>All</strong> to include them.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {STATUS_OPTIONS.map((o) => {
              const on = empStatus === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setEmpStatus(o.value)}
                  className={`text-left rounded-lg border px-4 py-3 transition-colors text-[12.5px] font-semibold ${
                    on
                      ? "border-[#008CFF] bg-[#008CFF]/[0.08] text-[#008CFF]"
                      : "border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-slate-700 dark:text-slate-300 hover:border-slate-300"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Attendance period — only matters when attendance is picked */}
        <section className={`bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-5 transition-opacity ${
          picked.has("attendance") ? "" : "opacity-50"
        }`}>
          <h2 className="text-[13px] font-bold text-slate-800 dark:text-white uppercase tracking-wide">
            Attendance period
          </h2>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Bigger ranges = larger files. Picking both creates two sheets.
          </p>
          <div className="mt-3 max-w-xs">
            <SelectField
              value={period}
              onChange={setPeriod}
              options={PERIOD_OPTIONS}
              disabled={!picked.has("attendance")}
            />
          </div>
        </section>

        {/* Download */}
        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[12px] text-slate-500 dark:text-slate-400">
            {picked.size === 0
              ? "Nothing picked — tick at least one sheet above."
              : `${picked.size} ${picked.size === 1 ? "section" : "sections"} will be exported.`}
          </div>
          <button
            type="button"
            onClick={download}
            disabled={busy || picked.size === 0}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-[#008CFF] hover:bg-[#0077dd] text-white text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {busy ? "Generating…" : "Download as Excel"}
          </button>
        </section>

        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
