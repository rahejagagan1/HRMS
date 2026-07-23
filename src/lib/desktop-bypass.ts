// Helper used by every clock-in / clock-out fetch so the `?desktop=…` overrides
// work end-to-end on mobile.
//
// There are TWO override values, both soft (not secrets), for when a laptop
// isn't available:
//   • ?desktop=13 — plain mobile bypass. Skips the desktop-only clock-in/out
//                   block; the punch is recorded exactly like a normal web
//                   punch (geofence decides office / remote).
//   • ?desktop=12 — "at-office web override". Same mobile bypass, PLUS the
//                   clock-in is additionally recorded in HR's door-entry /
//                   office log as an honestly-sourced web override (source
//                   "web_override" — NOT the biometric "device" source). Use
//                   when the person is at the office but the biometric
//                   terminal is unavailable, so their arrival still shows in
//                   the office log — clearly marked as a web override, never
//                   disguised as a face/fingerprint scan.
//
// When the user opens ANY page with `?desktop=13` or `?desktop=12`, we remember
// it for the rest of the browser session (sessionStorage) and forward it to the
// clock-in/out API in TWO ways:
//   • the `x-desktop-bypass: <value>` request header, and
//   • a `?desktop=<value>` query param on the request URL.
// Belt-and-suspenders so the override survives BOTH client-side navigation
// (which drops the page's query string before you click clock-in) AND any
// reverse proxy that strips custom `x-` headers. The server honours either.
//
// Not secret — soft overrides for when a laptop isn't available; pair with a
// regularization request if used.

const STORAGE_KEY = "desktop-bypass";
const VALID = new Set(["13", "12"]);

/** The bypass value active for this session ("13" | "12"), or null. Reading it
 *  from the URL also persists it so later navigations (which drop the query
 *  string) keep the override alive. */
function activeBypassValue(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("desktop");
    if (fromUrl && VALID.has(fromUrl)) {
      try { window.sessionStorage.setItem(STORAGE_KEY, fromUrl); } catch {}
      return fromUrl;
    }
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return stored && VALID.has(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * True when EITHER desktop bypass is active for this session (`?desktop=13`
 * or `?desktop=12` in the URL, or set earlier in the session). Used by the
 * client mobile-detection so the Clock In button isn't hidden on a phone.
 */
export function isDesktopBypassActive(): boolean {
  return activeBypassValue() !== null;
}

/** Headers blob to spread into a clock-in/out fetch. Empty unless active;
 *  otherwise forwards the active value (11 or 12). */
export function desktopBypassHeader(): Record<string, string> {
  const v = activeBypassValue();
  return v ? { "x-desktop-bypass": v } : {};
}

/**
 * Append `?desktop=<value>` to an API URL when a bypass is active. Query
 * strings are always forwarded — even by proxies that strip custom headers —
 * so this is the reliable signal the server can count on.
 */
export function withDesktopBypassParam(url: string): string {
  const v = activeBypassValue();
  if (!v) return url;
  return url + (url.includes("?") ? "&" : "?") + "desktop=" + v;
}

/**
 * Server-side: the bypass value the caller opted into ("13" | "12" | null),
 * read from the `x-desktop-bypass` header OR the `?desktop=` query param
 * (query params survive header-stripping proxies). Both clock-in and
 * clock-out use this so the two signals stay in lockstep.
 */
export function desktopBypassMode(
  headers: Headers | { get(name: string): string | null },
  searchParams?: URLSearchParams,
): "13" | "12" | null {
  const h = headers.get("x-desktop-bypass");
  if (h === "13" || h === "12") return h;
  const q = searchParams?.get("desktop") ?? null;
  if (q === "13" || q === "12") return q;
  return null;
}

/**
 * Server-side convenience — true when EITHER bypass is present (header only).
 * Retained for callers that just need the mobile-block skip; new code should
 * prefer `desktopBypassMode` which also reads the query param and tells the
 * two modes apart.
 */
export function hasDesktopBypassHeader(headers: Headers | { get(name: string): string | null }): boolean {
  const v = headers.get("x-desktop-bypass");
  return v === "13" || v === "12";
}
