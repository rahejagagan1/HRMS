"use client";

// JobShareDialog — minimal share modal. One URL HR can copy, plus
// pre-filled share buttons for the platforms HR uses to post openings
// (LinkedIn / WhatsApp / Email). Everything else (careers-index URL,
// iframe embeds, JSON feed) was clutter and got pulled out.
//
// Portaled to document.body so it escapes any parent clipping.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Check, X, ExternalLink, Mail, MessageCircle, Send, Share2 } from "lucide-react";

export default function JobShareDialog({
  job,
  baseUrl,
  onClose,
}: {
  job: { id: number; title: string; slug: string | null; brand: string | null };
  baseUrl: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied]   = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const publicUrl = job.slug ? `${baseUrl}/jobs/${job.slug}` : "";

  const shareText = `We're hiring — ${job.title}. Apply here:`;
  const shareTargets = publicUrl ? [
    { key: "linkedin", label: "LinkedIn", icon: Share2,        href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(publicUrl)}` },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${publicUrl}`)}` },
    { key: "email",    label: "Email",    icon: Mail,          href: `mailto:?subject=${encodeURIComponent(`We're hiring — ${job.title}`)}&body=${encodeURIComponent(`Hi,\n\n${shareText}\n\n${publicUrl}`)}` },
    { key: "twitter",  label: "X",        icon: Send,          href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(publicUrl)}` },
  ] : [];

  const copy = async () => {
    try { await navigator.clipboard.writeText(publicUrl); }
    catch {
      // Old browser fallback — execCommand path. Works under iframe sandboxes too.
      const ta = document.createElement("textarea");
      ta.value = publicUrl;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-[14.5px] font-semibold text-slate-900 truncate">Share this job</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-[12px] text-slate-500">
            <span className="font-semibold text-slate-700">{job.title}</span>
          </p>

          {!publicUrl ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-3 text-[12px] text-amber-800">
              This job doesn't have a public link yet — publish it first.
            </div>
          ) : (
            <>
              {/* The ONE link */}
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={publicUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[12.5px] text-slate-800"
                />
                <button
                  onClick={copy}
                  className="h-10 px-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0"
                >
                  {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>

              {/* Quick-share row */}
              <div className="grid grid-cols-4 gap-2">
                {shareTargets.map((t) => {
                  const Icon = t.icon;
                  return (
                    <a
                      key={t.key}
                      href={t.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Share via ${t.label}`}
                      className="inline-flex flex-col items-center justify-center gap-1 h-16 rounded-lg border border-slate-200 hover:border-[#3b82f6] hover:bg-blue-50/40 hover:text-[#3b82f6] text-slate-600 text-[10.5px] font-semibold transition-colors"
                    >
                      <Icon size={16} />
                      {t.label}
                    </a>
                  );
                })}
              </div>

              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#3b82f6] hover:underline"
              >
                <ExternalLink size={12} /> Preview public page
              </a>
            </>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-end">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold"
          >Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
