"use client";

// Contact button in the sticky nav. On click, opens a small popover
// that DISPLAYS the HR email address + a one-click copy button +
// a "Open in mail app" link. We don't rely on `mailto:` alone
// because many Windows users have no default mail client set, and
// the link silently no-ops with no feedback.

import { useEffect, useRef, useState } from "react";
import { Mail, Copy, Check, X } from "lucide-react";

export default function ContactButton({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Click-outside / Esc closes the popover.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current || !btnRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      if (btnRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can fail on insecure origins / older browsers;
      // fall back to a hidden input + execCommand.
      const ta = document.createElement("textarea");
      ta.value = email;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
      finally { document.body.removeChild(ta); }
    }
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[12.5px] font-semibold transition-colors"
      >
        <Mail size={13} /> Contact
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Contact details"
          className="absolute right-0 top-full mt-2 z-50 w-[280px] rounded-xl bg-white shadow-[0_18px_44px_-12px_rgba(15,23,42,0.25)] ring-1 ring-slate-200 overflow-hidden"
        >
          <div className="px-4 pt-4 pb-3 border-b border-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-[0.12em] font-bold text-slate-400">Email HR</p>
                <p className="text-[14px] font-semibold text-slate-900 break-all leading-tight mt-1">
                  {email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-slate-100">
            <button
              type="button"
              onClick={copy}
              className="h-11 inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {copied ? (<><Check size={13} className="text-emerald-600" /> Copied!</>)
                      : (<><Copy size={13} /> Copy email</>)}
            </button>
            {/* Gmail web compose URL ALWAYS works (browser, mobile
                Gmail app via deep link) — unlike `mailto:` which
                silently fails when there's no default mail handler.
                Holding Ctrl/Cmd-click still lets power users get
                the mailto: behaviour via a long-press menu. */}
            <a
              href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="h-11 inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-[#008CFF] hover:bg-slate-50 transition-colors"
            >
              <Mail size={13} /> Open in Gmail
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
