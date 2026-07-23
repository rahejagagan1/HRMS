"use client";

// Org-wide WFH monthly quota policy. Lives on the /admin
// Attendance Policies tab next to the Regularization cards so
// every workspace-level attendance toggle is on one page.
//
// Two knobs:
//   1. Master ON/OFF — when off, the WFH request POST stops
//      capping. Employees can request unlimited days.
//   2. Per-brand quota — how many days/month each NB Media and
//      YT Labs employee gets credited at the start of the month
//      by the auto-credit cron.

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Home, Clock, AlertCircle } from "lucide-react";

type WfhPolicy = {
  limitEnabled: boolean;
  nbMediaQuota: number;
  ytLabsQuota:  number;
  updatedAt:    string | null;
  updatedByName: string | null;
};

export default function WfhPolicyCard() {
  const { data, isLoading, mutate: refetch } = useSWR<WfhPolicy>(
    "/api/hr/admin/wfh-policy",
    fetcher,
    { revalidateOnFocus: false },
  );
  const [savingField, setSavingField] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [nbDraft, setNbDraft] = useState<string>("");
  const [ytDraft, setYtDraft] = useState<string>("");

  const enabled = data?.limitEnabled ?? true;
  const nbValue = nbDraft !== "" ? Number(nbDraft) : (data?.nbMediaQuota ?? 2);
  const ytValue = ytDraft !== "" ? Number(ytDraft) : (data?.ytLabsQuota  ?? 3);

  const patch = async (body: Partial<WfhPolicy>, field: string) => {
    setErr(""); setSavingField(field);
    try {
      const res = await fetch("/api/hr/admin/wfh-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update policy");
      await refetch();
      if (field === "nb") setNbDraft("");
      if (field === "yt") setYtDraft("");
    } catch (e: any) {
      setErr(e?.message || "Failed to update policy");
    } finally {
      setSavingField(null);
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
          enabled ? "bg-emerald-500" : "bg-slate-400"
        }`}
      />
      <div className="flex items-start justify-between gap-6 p-5 pl-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center justify-center h-7 w-7 rounded-lg ${
              enabled ? "bg-[#008CFF]/10 text-[#008CFF]" : "bg-slate-500/10 text-slate-500"
            }`}>
              <Home size={14} strokeWidth={2.5} />
            </div>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">
              WFH Monthly Quota
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset ${
                enabled
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30"
                  : "bg-slate-100 text-slate-600 ring-slate-300/50 dark:bg-white/[0.05] dark:text-slate-400 dark:ring-white/[0.08]"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
              {enabled ? "Enforced" : "Disabled"}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400 max-w-[680px]">
            {enabled
              ? "Each employee is credited a fresh quota on the 1st of every month — NB Media and YT Labs get different amounts. Pending and approved requests both count against the monthly limit."
              : "WFH requests are NOT capped. Employees can request any number of WFH days per month. Per-brand quotas below are saved but inactive until you turn this on."}
          </p>

          {/* Per-brand numeric inputs — only operative when enabled */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-slate-200 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">NB Media</span>
                <span className="text-[10px] font-bold text-[#008CFF] bg-[#008CFF]/10 px-1.5 py-0.5 rounded">days/month</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0} max={31}
                  value={nbDraft !== "" ? nbDraft : String(data?.nbMediaQuota ?? 2)}
                  onChange={(e) => setNbDraft(e.target.value)}
                  disabled={!enabled || savingField === "nb"}
                  className="h-8 w-16 px-2 border border-slate-200 dark:border-white/[0.08] rounded-md text-[13px] font-bold text-slate-900 dark:text-white bg-white dark:bg-white/[0.02] tabular-nums text-center focus:outline-none focus:border-[#008CFF] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => patch({ nbMediaQuota: nbValue }, "nb")}
                  disabled={!enabled || savingField === "nb" || nbDraft === "" || nbValue === data?.nbMediaQuota}
                  className="h-8 px-2.5 rounded-md bg-[#008CFF] text-white text-[11px] font-semibold hover:bg-[#0070d4] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingField === "nb" ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">YT Labs</span>
                <span className="text-[10px] font-bold text-[#d4143d] bg-[#d4143d]/10 px-1.5 py-0.5 rounded">days/month</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0} max={31}
                  value={ytDraft !== "" ? ytDraft : String(data?.ytLabsQuota ?? 3)}
                  onChange={(e) => setYtDraft(e.target.value)}
                  disabled={!enabled || savingField === "yt"}
                  className="h-8 w-16 px-2 border border-slate-200 dark:border-white/[0.08] rounded-md text-[13px] font-bold text-slate-900 dark:text-white bg-white dark:bg-white/[0.02] tabular-nums text-center focus:outline-none focus:border-[#008CFF] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => patch({ ytLabsQuota: ytValue }, "yt")}
                  disabled={!enabled || savingField === "yt" || ytDraft === "" || ytValue === data?.ytLabsQuota}
                  className="h-8 px-2.5 rounded-md bg-[#008CFF] text-white text-[11px] font-semibold hover:bg-[#0070d4] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingField === "yt" ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>

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

        {/* Master enable/disable — same slide-toggle pattern as
            the Regularization cards so HR's mental model is one
            consistent shape across this whole tab. */}
        <div className="shrink-0 flex flex-col items-center gap-1.5 pt-1">
          <button
            type="button"
            role="switch"
            onClick={() => patch({ limitEnabled: !enabled }, "toggle")}
            disabled={savingField === "toggle" || isLoading}
            aria-checked={enabled}
            aria-label={enabled ? "Disable WFH limit" : "Enable WFH limit"}
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
              savingField === "toggle"
                ? "text-slate-400"
                : enabled
                ? "text-emerald-600"
                : "text-slate-400 dark:text-slate-500"
            }`}
          >
            {savingField === "toggle" ? "Saving…" : enabled ? "On" : "Off"}
          </span>
        </div>
      </div>
    </div>
  );
}
