"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Bell, CheckCheck, Activity, Home, Briefcase, ShieldCheck, Coffee, MoreHorizontal, BellOff, Trash2, HeartPulse, ArrowRight, ClipboardList } from "lucide-react";
import Link from "next/link";

/**
 * Tiny "bing" via the Web Audio API. Two short tones (E5 then C6) so it
 * sounds like a soft chime without needing an .mp3 asset. AudioContext
 * is lazily created and cached. Browsers gate AudioContext.start() on
 * a prior user gesture — we wrap in try/catch so a blocked play just
 * silently no-ops on the first poll after page load.
 */
let _notifAudioCtx: AudioContext | null = null;
function playNotificationSound() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctx) return;
    if (!_notifAudioCtx) _notifAudioCtx = new Ctx();
    const ctx = _notifAudioCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const tone = (freq: number, start: number, dur = 0.18) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Short fade in/out so it sounds like a chime, not a click.
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };
    tone(659.25, 0);     // E5
    tone(1046.5, 0.12);  // C6
  } catch { /* autoplay-blocked or no audio support — silent */ }
}

function timeAgo(iso: string): string {
  const t  = new Date(iso).getTime();
  const s  = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60)  return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24)  return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7)   return `${d}d`;
  const w = Math.round(d / 7);
  if (w < 5)   return `${w}w`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
}

const TYPE_META: Record<string, { tint: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }> = {
  regularization: { tint: "#008CFF", Icon: ShieldCheck },
  wfh:            { tint: "#10b981", Icon: Home        },
  on_duty:        { tint: "#8b5cf6", Icon: Briefcase   },
  leave:          { tint: "#f59e0b", Icon: Coffee      },
  comp_off:       { tint: "#14b8a6", Icon: Activity    },
  pulse_weekly:   { tint: "#008CFF", Icon: HeartPulse  },
  pulse_monthly:  { tint: "#8b5cf6", Icon: HeartPulse  },
  exit_survey:    { tint: "#e11d48", Icon: ClipboardList },
  _default:       { tint: "#14b8a6", Icon: Activity    },
};
const metaFor = (type: string) => TYPE_META[type] || TYPE_META._default;

