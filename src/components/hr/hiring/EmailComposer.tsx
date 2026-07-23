"use client";

// Shared email composer for every HR hiring email flow.
//
// One component, one UX everywhere:
//   1. Template dropdown — pick from the verbatim NB Media templates
//      (Portfolio Required / Work Sample × 4 / Documents Request /
//      Offer Letter / etc.) OR custom blank.
//   2. To / CC / BCC / Subject / Body — all editable after picking.
//   3. Attachments — drag & drop or "Attach files" button. Multiple
//      files; size capped at 4 MB each (API matches).
//   4. **Preview** is the gate. The primary "Send" button opens a
//      preview modal showing exactly how the email will look (subject,
//      To/CC/BCC, body rendered with line breaks, attachment chips).
//      Only the "Confirm send" button inside the preview actually
//      fires the network call.
//
// The composer is presentation-only — it doesn't know about candidates
// or backend actions. Callers pass `onSend` and decide which API to
// hit (sendEmail / sendAssessment / archive / team-welcome).

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Eye, Paperclip, Send, X, FileText } from "lucide-react";
import {
  HR_TEMPLATE_OPTIONS,
  type HRTemplateKey,
  buildHRTemplate,
} from "@/lib/email/hr-templates";

// Same 4 MB cap as the API. Larger files are rejected client-side with
// a friendly error so HR doesn't have to wait for an upload to bounce.
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export type ComposerAttachment = {
  filename: string;
  contentType?: string;
  contentBase64: string;
  size: number; // bytes, for display
};

export type EmailComposerPayload = {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;     // raw plain text with \n — useful for activity logs / search
  bodyHtml: string; // HTML-escaped + line-broken — safe to pass straight to the API
  attachments: ComposerAttachment[];
};

