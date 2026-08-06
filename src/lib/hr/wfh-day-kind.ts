// Pure WFH day-kind helpers — CLIENT-SAFE, no imports.
//
// Split out of wfh-balance.ts (2026-08-06): that module imports prisma, and
// prisma.ts fail-fasts at import time in production when DATABASE_URL /
// NEXTAUTH_* are absent — which they ALWAYS are in the browser. The moment
// client components (HR home tile, analytics, attendance dashboard panel)
// imported wfhKindLabel from wfh-balance, the whole app died on load with
// "[Startup] Missing required environment variables". Anything a client
// component needs lives here; wfh-balance re-exports it for server callers.

/** Half-day WFH counts as 0.5; a full day as 1. Half-days are encoded
 *  as a reason prefix ([First Half] / [Second Half] / [Half Day]) — the
 *  same marker the attendance board reads. SINGLE source of truth for
 *  the day-weight, shared by the apply cap, the employee badge, and the
 *  HR balances panel so they can never disagree. */
export const WFH_HALF_DAY_RE = /\[(?:First Half|Second Half|Half Day)\]/i;
export function wfhDayWeight(reason: string | null | undefined): number {
  return WFH_HALF_DAY_RE.test(reason ?? "") ? 0.5 : 1;
}

/** Which half ONE WFH request covers, read from its reason marker.
 *  The bare legacy "[Half Day]" names no specific half → treated as first. */
export type WfhSegment = "full" | "first_half" | "second_half";
export function wfhSegment(reason: string | null | undefined): WfhSegment {
  const m = /\[(First Half|Second Half|Half Day)\]/i.exec(String(reason ?? ""));
  if (!m) return "full";
  return /second/i.test(m[1]) ? "second_half" : "first_half";
}

/** Collapse ALL of a user's WFH rows for ONE day into what the UI shows.
 *  An employee who booked the morning AND the afternoon separately is remote
 *  the whole day, and BOTH halves must be named — "both" renders as
 *  "1st + 2nd half", never just the newest row's half (which silently hid
 *  the other one). */
export type WfhDayKind = WfhSegment | "both";
export function wfhDayKind(reasons: Array<string | null | undefined>): WfhDayKind {
  const segs = new Set(reasons.map(wfhSegment));
  if (segs.has("full")) return "full";
  if (segs.has("first_half") && segs.has("second_half")) return "both";
  if (segs.has("second_half")) return "second_half";
  return "first_half";
}

/** Both halves booked = remote for the whole day, so it counts as a FULL-day
 *  WFH everywhere a caller asks "is this person WFH all day?" — the halves are
 *  kept only so the UI can still name them. */
export function isFullDayWfh(kind: WfhDayKind | null | undefined): boolean {
  return kind === "full" || kind === "both";
}

/** Chip text for a day's WFH kind. null = plain full day (no half chip). */
export function wfhKindLabel(kind: WfhDayKind | null | undefined): string | null {
  if (kind === "first_half")  return "1st half";
  if (kind === "second_half") return "2nd half";
  // Full day, but both halves are still named so it's clear it was booked as
  // two requests rather than one.
  if (kind === "both")        return "full day (1st + 2nd half)";
  return null;
}

/** Long form for tooltips / aria-labels. */
export function wfhKindTitle(kind: WfhDayKind | null | undefined): string {
  if (kind === "first_half")  return "Working from home (first half)";
  if (kind === "second_half") return "Working from home (second half)";
  if (kind === "both")        return "Working from home all day (first half + second half)";
  return "Working from home";
}
