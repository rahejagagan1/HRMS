"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import LeaveSummary from "@/components/hr/leave/LeaveSummary";

// Read-only mirror of an employee's personal Leave page, shown to HR inside
// the employee profile (Attendance → Leave sub-view). Renders the SAME shared
// <LeaveSummary> the employee sees on their own side — but for the selected
// user. HR gets per-leave row actions (Cancel leave / Change leave type) via
// the ⋮ menu; the underlying APIs enforce HR-admin permission server-side.

export default function EmployeeLeavePanel({ userId, userName }: { userId: number; userName: string }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const years = [nowYear, nowYear - 1, nowYear - 2];

  const appsKey = `/api/hr/leaves?userId=${userId}`;
  const balKey  = `/api/hr/leaves/balance?userId=${userId}&year=${year}`;
  const { data: balances = [] } = useSWR(balKey, fetcher);
  const { data: applications = [] } = useSWR(appsKey, fetcher);
  const { data: leaveTypes = [] } = useSWR("/api/hr/leaves/types", fetcher);

  // Refresh the leave list + balances after an HR action (cancel restores
  // the balance; a type change moves the debit between balance buckets).
  const refresh = () => { mutate(appsKey); mutate(balKey); };

  const cancelLeave = async (id: number) => {
    if (!confirm("Cancel this leave for the employee? This restores the deducted balance.")) return;
    const res = await fetch(`/api/hr/leaves/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j?.error || "Could not cancel the leave."); return; }
    refresh();
  };

  const changeType = async (id: number, leaveTypeId: number) => {
    const res = await fetch(`/api/hr/leaves/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", leaveTypeId }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j?.error || "Could not change the leave type."); return; }
    refresh();
  };

  return (
    <LeaveSummary
      balances={balances as any[]}
      applications={applications as any[]}
      year={year}
      years={years}
      onYearChange={setYear}
      readOnly
      subjectName={userName}
      manageActions
      leaveTypes={(Array.isArray(leaveTypes) ? leaveTypes : []).map((t: any) => ({ id: t.id, name: t.name }))}
      onCancelLeave={cancelLeave}
      onChangeType={changeType}
    />
  );
}
