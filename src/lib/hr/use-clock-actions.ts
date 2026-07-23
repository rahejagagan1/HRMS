"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutate as globalMutate } from "swr";
import { captureClockInGeo } from "@/lib/attendance-location";
import { desktopBypassHeader, withDesktopBypassParam } from "@/lib/desktop-bypass";
import { enqueuePunch, getQueuedPunches, removeQueuedPunch } from "@/lib/hr/clock-queue";

// Shared clock-in / clock-out hook used by both the HR Attendance page
// and the HR Home page. Hardens against the three failure modes that
// previously made users click 3-4 times before anything happened:
//
//   1. Uncaught network errors — `fetch(...)` could throw (transient
//      drop, gateway 502, server reload mid-request, Postgres pool
//      exhaustion). The old handlers had no try/catch around the
//      fetch, so the exception propagated silently and the only
//      visible effect was the spinner resetting. We now wrap every
//      fetch + json parse and surface the failure as a sticky error
//      message instead of an `alert()` that users dismiss without
//      reading.
//
//   2. Concurrent re-entry — users double-click the button. The
//      previous code relied on `setClockingIn(true)` flipping React
//      state, which has a render-cycle delay; in that gap a second
//      onClick could race. A `useRef` busy flag fences entry
//      synchronously so only one request flies at a time.
//
//   3. Transient 5xx / network blips — one automatic retry with a
//      short backoff covers the "I clicked once and got nothing"
//      case without making the user wonder whether their first click
//      registered. The retry only fires for `fetch` rejections and
//      5xx responses; auth, geolocation and 4xx responses (e.g.
//      "already clocked in", "desktop only") aren't retried because
//      they'd just fail again.
//
// The hook owns: `clockIn`, `clockOut`, busy flags, and an `error`
// banner object. The pages render the banner near the button.

export type ClockBannerSeverity = "error" | "info";

export interface ClockBanner {
  message: string;
  severity: ClockBannerSeverity;
}

export interface UseClockActionsOptions {
  /**
   * SWR keys to refresh after a successful clock-in / clock-out so the
   * Today / Sessions UI updates without a manual refresh. The hook
   * iterates and `globalMutate`s each one.
   */
  mutateKeys: string[];
  /**
   * Optional callback fired after a successful clock-out with the
   * server's updated Attendance row — lets the page flash a "Day
   * Complete" toast when totalMinutes crosses the 9h target.
   */
  onClockOutSuccess?: (record: { totalMinutes?: number | null } | null) => void;
}

export interface PulseGate {
  /** "Submit this week's Pulse before clocking out." — straight from the API. */
  message: string;
  /** Deep-link to the pulse form — usually "/dashboard/hr/pulse". */
  pulseUrl: string;
}

export interface ExitSurveyGate {
  /** "Please complete your Exit Survey before clocking out." */
  message: string;
  /** Deep-link to the exit survey — "/dashboard/hr/exit-survey". */
  exitSurveyUrl: string;
}

export interface DesktopGate {
  /**
   * "Clock-in/out is only available on Laptop & Desktop…" — straight from
   * the API's `desktop_only` 403. Carried so a blocking modal can explain
   * WHY the punch was refused instead of failing silently.
   */
  message: string;
}

export interface UseClockActionsReturn {
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  clockingIn: boolean;
  clockingOut: boolean;
  error: ClockBanner | null;
  clearError: () => void;
  /**
   * Set when a clock-out 403'd with `reason: "pulse_required"`. UI
   * should render a blocking modal that funnels the user to `pulseUrl`.
   * Null at all other times (including normal errors).
   */
  pulseGate: PulseGate | null;
  dismissPulseGate: () => void;
  /** Set when a clock-out 403'd with reason "exit_survey_required". */
  exitSurveyGate: ExitSurveyGate | null;
  dismissExitSurveyGate: () => void;
  /**
   * Set when a clock-in OR clock-out 403'd with `code: "desktop_only"`
   * (the mobile guard — punching is desktop-only unless the user has an
   * On-Duty record for today). UI renders a blocking modal so the user
   * understands WHY instead of the click appearing to do nothing.
   */
  desktopGate: DesktopGate | null;
  dismissDesktopGate: () => void;
}

/** Sleep helper — used for the single auto-retry backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch wrapper that:
 *   • Always returns a parsed body (or throws ClockApiError).
 *   • Retries ONCE on transient failures (fetch rejection / 5xx).
 *   • Throws a typed error otherwise so the caller can render a
 *     specific message.
 */