export default function EmailComposer({
  candidateName,
  jobRole,
  defaultTo,
  defaultTemplateKey,
  // Whether to show the template dropdown. Off when the caller has
  // already pre-baked the body (e.g. Schedule Interview, which fills
  // body from the Round template based on toggles outside the composer).
  showTemplatePicker = true,
  // Whether the recipient field is editable. Off when the recipient
  // is fixed (Team Welcome → entire team list rendered elsewhere).
  recipientEditable = true,
  // Optional CC/BCC seed values + visibility.
  defaultCc = "",
  defaultBcc = "",
  // Optional override: if the caller wants a different subject/body
  // than the template would produce (Schedule Interview passes the
  // round-specific body in here).
  initialSubject,
  initialBody,
  // Pre-seeded attachments (e.g. the Team Welcome new-joiner photo).
  // Merged into the attachment list; HR can still add/remove more.
  initialAttachments,
  // Where this composer lives — affects only the submit button label.
  context = "email",
  submitLabel,
  // Show an always-visible rendered preview under the editor (used by the
  // Team Welcome flow so HR can cross-check the email live while editing).
  livePreview = false,
  onCancel,
  onSend,
}: {
  candidateName: string;
  jobRole: string;
  defaultTo: string;
  defaultTemplateKey?: HRTemplateKey;
  showTemplatePicker?: boolean;
  recipientEditable?: boolean;
  defaultCc?: string;
  defaultBcc?: string;
  initialSubject?: string;
  initialBody?: string;
  initialAttachments?: ComposerAttachment[];
  context?: "email" | "assessment" | "archive" | "interview" | "team_welcome";
  submitLabel?: string;
  livePreview?: boolean;
  onCancel: () => void;
  onSend: (payload: EmailComposerPayload) => Promise<void>;
}) {
  const initialTemplateKey: HRTemplateKey = defaultTemplateKey ?? "custom";
  const initialTpl = buildHRTemplate(initialTemplateKey, { candidateName, jobRole });

  const [tplKey,    setTplKey]    = useState<HRTemplateKey>(initialTemplateKey);
  const [to,        setTo]        = useState(defaultTo);
  const [cc,        setCc]        = useState(defaultCc);
  const [bcc,       setBcc]       = useState(defaultBcc);
  const [showCc,    setShowCc]    = useState(!!defaultCc);
  const [showBcc,   setShowBcc]   = useState(!!defaultBcc);
  const [subject,   setSubject]   = useState(initialSubject ?? initialTpl.subject);
  const [body,      setBody]      = useState(initialBody ?? initialTpl.body);
  const [files,     setFiles]     = useState<ComposerAttachment[]>(initialAttachments ?? []);
  const [preview,   setPreview]   = useState(false);
  const [sending,   setSending]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyTemplate = (next: HRTemplateKey) => {
    setTplKey(next);
    const t = buildHRTemplate(next, { candidateName, jobRole });
    setSubject(t.subject);
    setBody(t.body);
  };

  const splitEmails = (s: string) =>
    s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

  const readFileAsBase64 = (f: File): Promise<string> => new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const result = String(reader.result ?? "");
      // FileReader gives data URL — strip the "data:...;base64," prefix.
      const idx = result.indexOf(",");
      res(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => rej(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(f);
  });

  const handleFiles = async (list: FileList | File[]) => {
    setError(null);
    const arr = Array.from(list);
    const next: ComposerAttachment[] = [];
    for (const f of arr) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        setError(`"${f.name}" is larger than 4 MB — pick a smaller file.`);
        continue;
      }
      try {
        const b64 = await readFileAsBase64(f);
        next.push({ filename: f.name, contentType: f.type || undefined, contentBase64: b64, size: f.size });
      } catch (e: any) {
        setError(`Couldn't read "${f.name}": ${e?.message ?? "unknown error"}`);
      }
    }
    if (next.length) setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  // Merge externally-provided attachments (e.g. the Team Welcome new-joiner
  // photo, chosen after mount) without clobbering files HR added manually.
  useEffect(() => {
    if (!initialAttachments?.length) return;
    setFiles((prev) => {
      const have = new Set(prev.map((f) => `${f.filename}:${f.size}`));
      const add = initialAttachments.filter((a) => !have.has(`${a.filename}:${a.size}`));
      return add.length ? [...prev, ...add] : prev;
    });
  }, [initialAttachments]);

  const tryPreview = () => {
    setError(null);
    if (recipientEditable && !to.trim()) { setError("Recipient required"); return; }
    if (!subject.trim())                 { setError("Subject required"); return; }
    if (!body.trim())                    { setError("Body required"); return; }
    setPreview(true);
  };

  const confirmSend = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend({
        to: to.trim(),
        cc:  splitEmails(cc),
        bcc: splitEmails(bcc),
        subject: subject.trim(),
        body,
        bodyHtml: escapeHtml(body).replace(/\n/g, "<br/>"),
        attachments: files,
      });
      setPreview(false);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't send email");
    } finally {
      setSending(false);
    }
  };

  const sendLabel = submitLabel ?? (sending ? "Sending…" :
    context === "assessment" ? "Send assessment" :
    context === "archive"    ? "Send & archive" :
    context === "interview"  ? "Send & schedule" :
    "Send email");

  return (
    <div className="space-y-3">
      {showTemplatePicker && (
        <Field label="Template">
          <div className="relative">
            <select
              value={tplKey}
              onChange={(e) => applyTemplate(e.target.value as HRTemplateKey)}
              className="appearance-none w-full h-10 pl-3 pr-9 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
            >
              {HR_TEMPLATE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <p className="mt-1 text-[10.5px] text-slate-400">
            Verbatim wording from NB Media's HR template document. Pick one, then edit before sending.
          </p>
        </Field>
      )}

      {recipientEditable && (
        <Field label="To">
          <div className="relative">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value.toLowerCase())}
              type="email"
              className="w-full h-10 pl-3 pr-24 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 text-[11px] font-semibold">
              {!showCc  && <button type="button" onClick={() => setShowCc(true)}  className="text-[#3b82f6] hover:underline">CC</button>}
              {!showBcc && <button type="button" onClick={() => setShowBcc(true)} className="text-[#3b82f6] hover:underline">BCC</button>}
            </div>
          </div>
        </Field>
      )}
      {showCc && (
        <Field label="CC">
          <input value={cc} onChange={(e) => setCc(e.target.value.toLowerCase())} placeholder="email1, email2"
            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
        </Field>
      )}
      {showBcc && (
        <Field label="BCC">
          <input value={bcc} onChange={(e) => setBcc(e.target.value.toLowerCase())} placeholder="email1, email2"
            className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
        </Field>
      )}

      <Field label="Subject">
        <input value={subject} onChange={(e) => setSubject(e.target.value)}
          className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
      </Field>

      <Field label="Body">
        {/* Times New Roman: matches the visual signature of the
            sent email body + NB Media's printed letterhead, so
            HR sees the message in the typeface candidates will
            receive it in. */}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12}
          style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
        <p className="mt-1 text-[10.5px] text-slate-400">Plain text — line breaks become &lt;br&gt; in the sent email.</p>
      </Field>

      <Field label="Attachments">
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files); }}
          className="rounded-lg border border-dashed border-slate-300 p-3 hover:border-[#3b82f6] hover:bg-blue-50/30 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-slate-500">
              Drop files here, or <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[#3b82f6] font-semibold hover:underline">browse</button>. Max 4 MB each.
            </p>
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-slate-200 bg-white hover:border-[#3b82f6] text-[11.5px] font-semibold text-slate-700">
              <Paperclip size={12} /> Attach
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple hidden
            onChange={(e) => { if (e.target.files?.length) void handleFiles(e.target.files); e.target.value = ""; }} />
          {files.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-200">
                  <span className="flex items-center gap-2 min-w-0">
                    <FileText size={12} className="text-slate-400 shrink-0" />
                    <span className="truncate text-[12px] text-slate-800">{f.filename}</span>
                    <span className="text-[10.5px] text-slate-400 shrink-0">{formatBytes(f.size)}</span>
                  </span>
                  <button type="button" onClick={() => removeFile(i)}
                    className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Field>

      {livePreview && (
        <Field label="Live preview — exactly what the team receives">
          <div className="rounded-lg border border-slate-200 bg-white p-4" style={{ fontFamily: '"Times New Roman", Georgia, serif' }}>
            <p className="mb-2 border-b border-slate-100 pb-2 text-[13.5px] font-semibold text-slate-900">{subject || "(no subject)"}</p>
            <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700">{body || "(empty body)"}</div>
            {files.some((f) => f.contentType?.startsWith("image/")) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {files.filter((f) => f.contentType?.startsWith("image/")).map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={`data:${f.contentType};base64,${f.contentBase64}`} alt={f.filename} className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600">
                    <Paperclip size={10} /> {f.filename}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Field>
      )}

      {error && (
        <p className="text-[12px] text-rose-600">{error}</p>
      )}

      <div className="-mx-5 -mb-5 mt-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-2">
        <button onClick={onCancel} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">Cancel</button>
        <button onClick={tryPreview}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold shadow-sm">
          <Eye size={13} /> Preview & send
        </button>
      </div>

      {preview && (
        <PreviewModal
          to={to}
          cc={splitEmails(cc)}
          bcc={splitEmails(bcc)}
          subject={subject}
          body={body}
          attachments={files}
          sending={sending}
          error={error}
          submitLabel={sendLabel}
          onClose={() => setPreview(false)}
          onConfirm={confirmSend}
        />
      )}
    </div>
  );
}

function PreviewModal({
  to, cc, bcc, subject, body, attachments, sending, error, submitLabel,
  onClose, onConfirm,
}: {
  to: string; cc: string[]; bcc: string[];
  subject: string; body: string;
  attachments: ComposerAttachment[];
  sending: boolean; error: string | null; submitLabel: string;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[88vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Preview email</h3>
            <p className="text-[11px] text-slate-500">Review carefully — this is exactly what the recipient will see.</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <HeaderRow label="To"      value={to} />
          {cc.length  > 0 && <HeaderRow label="CC"  value={cc.join(", ")} />}
          {bcc.length > 0 && <HeaderRow label="BCC" value={bcc.join(", ")} />}
          <HeaderRow label="Subject" value={subject} bold />

          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-2">Body</p>
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-[13px] leading-[1.55] text-slate-800"
              // Body is HR-typed plain text; escape any HTML the user
              // might have pasted (script tags, etc.) before converting
              // line breaks to <br/> so the preview renders as text-only.
              dangerouslySetInnerHTML={{ __html: escapeHtml(body).replace(/\n/g, "<br/>") }} />
          </div>

          {attachments.length > 0 && (
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-2">Attachments ({attachments.length})</p>
              <ul className="space-y-1.5">
                {attachments.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-[12px] text-slate-800">
                    <FileText size={12} className="text-slate-400" />
                    <span className="truncate">{f.filename}</span>
                    <span className="ml-auto text-[10.5px] text-slate-400">{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error && (
          <p className="px-5 pb-2 text-[12px] text-rose-600">{error}</p>
        )}

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={sending}
            className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">
            Back to edit
          </button>
          <button onClick={onConfirm} disabled={sending}
            className="inline-flex items-center gap-1.5 h-9 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm">
            <Send size={13} /> {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function HeaderRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 text-[13px]">
      <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 w-16 shrink-0">{label}</span>
      <span className={`text-slate-800 break-words ${bold ? "font-semibold" : ""}`}>{value}</span>
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

function formatBytes(n: number): string {
  if (n < 1024)       return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Plain-text-safe HTML escape. Used in the preview pane so a stray
// "<script>" / ">" / "&" pasted into the body doesn't render as HTML.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
