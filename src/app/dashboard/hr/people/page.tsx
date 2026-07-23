"use client";
import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import AddEmployeeWizard from "@/components/hr/add-employee-wizard";
import OrgTreeView from "@/components/hr/OrgTreeView";
import FilterDropdown from "@/components/hr/FilterDropdown";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
import {
  deriveBusinessUnit,
  deriveCostCenter,
  deriveLegalEntity,
  deriveDepartment,
  deriveLocation,
  deriveRole,
  businessUnitOptions,
  costCenterOptions,
  legalEntityOptions,
  departmentOptions,
  locationOptions,
  roleOptions,
} from "@/lib/hr-taxonomy";
import { getUserRoleLabel } from "@/lib/user-role-options";
import { X } from "lucide-react";
import { isHRAdmin, canViewExitBadge } from "@/lib/access";

const ORG_TABS = [
  { key: "employees", label: "EMPLOYEES" },
  { key: "documents", label: "DOCUMENTS" },
  { key: "engage", label: "ENGAGE" },
];

export default function PeoplePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = isHRAdmin(user);
  const [subTab, setSubTab] = useUrlTab<"directory" | "tree">("view", "directory", ["directory", "tree"] as const);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [fBizUnit,  setFBizUnit]  = useState<Set<string>>(new Set());
  const [fDept,     setFDept]     = useState<Set<string>>(new Set());
  const [fLocation, setFLocation] = useState<Set<string>>(new Set());
  const [fCost,     setFCost]     = useState<Set<string>>(new Set());
  const [fLegal,    setFLegal]    = useState<Set<string>>(new Set());
  const [fRole,     setFRole]     = useState<Set<string>>(new Set());
  // Show only currently-active employees by default. HR can flip this on
  // to look at offboarded people (their data stays in the DB even after
  // exit; the user is just deactivated).
  const [showInactive, setShowInactive] = useState(false);

  const { data: employees = [] } = useSWR(
    showInactive ? "/api/hr/employees" : "/api/hr/employees?isActive=true",
    fetcher,
  );

  const { bizUnitOpts, deptOpts, locOpts, costOpts, legalOpts, rolesOpts } = useMemo(() => ({
    bizUnitOpts: businessUnitOptions(employees),
    legalOpts:   legalEntityOptions(employees),
    costOpts:    costCenterOptions(employees),
    deptOpts:    departmentOptions(employees),
    locOpts:     locationOptions(employees),
    rolesOpts:   roleOptions(employees),
  }), [employees]);

  const filtered = useMemo(() => {
    // When a filter has any selection, only users whose derived value is in
    // the set pass. Users with empty values are excluded.
    const matches = (selected: Set<string>, derived: string) => {
      if (selected.size === 0) return true;
      return !!derived && selected.has(derived);
    };
    return employees.filter((e: any) => {
      if (!matches(fBizUnit,  deriveBusinessUnit(e))) return false;
      if (!matches(fLegal,    deriveLegalEntity(e)))  return false;
      if (!matches(fCost,     deriveCostCenter(e)))   return false;
      if (!matches(fDept,     deriveDepartment(e)))   return false;
      if (!matches(fLocation, deriveLocation(e)))     return false;
      if (!matches(fRole,     deriveRole(e)))         return false;
      if (search && !(
        e.name?.toLowerCase().includes(search.toLowerCase()) ||
        (e.email || "").toLowerCase().includes(search.toLowerCase())
      )) return false;
      return true;
    });
  }, [employees, fBizUnit, fDept, fLocation, fCost, fLegal, fRole, search]);

  const anyFilter = fBizUnit.size || fDept.size || fLocation.size || fCost.size || fLegal.size || fRole.size;
  const clearFilters = () => { setFBizUnit(new Set()); setFDept(new Set()); setFLocation(new Set()); setFCost(new Set()); setFLegal(new Set()); setFRole(new Set()); };

  return (
    <div className="space-y-0">
      {/* Top Module Tabs */}
      <div className="flex items-center gap-0 bg-[#f4f7f8] dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6">
        {ORG_TABS.map((t) => (
          <Link key={t.key} href={t.key === "documents" ? "/dashboard/hr/documents" : t.key === "engage" ? "/dashboard/hr/announcements" : "/dashboard/hr/people"}
            className={`px-5 py-3 text-[12px] font-semibold tracking-wider transition-colors border-b-2 ${
              t.key === "employees" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white"
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Sub-tabs: Employee Directory / Organization Tree */}
      <div className="flex items-center justify-between px-6 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="flex gap-0">
          {(["directory", "tree"] as const).map((tab) => (
            <button key={tab} onClick={() => setSubTab(tab)}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                subTab === tab ? "border-[#008CFF] text-slate-800 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-white"
              }`}>
              {tab === "directory" ? "Employee Directory" : "Organization Tree"}
            </button>
          ))}
        </div>
        {isAdmin && (
          <button onClick={() => setShowAdd(true)} className="h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded text-[12px] font-semibold transition-colors">
            + Add Employee
          </button>
        )}
      </div>

      <div className="px-6 py-5">
        {subTab === "directory" && (
          <>
            {/* Section Title */}
            <h2 className="text-[17px] font-semibold text-slate-800 dark:text-white mb-4">Employee Directory</h2>

            {/* Filter bar (themed multi-select dropdowns) */}
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              <FilterDropdown label="Business Unit" options={bizUnitOpts} selected={fBizUnit}  onChange={setFBizUnit}  />
              <FilterDropdown label="Department"    options={deptOpts}    selected={fDept}     onChange={setFDept}     width={280} />
              <FilterDropdown label="Location"      options={locOpts}     selected={fLocation} onChange={setFLocation} />
              <FilterDropdown label="Cost Center"   options={costOpts}    selected={fCost}     onChange={setFCost}     />
              <FilterDropdown label="Legal Entity"  options={legalOpts}   selected={fLegal}    onChange={setFLegal}    />
              <FilterDropdown label="Role"          options={rolesOpts}   selected={fRole}     onChange={setFRole}     width={220} />
              {anyFilter ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-9 px-3 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-[#008CFF] dark:hover:text-[#4a9cff] transition-colors"
                >
                  Clear filters
                </button>
              ) : null}
              <div className="relative flex-1 min-w-[200px]">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
                  className="w-full h-9 pl-9 pr-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white placeholder-slate-500 focus:outline-none focus:border-[#008CFF]/40" />
              </div>
              {/* Inactive-employee toggle. Off = hide offboarded folks
                  (the default — directory should reflect current staff).
                  On = include them so HR can look up past employees. */}
              <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1e3a] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-[#008CFF] focus:ring-[#008CFF]"
                />
                <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300">
                  Show inactive
                </span>
              </label>
            </div>

            {/* Count */}
            <div className="flex justify-end mb-3">
              <span className="text-[11px] text-slate-500">Showing {filtered.length} of {employees.length}</span>
            </div>

            {/* Card Grid (Keka exact: 4 cards per row) */}
            <div className="grid grid-cols-4 gap-4">
              {filtered.map((emp: any) => {
                // Muted avatar for exited / deactivated employees —
                // grayscale photo / slate fallback so they read as
                // "gone" at a glance. Mirrors the header-search
                // treatment and follows the same canViewExitBadge
                // gating as the Exited chip below.
                const exMuted = (() => {
                  if (emp.isActive === false) return true;
                  const ex = emp.employeeExit;
                  if (!ex?.status) return false;
                  const isSelfCard = user?.dbId != null && Number(user.dbId) === emp.id;
                  if (!canViewExitBadge(user, isSelfCard)) return false;
                  const finalised = ex.status === "exited" || ex.status === "offboarded";
                  const lwdMs = ex.lastWorkingDay ? new Date(ex.lastWorkingDay).getTime() : 0;
                  const lwdPassed = lwdMs > 0 && Date.now() > lwdMs + 86400000;
                  return finalised || lwdPassed;
                })();
                return (
                <Link key={emp.id} href={`/dashboard/hr/people/${emp.id}`}
                  className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5 hover:border-[#008CFF]/30 transition-all group">
                  <div className="flex items-start gap-4 mb-4">
                    {/* Avatar */}
                    <div className={`relative w-14 h-14 rounded-full bg-gradient-to-br ${exMuted ? "from-slate-400 to-slate-500" : "from-cyan-500 to-blue-600"} flex items-center justify-center text-slate-800 dark:text-white text-lg font-bold overflow-hidden ring-2 ring-white/[0.06] shrink-0`}>
                      {emp.profilePictureUrl ? <img src={emp.profilePictureUrl} className={`w-full h-full object-cover${exMuted ? " grayscale opacity-55" : ""}`} alt="" referrerPolicy="no-referrer" /> : emp.name?.charAt(0)}
                      {/* Crossed-out overlay — marks the person as no
                          longer with the company, matching the muted
                          avatar treatment. */}
                      {exMuted && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/25">
                          <X size={20} strokeWidth={3} className="text-white drop-shadow" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white truncate group-hover:text-[#008CFF] transition-colors">{emp.name}</h3>
                        {/* Exit-lifecycle badge — "On Notice"
                            (amber) → "Exited" (slate) once the LWD
                            passes or HR finalises. Gated to HR team
                            + developer + self via canViewExitBadge. */}
                        {(() => {
                          const ex = emp.employeeExit;
                          if (!ex || !ex.status) return null;
                          const isSelfCard = user?.dbId != null && Number(user.dbId) === emp.id;
                          if (!canViewExitBadge(user, isSelfCard)) return null;
                          const finalised = ex.status === "exited" || ex.status === "offboarded";
                          const lwdMs = ex.lastWorkingDay ? new Date(ex.lastWorkingDay).getTime() : 0;
                          const lwdPassed = lwdMs > 0 && Date.now() > lwdMs + 86400000;
                          const isExited = finalised || lwdPassed;
                          return isExited ? (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-slate-700 ring-1 ring-inset ring-slate-300"
                              title={ex.lastWorkingDay ? `Exited on ${String(ex.lastWorkingDay).slice(0, 10)}` : "Exited"}
                            >
                              <span className="inline-block h-1 w-1 rounded-full bg-slate-500" />
                              Exited
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                              title={ex.lastWorkingDay ? `Last working day: ${String(ex.lastWorkingDay).slice(0, 10)}` : "On notice"}
                            >
                              <span className="inline-block h-1 w-1 rounded-full bg-amber-500" />
                              On Notice
                            </span>
                          );
                        })()}
                        {/* Probation badge (blue) — within the probation window,
                            not confirmed, active, and not exiting. */}
                        {(() => {
                          const ep = emp.employeeProfile as any;
                          if (!ep?.probationEndDate || ep.probationConfirmedAt) return null;
                          if (emp.isActive === false || emp.employeeExit) return null;
                          const endMs = new Date(`${String(ep.probationEndDate).slice(0, 10)}T00:00:00Z`).getTime();
                          if (!(endMs >= Date.now() - 86_400_000)) return null;
                          const endLabel = new Date(endMs).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
                          return (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200"
                              title={`Probation ends ${endLabel}`}
                            >
                              <span className="inline-block h-1 w-1 rounded-full bg-blue-500" />
                              On Probation
                            </span>
                          );
                        })()}
                        {/* PIP badge (rose) — on a performance plan: started,
                            not ended (or open-ended), active, not exiting. */}
                        {(() => {
                          const ep = emp.employeeProfile as any;
                          if (!ep?.pipStartedAt) return null;
                          if (emp.isActive === false || emp.employeeExit) return null;
                          if (ep.pipEndDate) {
                            const endMs = new Date(`${String(ep.pipEndDate).slice(0, 10)}T00:00:00Z`).getTime();
                            if (!(endMs >= Date.now() - 86_400_000)) return null;
                          }
                          return (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-rose-700 ring-1 ring-inset ring-rose-200"
                              title="On Performance Improvement Plan"
                            >
                              <span className="inline-block h-1 w-1 rounded-full bg-rose-500" />
                              On PIP
                            </span>
                          );
                        })()}
                        <span className="text-slate-600 text-sm cursor-pointer ml-auto">⋯</span>
                      </div>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400 truncate">{emp.employeeProfile?.designation || getUserRoleLabel(emp.role)}</p>
                    </div>
                  </div>

                  {/* Info Rows */}
                  <div className="space-y-1.5">
                    {emp.employeeProfile?.department && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Department :</span>
                        <span className="text-[11px] text-[#008CFF] font-medium">{emp.employeeProfile.department}</span>
                      </div>
                    )}
                    {(emp.employeeProfile?.jobLocation || emp.employeeProfile?.workLocation) && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Location :</span>
                        <span className="text-[11px] text-slate-800 dark:text-white">
                          {emp.employeeProfile.jobLocation || emp.employeeProfile.workLocation}
                        </span>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] text-slate-600 min-w-[80px]">Email :</span>
                      <span className="text-[11px] text-slate-800 dark:text-white truncate">{emp.email}</span>
                    </div>
                    {emp.employeeProfile?.phone && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Mobile :</span>
                        <span className="text-[11px] text-slate-800 dark:text-white">{emp.employeeProfile.phone}</span>
                      </div>
                    )}
                  </div>
                </Link>
                );
              })}
            </div>

            {filtered.length === 0 && (
              <div className="text-center py-16">
                <p className="text-[13px] text-slate-500">No employees found matching your filters</p>
              </div>
            )}
          </>
        )}

        {subTab === "tree" && <OrgTreeView />}
      </div>

      {/* Add Employee Wizard — 4-step Keka-style flow (Page 1 wired) */}
      {showAdd && (
        <AddEmployeeWizard
          onClose={() => setShowAdd(false)}
          onCreated={() => mutate("/api/hr/employees")}
        />
      )}
    </div>
  );
}
