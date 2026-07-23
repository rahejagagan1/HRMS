// Resolves the effective punch time for a clock-in / clock-out when the
// client supplies a `clientPunchAt` (the moment the user actually clicked,
// carried by the offline retry queue so a punch that syncs late records at
// the RIGHT time instead of at sync time).
//
// Trust is bounded — the timestamp is client-supplied, so we only honor it
// inside guardrails and otherwise fall back to the server clock:
//   • Never in the future (small skew allowed for clock drift).
//   • Same IST calendar day as the server clock (a queued punch is always
//     same-day; this blocks claiming a different day).
//   • clock-out: not before the clock-in (`floor`).
//   • clock-in: only within `maxAgeMs` of now — a network blip is minutes,
//     so this blocks backdating your start time by hours to inflate pay.
//     (clock-out has no max-age: honoring an EARLIER time only REDUCES
//     hours, so there's no inflation incentive there.)

import { istDateOnlyFrom } from "@/lib/ist-date";

const FUTURE_SKEW_MS = 2 * 60_000;

export function resolveClientPunchAt(
  clientPunchAt: string | undefined | null,
  serverNow: Date,
  opts?: { floor?: Date | null; maxAgeMs?: number },
): { at: Date; usedClient: boolean } {
  if (!clientPunchAt) return { at: serverNow, usedClient: false };
  const t = new Date(clientPunchAt);
  if (Number.isNaN(t.getTime())) return { at: serverNow, usedClient: false };
  // Not in the future.
  if (t.getTime() > serverNow.getTime() + FUTURE_SKEW_MS) return { at: serverNow, usedClient: false };
  // Same IST day as the server clock.
  if (istDateOnlyFrom(t).getTime() !== istDateOnlyFrom(serverNow).getTime()) {
    return { at: serverNow, usedClient: false };
  }
  // clock-out floor: can't be before the clock-in.
  if (opts?.floor && t.getTime() < opts.floor.getTime()) return { at: serverNow, usedClient: false };
  // clock-in window: within maxAgeMs of now.
  if (opts?.maxAgeMs && serverNow.getTime() - t.getTime() > opts.maxAgeMs) {
    return { at: serverNow, usedClient: false };
  }
  return { at: t, usedClient: true };
}
