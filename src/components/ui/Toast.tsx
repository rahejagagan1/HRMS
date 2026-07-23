"use client";

// Lightweight global toast. No context/provider wiring — `showToast()` is a
// plain module function callable from anywhere, and a single <ToastHost/>
// mounted at the app root renders + auto-dismisses the stack. This lets a
// form fire a confirmation and close immediately; the toast outlives it
// because the host lives at the root, not inside the form.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastSeverity = "success" | "error" | "info";
type ToastItem = { id: number; message: string; severity: ToastSeverity };
type Listener = (t: { message: string; severity: ToastSeverity }) => void;

let listeners: Listener[] = [];
let seq = 0;

/** Fire a corner toast from any client component. */
export function showToast(message: string, severity: ToastSeverity = "success") {
  listeners.forEach((l) => l({ message, severity }));
}

const TONE: Record<ToastSeverity, { wrap: string; Icon: typeof CheckCircle2; icon: string }> = {
  success: { wrap: "border-emerald-200 bg-white", Icon: CheckCircle2, icon: "text-emerald-500" },
  error:   { wrap: "border-rose-200 bg-white",    Icon: AlertCircle,  icon: "text-rose-500" },
  info:    { wrap: "border-sky-200 bg-white",     Icon: Info,         icon: "text-sky-500" },
};

const DURATION_MS = 4000;

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const onToast: Listener = (t) => {
      const id = ++seq;
      // Cap the visible stack so a burst doesn't fill the screen.
      setToasts((prev) => [...prev, { id, ...t }].slice(-4));
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, DURATION_MS);
    };
    listeners.push(onToast);
    return () => { listeners = listeners.filter((l) => l !== onToast); };
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((x) => x.id !== id));

  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div className="fixed z-[200] bottom-5 right-5 flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2.5rem)]">
      {toasts.map((t) => {
        const tone = TONE[t.severity];
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 w-[320px] max-w-full px-3.5 py-3 rounded-xl border shadow-lg shadow-slate-300/40 text-[13px] text-slate-800 animate-in slide-in-from-bottom-3 fade-in duration-200 ${tone.wrap}`}
          >
            <tone.Icon size={17} className={`shrink-0 mt-px ${tone.icon}`} />
            <span className="flex-1 leading-snug font-medium">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-slate-400 hover:text-slate-700 -mr-0.5"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
