"use client";

// Offline retry queue for attendance punches. When a clock-in / clock-out
// POST fails on a NETWORK blip (fetch rejection / 5xx after the hook's
// inline retry), the punch is stashed in localStorage so it survives a
// reload / laptop sleep / tab close, then auto-flushed when connectivity
// returns. Each entry carries the ORIGINAL click time (`at`) which is sent
// as `clientPunchAt` so the server records the real punch time, not the
// (later) sync time. See resolveClientPunchAt for the server-side bounds.
//
// Only TRANSIENT failures are queued — 4xx gate rejections (pulse_required,
// desktop_only, already-clocked-out) are surfaced to the user, never queued.

export type QueuedPunch = {
  id: string;
  kind: "in" | "out";
  at: string;            // ISO — the moment the user clicked
  lat?: number;
  lng?: number;
  address?: string;
};

const KEY = "nbm:clock-queue";
// Entries older than this are dropped on read — the server only honors a
// clientPunchAt within the same IST day anyway, so a day-old queued punch
// can't record at its original time and is just noise.
const MAX_AGE_MS = 18 * 60 * 60 * 1000;
const MAX_ENTRIES = 20;

function safeParse(raw: string | null): QueuedPunch[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** All non-stale queued punches (prunes expired entries as a side effect). */
export function getQueuedPunches(): QueuedPunch[] {
  if (typeof window === "undefined") return [];
  const all = safeParse(window.localStorage.getItem(KEY));
  const now = Date.now();
  const fresh = all.filter((p) => {
    const t = new Date(p.at).getTime();
    return Number.isFinite(t) && now - t <= MAX_AGE_MS;
  });
  if (fresh.length !== all.length) writeAll(fresh);
  return fresh;
}

function writeAll(list: QueuedPunch[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch {
    /* quota / private mode — best-effort */
  }
}

export function enqueuePunch(p: Omit<QueuedPunch, "id">): QueuedPunch {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${p.kind}-${p.at}-${Math.random().toString(36).slice(2)}`;
  const entry: QueuedPunch = { id, ...p };
  const list = getQueuedPunches();
  // Collapse duplicates: keep only the latest pending punch of each kind so
  // a user mashing the button offline doesn't queue ten clock-outs.
  const deduped = list.filter((x) => x.kind !== p.kind);
  writeAll([...deduped, entry]);
  return entry;
}

export function removeQueuedPunch(id: string) {
  writeAll(getQueuedPunches().filter((p) => p.id !== id));
}

export function clearQueue() {
  writeAll([]);
}
