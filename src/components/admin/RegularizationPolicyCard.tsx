"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { ShieldCheck, Clock, AlertCircle } from "lucide-react";

// Org-wide policy: enforce the 2-day regularization window or not.
// When OFF, employees can self-apply for any past IST date. Reads/writes
// /api/hr/policy/regularization-window (backed by SyncConfig).
type RegularizationPolicy = {
  enabled: boolean;
  updatedById: number | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

export default function RegularizationPolicyCard() {
  const { data, isLoading, mutate: refetch } = useSWR<RegularizationPolicy>(
    "/api/hr/policy/regularization-window",
    fetcher,
    { revalidateOnFocus: false },
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const enabled = data?.enabled ?? true;

  const flip = async () => {
    setErr("");
    setSaving(true);
    try {
      const res = await fetch("/api/hr/policy/regularization-window", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update policy");
      await refetch();
    } catch (e: any) {
      setErr(e?.message || "Failed to update policy");
    } finally {
      setSaving(false);
    }
  };

  const updatedLine = data?.updatedAt
    ? `Last changed by ${data.updatedByName ?? "Unknown"} · ${new Date(data.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "Default · never changed";

  return (
    <div className="relative overflow-hidden bg-white dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.08] rounded-2xl shadow-sm">
      <div
        aria-hidden
        className={`absolute left-0 top-0 bottom-0 w-1 transition-colors ${
          enabled ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      <div className="flex items-start justify-between gap-6 p-5 pl-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center justify-center h-7 w-7 rounded-lg ${
              enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
            }`}>
              <ShieldCheck size={14} strokeWidth={2.5} />
            </div>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">
              Regularization 2-Day Window
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset ${
                enabled
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30"
                  : "bg-amber-50  text-amber-700  ring-amber-500/20  dark:bg-amber-500/10  dark:text-amber-400  dark:ring-amber-500/30"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-amber-500"}`} />
              {enabled ? "Enforced" : "Disabled"}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400 max-w-[680px]">
            {enabled
              ? "Employees can self-apply for regularization within 2 IST days after the missed date. Older dates require an HR admin grant."
              : "Employees can self-apply for regularization for ANY past IST date. Future dates and the monthly quota of 2 still apply."}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
            <Clock size={11} strokeWidth={2} />
            <span>{updatedLine}</span>
          </div>
          {err && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-red-600 bg-red-500/10 ring-1 ring-inset ring-red-500/20 px-2 py-1 rounded">
              <AlertCircle size={12} />
              {err}
            </p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-center gap-1.5 pt-1">
          <button
            type="button"
            role="switch"
            onClick={flip}
            disabled={saving || isLoading}
            aria-checked={enabled}
            aria-label={enabled ? "Disable 2-day window" : "Enable 2-day window"}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ring-1 ring-inset disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-[#001529] ${
              enabled
                ? "bg-emerald-500 ring-emerald-600/20 focus:ring-emerald-500"
                : "bg-slate-200 dark:bg-white/[0.08] ring-slate-300/60 dark:ring-white/[0.06] focus:ring-slate-400"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span
            className={`text-[10.5px] font-bold uppercase tracking-wider transition-colors ${
              saving
                ? "text-slate-400"
                : enabled
                ? "text-emerald-600"
                : "text-slate-400 dark:text-slate-500"
            }`}
          >
            {saving ? "Saving…" : enabled ? "On" : "Off"}
          </span>
        </div>
      </div>
    </div>
  );
}
