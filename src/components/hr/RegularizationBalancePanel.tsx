"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { fetcher } from "@/lib/swr";
import { Search, X, Infinity as InfinityIcon } from "lucide-react";

type EmpRow = {
  userId: number;
  name: string;
  email: string;
  profilePictureUrl: string | null;
  role: string | null;
  orgLevel: string | null;
  businessUnit: string | null;
  used: number;
  limit: number | null;
  remaining: number | null;
};

type ApiResp = {
  month: string;
  start: string;
  end: string;
  unlimited: boolean;
  limit: number | null;
  employees: EmpRow[];
};

/**
 * HR-admin grid showing every active employee's regularization quota
 * usage for the current IST month. Read-only — the underlying quota
 * is enforced in the regularize POST and (when unlimited) in the
 * regularization_unlimited policy toggle.
 */
export default function RegularizationBalancePanel({
  initialBrand = null,
}: {
  /** Locks the panel to a specific brand on mount (NB Media / YT Labs)
   *  — comes from the `?brand=` URL param on /dashboard/hr/admin. When
   *  null, the panel auto-detects from the viewer's businessUnit (or
   *  "all" for super-admins) as before. */
  initialBrand?: "NB Media" | "YT Labs" | "all" | null;
} = {}) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useSWR<ApiResp>(
    "/api/hr/attendance/regularize/balance/all",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );

  const employees = data?.employees ?? [];
  const unlimited = !!data?.unlimited;
  const limit     = data?.limit ?? null;

  // ── Company scope tabs ──────────────────────────────────────────────
  // Same pattern as ApprovalsPanel: auto-default to viewer's brand
  // (founders / super-admins land on "all"). Splits the balance list
  // into NB Media vs YT Labs so each HR manager works on their brand.
  type CompanyTab = "NB Media" | "YT Labs" | "all";
  const { data: session } = useSession();
  const me = session?.user as any;
  const [companyTab, setCompanyTab] = useState<CompanyTab>(initialBrand ?? "all");
  const [companyTabTouched, setCompanyTabTouched] = useState<boolean>(initialBrand != null);
  const { data: viewerProfile } = useSWR<any>(
    me ? "/api/hr/profile" : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  // Sync to a changing URL param without remounting.
  useEffect(() => {
    if (initialBrand == null) return;
    setCompanyTab(initialBrand);
    setCompanyTabTouched(true);
  }, [initialBrand]);
  useEffect(() => {
    if (companyTabTouched) return;
    const isSuperAdmin = me?.orgLevel === "ceo" || me?.isDeveloper;
    if (isSuperAdmin) { setCompanyTab("all"); return; }
    const bu = viewerProfile?.employeeProfile?.businessUnit;
    if (bu === "YT Labs") setCompanyTab("YT Labs");
    else if (bu === "NB Media" || bu == null) setCompanyTab("NB Media");
  }, [viewerProfile, me, companyTabTouched]);

  const companyCounts = useMemo(() => {
    let nb = 0, yt = 0;
    employees.forEach((e) => {
      const bu = e.businessUnit || "NB Media";
      if (bu === "YT Labs") yt++;
      else nb++;
    });
    return { nb, yt, all: employees.length };
  }, [employees]);

  const filtered = useMemo(() => {
    let rows = employees;
    // Company scope first so the search count reflects the active brand.
    if (companyTab !== "all") {
      rows = rows.filter((e) => (e.businessUnit || "NB Media") === companyTab);
    }
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((e) =>
      (e.name || "").toLowerCase().includes(q) ||
      (e.email || "").toLowerCase().includes(q)
    );
  }, [employees, query, companyTab]);

  // Aggregate counts for the meta strip.
  const stats = useMemo(() => {
    let exhausted = 0, partial = 0, untouched = 0;
    for (const e of employees) {
      if (unlimited) { untouched += e.used === 0 ? 1 : 0; continue; }
      if (e.remaining === 0)            exhausted++;
      else if (e.used > 0)              partial++;
      else                              untouched++;
    }
    return { exhausted, partial, untouched };
  }, [employees, unlimited]);

  return (
    <>
      <header className="mb-5 rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-800">Regularization Balance</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Monthly quota usage for{" "}
              <span className="font-semibold text-slate-700">{data?.month ?? "this month"}</span>
              {unlimited ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700">
                  <InfinityIcon size={11} /> Unlimited policy ON
                </span>
              ) : (
                <span className="ml-2 text-slate-400">· Limit {limit} / month</span>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {employees.length} {employees.length === 1 ? "employee" : "employees"}
              </span>
              {!unlimited && (
                <>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                    {stats.exhausted} exhausted
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {stats.partial} partial
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
                    {stats.untouched} untouched
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search employee…"
                className="h-9 w-[220px] rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/20"
              />
              {query ? (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                  <X size={12} />
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {/* Company scope tabs — hidden when initialBrand is set
            (the HR Dashboard sidebar flyout already chose a brand). */}
        {initialBrand == null && (
          <div className="px-5 pb-4 border-t border-slate-100 pt-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 mb-2">Brand scope</div>
            <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { key: "NB Media", count: companyCounts.nb  },
              { key: "YT Labs",  count: companyCounts.yt  },
              { key: "all",      count: companyCounts.all },
            ] as const).map(({ key, count }) => {
              const active = companyTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCompanyTab(key as CompanyTab); setCompanyTabTouched(true); }}
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
          </div>
        )}
      </header>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <table className="w-full min-w-[640px]">
          <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
            <tr className="border-b border-slate-100">
              <th className="sticky left-0 z-20 bg-slate-50/95 px-5 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500 min-w-[280px]">
                Employee
              </th>
              <th className="px-3 py-3 text-right text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Used
              </th>
              <th className="px-3 py-3 text-right text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Limit
              </th>
              <th className="px-3 py-3 text-right text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Remaining
              </th>
              <th className="px-5 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500 min-w-[160px]">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-[12.5px] text-slate-400">Loading balances…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-[12.5px] text-slate-400">
                {employees.length === 0 ? "No active employees." : `No employee matches "${query}".`}
              </td></tr>
            ) : filtered.map((emp, i) => {
              const exhausted = !unlimited && emp.remaining === 0;
              const partial   = !unlimited && emp.used > 0 && !exhausted;
              const tone =
                exhausted ? "bg-red-50 text-red-700 ring-red-200" :
                partial   ? "bg-amber-50 text-amber-700 ring-amber-200" :
                emp.used > 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" :
                "bg-slate-50 text-slate-500 ring-slate-200";
              return (
                <tr
                  key={emp.userId}
                  className={`border-b border-slate-50 transition-colors hover:bg-[#f8fbff] ${i % 2 === 0 ? "" : "bg-slate-50/30"}`}
                >
                  <td className="sticky left-0 z-[1] bg-inherit px-5 py-3 min-w-[280px]">
                    <div className="flex items-center gap-2.5">
                      {emp.profilePictureUrl ? (
                        <img src={emp.profilePictureUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-200" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8f1fc] text-[11px] font-semibold text-[#0f4e93] ring-1 ring-[#cfdef5]">
                          {(emp.name || "?").trim().slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-slate-800">{emp.name}</p>
                        <p className="truncate text-[10.5px] text-slate-400">{emp.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right text-[13px] font-semibold text-slate-800 tabular-nums">
                    {emp.used}
                  </td>
                  <td className="px-3 py-3 text-right text-[13px] text-slate-500 tabular-nums">
                    {emp.limit ?? "∞"}
                  </td>
                  <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums">
                    {emp.remaining === null ? (
                      <span className="text-slate-500">∞</span>
                    ) : exhausted ? (
                      <span className="text-red-600">0</span>
                    ) : partial ? (
                      <span className="text-amber-700">{emp.remaining}</span>
                    ) : (
                      <span className="text-emerald-700">{emp.remaining}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${tone}`}>
                      {unlimited
                        ? (emp.used > 0 ? `${emp.used} used` : "No usage")
                        : exhausted
                          ? "Exhausted"
                          : partial
                            ? `${emp.used} / ${emp.limit} used`
                            : "Untouched"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-300" /> Untouched
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Partial usage
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Quota exhausted
        </span>
        <span>· Counts include pending + approved requests for the current IST month.</span>
      </div>
    </>
  );
}