class ClockApiError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly status?: number,
    /**
     * Server-side enum on 4xx rejections — e.g. "pulse_required" when
     * the Friday Weekly Pulse gate fires. Lets the caller render a
     * specific UX (e.g. modal) instead of a generic error banner.
     */
    readonly reason?: string,
    /**
     * Caller-actionable URL paired with `reason`. For pulse_required
     * it's "/dashboard/hr/pulse" so we can "Take Pulse Now" the user
     * straight into the form.
     */
    readonly actionUrl?: string,
  ) {
    super(message);
  }
}

async function postOnce(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(withDesktopBypassParam(url), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...desktopBypassHeader() },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function postWithRetry(url: string, body?: unknown): Promise<any> {
  try {
    const first = await postOnce(url, body);
    if (first.ok) return first.data;
    if (first.status >= 500) {
      // 5xx → one retry
      await sleep(600);
      const second = await postOnce(url, body);
      if (second.ok) return second.data;
      throw new ClockApiError(
        second.data?.error || `Server error (${second.status}). Please try again in a moment.`,
        true,
        second.status,
      );
    }
    // 4xx — return the server-provided error directly, no retry.
    // The server tags rejections two ways: `reason` (pulse_required) and
    // `code` (desktop_only, attendance_disabled, location_required).
    // Carry whichever is present so the caller can branch on it.
    throw new ClockApiError(
      first.data?.error || `Request rejected (${first.status}).`,
      false,
      first.status,
      first.data?.reason ?? first.data?.code,
      first.data?.pulseUrl ?? first.data?.exitSurveyUrl,
    );
  } catch (e: any) {
    if (e instanceof ClockApiError) throw e;
    // Network-level failure (no response at all). Retry once.
    await sleep(600);
    try {
      const retry = await postOnce(url, body);
      if (retry.ok) return retry.data;
      throw new ClockApiError(
        retry.data?.error || `Network problem. Please check your connection and try again.`,
        true,
        retry.status,
      );
    } catch (e2: any) {
      if (e2 instanceof ClockApiError) throw e2;
      throw new ClockApiError(
        `Network problem. Please check your connection and try again.`,
        true,
      );
    }
  }
}

export function useClockActions({ mutateKeys, onClockOutSuccess }: UseClockActionsOptions): UseClockActionsReturn {
  const [clockingIn, setClockingIn] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [error, setError] = useState<ClockBanner | null>(null);
  const [pulseGate, setPulseGate] = useState<PulseGate | null>(null);
  const [exitSurveyGate, setExitSurveyGate] = useState<ExitSurveyGate | null>(null);
  const [desktopGate, setDesktopGate] = useState<DesktopGate | null>(null);
  // Synchronous re-entry guards. React state is async (set, then
  // re-render); a `useRef` flag flips immediately so the next onClick
  // in the same event loop tick is a no-op.
  const inFlightIn = useRef(false);
  const inFlightOut = useRef(false);

  const refreshAfter = useCallback(() => {
    for (const k of mutateKeys) {
      try { globalMutate(k); } catch { /* swallow — refresh is best-effort */ }
    }
  }, [mutateKeys]);

  const clockIn = useCallback(async () => {
    if (inFlightIn.current) return;
    inFlightIn.current = true;
    setClockingIn(true);
    setError(null);
    setDesktopGate(null);
    // Stamp the click moment now — carried as clientPunchAt so a punch
    // that has to be queued + synced later still records at the real time.
    const clickAt = new Date().toISOString();
    let geoSnapshot: { lat: number; lng: number; address?: string } | null = null;
    try {
      const geo = await captureClockInGeo();
      if (!geo.ok) {
        setError({
          message: geo.message || "Could not get your location. Please allow Location for this site and try again.",
          severity: "error",
        });
        console.warn("[clock-in] geo failed:", geo.reason, geo.message);
        return;
      }
      geoSnapshot = { lat: geo.lat, lng: geo.lng, address: geo.address };
      await postWithRetry("/api/hr/attendance/clock-in", {
        lat: geo.lat, lng: geo.lng, address: geo.address, clientPunchAt: clickAt,
      });
      refreshAfter();
    } catch (e: any) {
      // Mobile guard — surface a blocking modal so the user sees WHY the
      // punch was refused (desktop-only unless On-Duty) instead of the
      // click seeming to do nothing.
      if (e instanceof ClockApiError && e.reason === "desktop_only") {
        setDesktopGate({ message: e.message });
      } else if (e instanceof ClockApiError && e.transient && geoSnapshot) {
        // Network blip — stash the punch (with its real click time + geo)
        // so it auto-syncs when the connection is back, instead of vanishing.
        enqueuePunch({ kind: "in", at: clickAt, ...geoSnapshot });
        setError({ message: "No connection — your clock-in is saved and will sync automatically.", severity: "info" });
      } else {
        const msg = e instanceof ClockApiError ? e.message : "Clock-in failed. Please try again.";
        setError({ message: msg, severity: "error" });
      }
      console.warn("[clock-in] failed:", e);
    } finally {
      inFlightIn.current = false;
      setClockingIn(false);
    }
  }, [refreshAfter]);

  const clockOut = useCallback(async () => {
    if (inFlightOut.current) return;
    inFlightOut.current = true;
    setClockingOut(true);
    setError(null);
    setPulseGate(null);
    setExitSurveyGate(null);
    setDesktopGate(null);
    const clickAt = new Date().toISOString();
    try {
      const data = await postWithRetry("/api/hr/attendance/clock-out", { clientPunchAt: clickAt });
      refreshAfter();
      onClockOutSuccess?.(data);
    } catch (e: any) {
      // Weekly Pulse gate — show a blocking modal instead of the
      // generic banner so the user lands on the form in one click.
      if (e instanceof ClockApiError && e.reason === "pulse_required" && e.actionUrl) {
        setPulseGate({ message: e.message, pulseUrl: e.actionUrl });
      } else if (e instanceof ClockApiError && e.reason === "exit_survey_required" && e.actionUrl) {
        setExitSurveyGate({ message: e.message, exitSurveyUrl: e.actionUrl });
      } else if (e instanceof ClockApiError && e.reason === "desktop_only") {
        // Mobile guard — same blocking-modal treatment so the refusal
        // is visible (the generic banner isn't rendered in the
        // clocked-in UI state, which made this fail silently before).
        setDesktopGate({ message: e.message });
      } else if (e instanceof ClockApiError && e.transient) {
        // Network blip — stash the clock-out (with its real click time) so
        // it auto-syncs when the connection returns; the original time is
        // sent so a late sync doesn't inflate the day's hours.
        enqueuePunch({ kind: "out", at: clickAt });
        setError({ message: "No connection — your clock-out is saved and will sync automatically.", severity: "info" });
      } else {
        const msg = e instanceof ClockApiError ? e.message : "Clock-out failed. Please try again.";
        setError({ message: msg, severity: "error" });
      }
      console.warn("[clock-out] failed:", e);
    } finally {
      inFlightOut.current = false;
      setClockingOut(false);
    }
  }, [refreshAfter, onClockOutSuccess]);

  // ── Offline retry queue ─────────────────────────────────────────────
  // Replays punches that a network blip stranded in localStorage. Sends
  // each with its original click time (clientPunchAt) so it records at the
  // right moment. A 4xx (gate / already-clocked-out) is permanent → drop
  // it; a transient failure is left for the next flush.
  const flushing = useRef(false);
  const flushQueue = useCallback(async () => {
    if (flushing.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const queue = getQueuedPunches();
    if (queue.length === 0) return;
    flushing.current = true;
    let synced = false;
    try {
      for (const p of queue) {
        const url = p.kind === "in" ? "/api/hr/attendance/clock-in" : "/api/hr/attendance/clock-out";
        const body = p.kind === "in"
          ? { lat: p.lat, lng: p.lng, address: p.address, clientPunchAt: p.at }
          : { clientPunchAt: p.at };
        try {
          await postWithRetry(url, body);
          removeQueuedPunch(p.id);
          synced = true;
        } catch (e: any) {
          // Permanent (4xx gate, already-clocked-out, bad payload) → stop
          // retrying it. Transient → keep it for the next flush.
          if (e instanceof ClockApiError && !e.transient) removeQueuedPunch(p.id);
        }
      }
    } finally {
      flushing.current = false;
    }
    if (synced) {
      refreshAfter();
      setError({ message: "✓ Your saved clock punch synced.", severity: "info" });
    }
  }, [refreshAfter]);

  // Flush on mount (replays anything a prior session left behind), when the
  // browser regains connectivity, when the tab is refocused, and on a slow
  // interval as a backstop while the queue is non-empty.
  useEffect(() => {
    flushQueue();
    const onOnline = () => { flushQueue(); };
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") flushQueue();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisible);
    }
    const iv = setInterval(() => { if (getQueuedPunches().length > 0) flushQueue(); }, 30_000);
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisible);
      }
      clearInterval(iv);
    };
  }, [flushQueue]);

  const clearError = useCallback(() => setError(null), []);
  const dismissPulseGate = useCallback(() => setPulseGate(null), []);
  const dismissExitSurveyGate = useCallback(() => setExitSurveyGate(null), []);
  const dismissDesktopGate = useCallback(() => setDesktopGate(null), []);

  return { clockIn, clockOut, clockingIn, clockingOut, error, clearError, pulseGate, dismissPulseGate, exitSurveyGate, dismissExitSurveyGate, desktopGate, dismissDesktopGate };
}