// Pulse / survey notifications get an explicit "Take it →" CTA chip
// so it's obvious the card is actionable (not just informational).
const PULSE_CTA: Record<string, string> = {
  pulse_weekly:  "Take the pulse",
  pulse_monthly: "Take the survey",
  exit_survey:   "Complete exit survey",
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);
  const { data } = useSWR("/api/hr/notifications?limit=10", fetcher, { refreshInterval: 60_000, revalidateOnFocus: false });
  const items = (data?.items as any[]) || [];
  const unread = data?.unreadCount ?? 0;

  // Per-user mute toggle, persisted across reloads. Seeded synchronously
  // from localStorage so the bell never plays a chime in the brief window
  // before a useEffect would have set it.
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("nbm:notif:muted") === "1";
  });
  useEffect(() => {
    try { window.localStorage.setItem("nbm:notif:muted", muted ? "1" : "0"); } catch { /* private mode */ }
  }, [muted]);

  // Chime on unread-count increase (i.e. a new notification just arrived).
  // First load seeds the ref without playing — we only want to chime on
  // *deltas* once the bell is already mounted, otherwise every page nav
  // would replay the sound for the same backlog.
  const prevUnreadRef = useRef<number | null>(null);
  useEffect(() => {
    if (data == null) return;            // wait for first SWR resolution
    const prev = prevUnreadRef.current;
    if (prev !== null && unread > prev && !muted) playNotificationSound();
    prevUnreadRef.current = unread;
  }, [unread, data, muted]);

  // Overflow (3-dots) menu inside the panel header — Mute/Unmute + Delete read.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  const readCount = items.filter((n: any) => n.isRead).length;
  const deleteRead = async () => {
    setMenuOpen(false);
    if (readCount === 0) return;
    if (!confirm(`Delete all read notifications? This cannot be undone.`)) return;
    await fetch("/api/hr/notifications?scope=read", { method: "DELETE" });
    mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
  };

  // Close on outside click. Use click (not mousedown) so the button's own
  // onClick can run first and flip state without racing a close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t))  return;
      if (btnRef.current?.contains(t))    return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  const markRead = async (id: number) => {
    await fetch("/api/hr/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id }),
    });
    mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
  };

  const markAllRead = async () => {
    await fetch("/api/hr/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read_all" }),
    });
    mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="relative w-8 h-8 rounded-full border border-[#c8d2de] bg-[#e9eef4] hover:bg-[#dde4ec] flex items-center justify-center text-slate-500 hover:text-slate-700 cursor-pointer transition-colors"
        aria-label="Notifications"
        aria-expanded={open}
        style={{ zIndex: 40 }}
      >
        <Bell size={15} strokeWidth={2} style={{ pointerEvents: "none" }} />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white"
            style={{ pointerEvents: "none" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal((() => {
        const rect = btnRef.current?.getBoundingClientRect();
        const top  = (rect?.bottom ?? 0) + 8;
        // Anchor panel's right edge to the button's right edge, clamped to the
        // viewport so the panel never extends past the right side.
        const vw   = typeof window !== "undefined" ? window.innerWidth : 0;
        const right = Math.max(8, vw - (rect?.right ?? vw));
        return (
        <div
          ref={panelRef}
          className="fixed w-[380px] max-w-[calc(100vw-16px)] max-h-[520px] bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{ zIndex: 9999, top, right }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/[0.06]">
            <span className="text-[14px] font-semibold text-slate-900 dark:text-white">Notifications</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                aria-disabled={unread === 0}
                className={`text-[12px] font-medium flex items-center gap-1 transition-colors ${
                  unread === 0
                    ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                    : "text-[#008CFF] hover:underline cursor-pointer"
                }`}
              >
                <CheckCheck size={13} /> Mark all as read
              </button>
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-white"
                  aria-label="Notification options"
                  aria-expanded={menuOpen}
                >
                  <MoreHorizontal size={15} strokeWidth={2} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-8 z-10 w-56 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1526] py-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setMuted((m) => {
                          const next = !m;
                          // Play a sample chime when turning sound back ON.
                          // Doubles as the user-gesture that unlocks audio
                          // on browsers that block autoplay until the user
                          // has interacted with the page.
                          if (!next) playNotificationSound();
                          return next;
                        });
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                    >
                      {muted ? <Bell size={13} className="text-emerald-500" /> : <BellOff size={13} className="text-slate-500" />}
                      {muted ? "Unmute notification sound" : "Mute notification sound"}
                    </button>
                    <button
                      type="button"
                      onClick={deleteRead}
                      disabled={readCount === 0}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] ${
                        readCount === 0
                          ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                      }`}
                    >
                      <Trash2 size={13} className={readCount === 0 ? "text-slate-300 dark:text-slate-600" : "text-rose-500"} />
                      Delete read notifications
                      {readCount > 0 && (
                        <span className="ml-auto text-[10.5px] font-semibold text-slate-400 dark:text-slate-500">{readCount}</span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {items.length === 0 ? (
              <p className="text-[13px] text-slate-400 dark:text-slate-400 text-center py-14">No notifications yet</p>
            ) : items.map((n: any) => {
              const { tint, Icon } = metaFor(n.type);
              const body = (
                <div className={`relative flex items-start gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-white/[0.04] transition-colors ${n.isRead ? "hover:bg-slate-50 dark:hover:bg-white/[0.02]" : "bg-[#008CFF]/[0.04] hover:bg-[#008CFF]/[0.08] dark:bg-[#4a9cff]/[0.06] dark:hover:bg-[#4a9cff]/[0.1]"}`}>
                  {!n.isRead && (
                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#008CFF] dark:bg-[#4a9cff]" />
                  )}
                  <span
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ background: `${tint}22`, color: tint }}
                  >
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] leading-snug ${n.isRead ? "text-slate-500 dark:text-slate-400 font-medium" : "text-slate-900 dark:text-white font-semibold"}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className={`text-[11.5px] mt-0.5 leading-snug line-clamp-2 ${n.isRead ? "text-slate-400 dark:text-slate-500" : "text-slate-600 dark:text-slate-300"}`}>
                        {n.body}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <p className={`text-[11px] ${n.isRead ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
                        {timeAgo(n.createdAt)}
                      </p>
                      {/* CTA chip for pulse / survey notifications —
                          makes the click affordance explicit. Only
                          shown when the notification carries a link. */}
                      {PULSE_CTA[n.type] && n.linkUrl && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: `${tint}1a`, color: tint }}
                        >
                          {PULSE_CTA[n.type]} <ArrowRight size={10} strokeWidth={2.5} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
              const onClick = () => { if (!n.isRead) markRead(n.id); setOpen(false); };
              return n.linkUrl ? (
                <Link key={n.id} href={n.linkUrl} onClick={onClick} className="block">{body}</Link>
              ) : (
                <button key={n.id} type="button" onClick={onClick} className="w-full text-left">{body}</button>
              );
            })}
          </div>
        </div>
        );
      })(), document.body)}
    </>
  );
}
