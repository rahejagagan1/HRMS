"use client";

// Single-purpose admin button on a LOCKED report that re-snapshots
// the team into the report's `teamSnapshot` column.
//
// Use case (manual historical-backfill flow):
//   1. Admin temporarily reverts User.managerId to match what the team
//      looked like during the report period.
//   2. Click this button — the locked report's snapshot is overwritten
//      with the CURRENT roster, locking in the historical truth.
//   3. Admin restores User.managerId back to today's reality.
//
// Backed by POST /api/reports/[managerId]/refresh-team-snapshot.
// SWR refresh is the caller's job — we mutate the report's URL on success.

import { useState } from "react";
import { mutate } from "swr";

type Period =
  | { kind: "monthly"; month: number; year: number }
  | { kind: "weekly"; week: number; month: number; year: number };

export default function RefreshTeamSnapshotButton({
  managerId,
  period,
  className = "",
}: {
  managerId: string;
  period: Period;
  className?: string;
}) {
  const [busy,  setBusy]  = useState(false);
  const [done,  setDone]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    const sure = window.confirm(
      "Refresh team snapshot?\n\n" +
      "This freezes the CURRENT team membership onto this locked report. " +
      "Use this when you've just restored User.managerId values to match " +
      "what the team looked like during this period — the snapshot will " +
      "lock in that historical truth.\n\n" +
      "Other report fields (sections, notes, numbers) are not changed.",
    );
    if (!sure) return;

    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch(`/api/reports/${managerId}/refresh-team-snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: period.kind,
          ...(period.kind === "weekly" ? { week: period.week } : {}),
          month: period.month,
          year:  period.year,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Refresh failed (${res.status})`);
        return;
      }
      setDone(true);
      // Invalidate the report's team-aware SWR keys so the UI re-fetches.
      if (period.kind === "weekly") {
        mutate(`/api/reports/${managerId}?week=${period.week}&month=${period.month}&year=${period.year}`);
      } else {
        mutate(`/api/reports/${managerId}?month=${period.month}&year=${period.year}`);
      }
      setTimeout(() => setDone(false), 3000);
    } catch (e: any) {
      setError(e?.message || "Refresh failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        title="Re-snapshot the current team into this locked report. Admin-only."
        className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-600 text-[12.5px] font-medium shadow-sm transition-colors"
      >
        {busy ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582M20 20v-5h-.581M5.582 9A7 7 0 0118.94 11M18.418 15A7 7 0 015.06 13" /></svg>
        )}
        {busy ? "Refreshing…" : done ? "Snapshot updated" : "Refresh team snapshot"}
      </button>
      {error && (
        <span className="text-[11.5px] text-rose-600 font-medium">{error}</span>
      )}
    </div>
  );
}
