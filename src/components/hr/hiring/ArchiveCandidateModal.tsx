"use client";

// Archive Candidate — Keka-parity modal. HR picks a canonical reason
// (Not Qualified / Position Filled / Out of Budget / etc.), optionally
// composes a closing email via the shared EmailComposer (which forces
// a preview before sending), and the action:
//   1. Moves the candidate to the rejected stage.
//   2. Persists reason + note + archivedAt on JobApplication.
//   3. Sends the closing email (if HR opted in).
//   4. Adds an `archived` row to CandidateActivity.
// All of that is one backend call to action="archive".

import { useEffect, useState } from "react";
import { mutate as globalMutate } from "swr";
import { showToast } from "@/components/ui/Toast";
import { X, ChevronDown, AlertCircle } from "lucide-react";
import { rejectionEmail, overQualifiedEmail, underQualifiedEmail } from "@/lib/email/hr-templates";
import EmailComposer, { type EmailComposerPayload } from "./EmailComposer";

interface Candidate {
  id: number;
  fullName: string;
  email: string;
  roleTitle: string | null;
}

// Canonical archive reasons — match the Keka list shown in the
// reference screenshots so HR reports can group cleanly across both
// systems if/when imports happen.
export const ARCHIVE_REASONS = [
  "Not Qualified",
  "Candidate Not Interested",
  "Candidate Not Reachable",
  "Not Suitable",
  "Not Fit for the current need",
  "Over Qualified",
  "Under Qualified",
  "Out of Budget",
  "Position Filled",
  "No Relocation",
  "Sample not Submitted",
  "Sample rejected",
  "Resume Missing",
  "Failed in Background Check",
  "Declined Offer",
  "Candidate backout",
  "Didn't accept the offer",
  "Documents not matched",
  "Missing Documents",
  "Retained by current employer",
  "Negative Feedback",
];

export default function ArchiveCandidateModal({
  candidate, onClose, onDone,
}: {
  candidate: Candidate;
  onClose: () => void;
  onDone?: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const role = candidate.roleTitle ?? "the role";

  const [reason, setReason]   = useState(ARCHIVE_REASONS[4]); // Not Fit
  const [note,   setNote]     = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving]   = useState(false);

  // Reason-specific email body. "Over Qualified" / "Under Qualified" get
  // tailored wording HR provided 2026-06-18; everything else falls back
  // to the generic rejection template.
  const tpl = (() => {
    const args = { candidateName: candidate.fullName, jobRole: role };
    if (reason === "Over Qualified")  return overQualifiedEmail(args);
    if (reason === "Under Qualified") return underQualifiedEmail(args);
    return rejectionEmail(args);
  })();

  // "Archive without email" path — runs when HR unchecks the closing
  // email checkbox. Single backend hit, no email.
  const archiveOnly = async () => {
    if (!reason) return showToast("Pick a reason", "error");
    setSaving(true);
    const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "archive",
        reason,
        note: note.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j?.error || "Couldn't archive candidate", "error");
      return;
    }
    globalMutate("/api/hr/hiring/candidates");
    onDone?.();
    onClose();
  };

  // EmailComposer "Send & archive" path. The composer enforces preview
  // before this runs.
  const archiveAndEmail = async (p: EmailComposerPayload) => {
    if (!reason) throw new Error("Pick a reason");
    const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "archive",
        reason,
        note: note.trim() || null,
        subject: p.subject,
        body:    p.bodyHtml,
        cc:      p.cc,
        bcc:     p.bcc,
        attachments: p.attachments.map(({ filename, contentType, contentBase64 }) =>
          ({ filename, contentType, contentBase64 })),
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || "Couldn't archive candidate");
    }
    globalMutate("/api/hr/hiring/candidates");
    onDone?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[680px] bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-slate-900 truncate">Archive {candidate.fullName}</h3>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-[12px] text-rose-700 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              Archiving moves the candidate to the rejected stage. Their history stays — you can roll back later from the archived view.
            </span>
          </div>

          <Field label="Reason for archiving">
            <div className="relative">
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="appearance-none w-full h-10 pl-3.5 pr-9 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
              >
                {ARCHIVE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          <Field label="Internal note (optional, not sent to candidate)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything the team should know about this archive decision."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
            />
          </Field>

          <label className="inline-flex items-center gap-2.5 text-[12.5px] text-slate-700 cursor-pointer">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-[#3b82f6]" />
            Send a closing email to the candidate
          </label>

          {sendEmail ? (
            <div className="rounded-xl border border-slate-200 p-4">
              {/* key={reason} remounts the composer when HR changes the
                  archive reason, so the new reason-specific body is
                  picked up (initialSubject/initialBody are only read on
                  mount). Without this, switching from "Not Fit" to
                  "Over Qualified" would keep the old body. */}
              <EmailComposer
                key={reason}
                candidateName={candidate.fullName}
                jobRole={role}
                defaultTo={candidate.email}
                initialSubject={tpl.subject}
                initialBody={tpl.body}
                showTemplatePicker={false}
                context="archive"
                submitLabel="Send & archive"
                onCancel={onClose}
                onSend={archiveAndEmail}
              />
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">Cancel</button>
              <button onClick={archiveOnly} disabled={saving}
                className="h-9 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm">
                {saving ? "Archiving…" : "Confirm archive (no email)"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
