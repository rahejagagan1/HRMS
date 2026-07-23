"use client";

// Schedule a future reporting-manager change for an employee. Shown
// under the Reporting Manager field in Edit Profile → Job & Work.
// Pick the incoming manager (searchable) + an effective date; the
// `reporting_manager_changes` cron flips User.managerId on that date.
// One pending change at a time — scheduling a new one replaces it.
// The form is always visible (no collapse) until a change is pending,
// at which point it's replaced by the pending row.

import { useEffect, useState } from "react";
import { CalendarClock, X, ArrowRight } from "lucide-react";
import SelectField from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/date-field";
import { showToast } from "@/components/ui/Toast";

type Pending = {
  id: number;
  newManagerId: number;
  newManagerName: string | null;
  effectiveDate: string; // YYYY-MM-DD
};

function fmt(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

// Tomorrow (local) as YYYY-MM-DD — earliest pickable effective date.
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ScheduleManagerChange({
  userId,
  currentManagerName,
  managerOpts,
}: {
  userId: number;
  currentManagerName: string | null;
  managerOpts: Array<{ id: number; name: string }>;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(true);
  const [newManagerId, setNewManagerId] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/people/${userId}/manager-change`);
      if (res.ok) {
        const j = await res.json();
        setPending(j?.pending ?? null);
      }
    } catch {
      /* ignore — control just shows the empty form */
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const schedule = async () => {
    if (!newManagerId) return showToast("Pick the new reporting manager", "error");
    if (!date) return showToast("Pick an effective date", "error");
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/people/${userId}/manager-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newManagerId: Number(newManagerId), effectiveDate: date }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(j?.error || "Couldn't schedule the change", "error");
        setBusy(false);
        return;
      }
      setPending(j?.pending ?? null);
      setNewManagerId("");
      setDate("");
      showToast("Reporting-manager change scheduled", "success");
    } catch {
      showToast("Network error — try again", "error");
    }
    setBusy(false);
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/people/${userId}/manager-change`, { method: "DELETE" });
      if (res.ok) {
        setPending(null);
        showToast("Scheduled change cancelled", "success");
      } else {
        showToast("Couldn't cancel the scheduled change", "error");
      }
    } catch {
      showToast("Network error — try again", "error");
    }
    setBusy(false);
  };

  const opts = managerOpts.map((m) => ({ value: String(m.id), label: m.name }));

  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">
        Schedule a future change
      </label>

      {loading ? (
        <div className="flex items-center gap-2 h-9 text-[12px] text-slate-400">
          <CalendarClock size={14} className="text-slate-300" />
          <span>Checking for a scheduled change…</span>
        </div>
      ) : pending ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClock size={15} className="shrink-0 text-[#3b82f6]" />
            <p className="min-w-0 text-[12.5px] leading-snug text-slate-600">
              <span className="text-slate-500">
                {currentManagerName ?? "Current manager"}
              </span>
              <ArrowRight size={12} className="mx-1 inline-block align-[-1px] text-slate-400" />
              <span className="font-semibold text-slate-800">
                {pending.newManagerName ?? `#${pending.newManagerId}`}
              </span>
              <span className="text-slate-500"> · effective </span>
              <span className="font-semibold text-[#1e40af]">{fmt(pending.effectiveDate)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            aria-label="Cancel scheduled manager change"
            title="Cancel scheduled change"
            className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div role="group" aria-label="Schedule a future reporting-manager change" className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">
                New reporting manager
              </label>
              <SelectField
                value={newManagerId}
                onChange={setNewManagerId}
                placeholder="Select manager"
                options={opts}
              />
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">
                With effect from
              </label>
              <DateField value={date} onChange={setDate} min={tomorrowIso()} className="w-full" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-400 leading-snug">
              The reporting manager updates automatically on this date.
            </p>
            <button
              type="button"
              onClick={schedule}
              disabled={busy}
              className="shrink-0 h-9 px-4 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm transition-colors"
            >
              {busy ? "Scheduling…" : "Schedule change"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
