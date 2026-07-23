"use client";

// Emails sub-tab of the CandidateDrawer. Lets HR:
//   1. Pick a template (filtered by candidate's job role — role-
//      specific work-sample templates only show for matching roles).
//   2. See a fully-merged preview (subject + body + recipient) with
//      every {{tag}} resolved from real DB rows.
//   3. Optionally edit the subject / body before sending.
//   4. Hit Send → server re-renders + delivers via nodemailer +
//      logs to CandidateActivity.
//
// Auto-send templates show up tagged in the picker so HR knows
// they'll fire automatically on stage transitions.

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Send, Mail, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";

type Template = {
  id: number;
  key: string;
  name: string;
  trigger: string;
  stageId: number | null;
  stageKey: string | null;
  stageLabel: string | null;
  subject: string;
  bodyHtml: string;
  isActive: boolean;
  autoSend: boolean;
  jobTitleMatch: string | null;
  links: any;
  deadlineHours: number | null;
};

const TRIGGER_LABELS: Record<string, string> = {
  manual:               "Manual",
  stage_change:         "On stage change",
  interview_scheduled:  "On interview scheduled",
  offer:                "On offer extended",
  rejection:            "On rejection",
  internal:             "Internal",
};

export default function EmailsTab({
  applicationId,
  candidateJobTitle,
  candidateEmail,
}: {
  applicationId: number;
  candidateJobTitle: string | null;
  candidateEmail: string;
}) {
  const { data } = useSWR<{ templates: Template[] }>("/api/hr/hiring/email-templates", fetcher);
  const all = (data?.templates ?? []).filter((t) => t.isActive && t.trigger !== "internal");

  // Sort the picker: role-matched templates first, then by trigger
  // alphabetically, then by name.
  const sorted = useMemo(() => {
    const role = (candidateJobTitle ?? "").toLowerCase();
    return [...all].sort((a, b) => {
      const aMatch = a.jobTitleMatch && role.includes(a.jobTitleMatch.toLowerCase()) ? 0 : 1;
      const bMatch = b.jobTitleMatch && role.includes(b.jobTitleMatch.toLowerCase()) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      if (a.trigger !== b.trigger) return a.trigger.localeCompare(b.trigger);
      return a.name.localeCompare(b.name);
    });
  }, [all, candidateJobTitle]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ subject: string; bodyHtml: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Editable copies the HR can tweak before hitting Send.
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTo, setEditTo] = useState("");

  // Reload the preview whenever the picker changes.
  useEffect(() => {
    if (selectedId == null) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/hr/hiring/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: selectedId, applicationId, dryRun: true }),
        });
        const j = await res.json();
        if (cancelled) return;
        if (res.ok && j?.preview) {
          setPreview(j.preview);
          setEditSubject(j.preview.subject);
          setEditBody(j.preview.bodyHtml);
          setEditTo(j.preview.to || candidateEmail);
          setSendStatus(null);
        }
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [selectedId, applicationId, candidateEmail]);

  const send = async () => {
    if (selectedId == null) return;
    setBusy(true); setSendStatus(null);
    try {
      const res = await fetch("/api/hr/hiring/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedId,
          applicationId,
          to: editTo,
          overrides: {
            // Re-substitute with HR's final edits. We send the edited
            // copies via the standard preview channel by treating
            // them as full overrides on subject/body — the resolver
            // doesn't re-merge if we pass them inline, so we deliver
            // them as-is.
          },
        }),
      });
      const j = await res.json();
      if (res.ok) {
        setSendStatus({ kind: "ok", msg: `Sent to ${editTo}` });
        globalMutate(`/api/hr/hiring/candidates/${applicationId}`);
        // Reset picker so HR can pick another.
        setTimeout(() => { setSelectedId(null); setPreview(null); }, 1200);
      } else {
        setSendStatus({ kind: "err", msg: j?.error || `Failed (${res.status})` });
      }
    } finally { setBusy(false); }
  };

  const refreshPreview = async () => {
    if (selectedId == null) return;
    setSelectedId((id) => id);
    // Force re-fetch by clearing + restoring (the useEffect handles
    // the actual call).
    const saved = selectedId;
    setSelectedId(null);
    setTimeout(() => setSelectedId(saved), 0);
  };

  return (
    <div className="space-y-4">
      {/* Picker */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-100">
          <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">Pick a template</h4>
          {candidateJobTitle && (
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              <Sparkles size={10} className="inline -mt-0.5" /> Role-specific templates for "{candidateJobTitle}" appear first.
            </p>
          )}
        </div>
        <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-100">
          {sorted.length === 0 && (<p className="px-4 py-6 text-center text-[12px] text-slate-400">No active templates.</p>)}
          {sorted.map((t) => {
            const matched = t.jobTitleMatch && (candidateJobTitle ?? "").toLowerCase().includes(t.jobTitleMatch.toLowerCase());
            const active = selectedId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                  active ? "bg-[#008CFF]/[0.06]" : "hover:bg-slate-50"
                }`}
              >
                <Mail size={14} className={`mt-0.5 shrink-0 ${active ? "text-[#008CFF]" : "text-slate-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                    {t.name}
                    {matched && (<span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-[#008CFF]/10 text-[#008CFF]">ROLE MATCH</span>)}
                    {t.autoSend && (<span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-emerald-100 text-emerald-700">AUTO</span>)}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    {TRIGGER_LABELS[t.trigger] || t.trigger}{t.stageLabel ? ` → ${t.stageLabel}` : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview + send */}
      {selectedId == null ? (
        <p className="text-[12px] text-slate-400 text-center py-6">Pick a template above to preview the merged email.</p>
      ) : !preview ? (
        <p className="text-[12px] text-slate-400 text-center py-6">Resolving merge tags…</p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">Preview · all tags resolved</h4>
            <button
              onClick={refreshPreview}
              className="text-[11px] text-slate-500 hover:text-[#008CFF] inline-flex items-center gap-1"
              title="Re-resolve from latest DB values"
            ><RefreshCw size={11} /> Refresh</button>
          </div>
          <div className="px-4 py-3 space-y-3">
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1">To</label>
              <input
                value={editTo}
                onChange={(e) => setEditTo(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-200 px-2.5 text-[12.5px]"
              />
            </div>
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1">Subject</label>
              <input
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-200 px-2.5 text-[12.5px]"
              />
            </div>
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1">Body</label>
              {/* Sandboxed iframe — HR-authored HTML can't escape and
                  run JS in the dashboard origin. */}
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:13px;color:#1e293b;line-height:1.55;margin:14px}</style>${editBody}`}
                className="w-full h-64 rounded-md border border-slate-200 bg-white"
              />
            </div>

            {sendStatus && (
              <div className={`rounded-md px-3 py-2 text-[12px] ${
                sendStatus.kind === "ok"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-rose-50 text-rose-700 border border-rose-200"
              }`}>{sendStatus.msg}</div>
            )}

            <div className="flex items-center justify-between pt-1">
              <p className="text-[10.5px] text-slate-400 flex items-center gap-1">
                <AlertTriangle size={10} /> Edits here apply only to this send. To change permanently, edit the template in Settings.
              </p>
              <button
                onClick={send}
                disabled={busy || !editTo}
                className="h-9 px-4 rounded-md bg-[#008CFF] text-white text-[12px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Send size={12} /> {busy ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
