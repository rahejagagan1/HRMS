"use client";

// Team Welcome — fired from the HR onboard page right after a new
// employee is successfully created. Renders the "Introducing X to the
// team" announcement as the formatted HTML it actually sends (centered
// paragraphs, bold key terms, mailto link, and the new joiner's photo
// embedded inline + centered). HR picks the photo, eyeballs the live
// preview, then sends to every active employee (BCC).
//
// The layout can't survive a plain-text editor, so this is a
// preview-and-send flow (not a free-text composer). The body is rendered
// from the joiner's structured fields via teamWelcomeEmailHtml — the same
// function the API uses server-side, so the preview matches the send.

import { useEffect, useMemo, useRef, useState } from "react";
import { X, ImagePlus, Loader2 } from "lucide-react";
import { teamWelcomeEmailHtml } from "@/lib/email/hr-templates";

export default function TeamWelcomeModal({
  newJoiner, onClose, onSent,
}: {
  newJoiner: {
    fullName:    string;
    firstName:   string;
    jobRole:     string;
    homeCity?:   string;
    priorRole?:  string;
    managerName?: string;
    managerId?:  number;
    officeLocation?: string;
    phone?:      string;
    workEmail:   string;
    pronoun?:    "he" | "she" | "they";
  };
  onClose: () => void;
  onSent?: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Optional new-joiner photo — embedded inline in the email so the team
  // can put a face to the name. Onboarding doesn't capture a photo, so HR
  // picks one here; it rides the inline-CID pipeline (cid:joinerPhoto).
  const [photo, setPhoto] = useState<{ filename: string; contentType: string; contentBase64: string; size: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // let HR re-pick the same file after removing
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { alert("Photo is larger than 4 MB — pick a smaller image."); return; }
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => { const s = String(r.result ?? ""); const i = s.indexOf(","); res(i >= 0 ? s.slice(i + 1) : s); };
        r.onerror = () => rej(r.error ?? new Error("read failed"));
        r.readAsDataURL(f);
      });
      setPhoto({ filename: f.name, contentType: f.type || "image/jpeg", contentBase64: b64, size: f.size });
    } catch { alert("Couldn't read that image — try another file."); }
  };

  const pronoun = newJoiner.pronoun ?? "they";
  const title = pronoun === "she" ? "Ms." : pronoun === "he" ? "Mr." : "";

  // Render the exact HTML the API will send. The picked photo shows as a
  // data: URI in the preview; on send the API swaps in cid:joinerPhoto.
  const preview = useMemo(() => teamWelcomeEmailHtml({
    newJoinerName:  newJoiner.fullName,
    firstName:      newJoiner.firstName,
    homeCity:       newJoiner.homeCity || undefined,
    priorRole:      newJoiner.priorRole || undefined,
    jobRole:        newJoiner.jobRole,
    managerName:    newJoiner.managerName || undefined,
    officeLocation: newJoiner.officeLocation || undefined,
    phone:          newJoiner.phone || undefined,
    workEmail:      newJoiner.workEmail,
    pronoun,
    title,
    photoSrc: photo ? `data:${photo.contentType};base64,${photo.contentBase64}` : undefined,
  }), [newJoiner, pronoun, title, photo]);

  const [subject, setSubject] = useState(preview.subject);

  const send = async () => {
    setSending(true); setError("");
    try {
      const res = await fetch("/api/hr/team/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          managerId: newJoiner.managerId,
          joiner: {
            fullName:       newJoiner.fullName,
            firstName:      newJoiner.firstName,
            jobRole:        newJoiner.jobRole,
            workEmail:      newJoiner.workEmail,
            homeCity:       newJoiner.homeCity,
            priorRole:      newJoiner.priorRole,
            managerName:    newJoiner.managerName,
            officeLocation: newJoiner.officeLocation,
            phone:          newJoiner.phone,
            pronoun,
          },
          photo: photo
            ? { filename: photo.filename, contentType: photo.contentType, contentBase64: photo.contentBase64 }
            : undefined,
        }),
      });
      if (!res.ok) {
        const jr = await res.json().catch(() => ({}));
        throw new Error(jr?.error || "Couldn't send team welcome");
      }
      onSent?.();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Couldn't send team welcome");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[680px] bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Welcome {newJoiner.firstName} to the team</h3>
            <p className="text-[11px] text-slate-500">
              Announces the new joiner to every active employee. Sent as BCC so the team list isn't exposed.
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* New-joiner photo — embeds inline in the email. */}
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
            {photo ? (
              <img src={`data:${photo.contentType};base64,${photo.contentBase64}`} alt={newJoiner.firstName} className="h-12 w-12 rounded-full object-cover ring-1 ring-slate-200" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-400"><ImagePlus size={18} /></span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-slate-800">{newJoiner.firstName}'s photo</p>
              <p className="text-[11px] text-slate-500">
                {photo ? `Embedded · ${Math.max(1, Math.round(photo.size / 1024))} KB` : "Optional — shows centered in the email so the team can put a face to the name."}
              </p>
            </div>
            {photo ? (
              <button type="button" onClick={() => setPhoto(null)} className="text-[11.5px] font-medium text-slate-500 hover:text-rose-600">Remove</button>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="h-8 px-3 rounded-lg bg-[#008CFF] text-white text-[11.5px] font-semibold hover:bg-[#0070cc] transition-colors">Choose photo</button>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full h-9 px-3 bg-white border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#008CFF]/60"
            />
          </div>

          {/* Live preview — exactly what sends */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Preview</label>
            <div className="mt-1 rounded-xl border border-slate-200 overflow-hidden">
              <div className="max-h-[420px] overflow-y-auto bg-white px-4 py-4"
                   dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              This is exactly what the team receives. Wording follows the approved template; pick a photo to add it inline.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-50 text-rose-600 text-[12px] ring-1 ring-rose-200">
              <X size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400">Sends to all active employees (BCC)</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={sending}
              className="h-9 px-4 text-[13px] font-medium text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={send} disabled={sending}
              className="h-9 px-5 inline-flex items-center gap-2 bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-50 text-white rounded-lg text-[13px] font-semibold">
              {sending && <Loader2 size={14} className="animate-spin" />}
              {sending ? "Sending..." : "Send to team"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
