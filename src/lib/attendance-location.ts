export type AttLoc = {
  mode: "remote" | "office" | null;
  lat?: number;
  lng?: number;
  address?: string;
  /**
   * Office-geofence result computed at clock-in time. Stored on the
   * punch so HR can audit "was this person actually at the office?"
   * without re-running the calculation. Both fields are optional —
   * undefined when the geofence isn't configured (no OFFICE_LAT/LNG
   * env vars) or when coordinates weren't supplied.
   */
  atOffice?: boolean;
  /** Distance in meters from the configured office. Whole numbers. */
  distanceFromOfficeM?: number;
};

export function stringifyAttLoc(loc: AttLoc): string {
  const out: Record<string, unknown> = {};
  if (loc.mode) out.mode = loc.mode;
  if (typeof loc.lat === "number" && isFinite(loc.lat)) out.lat = loc.lat;
  if (typeof loc.lng === "number" && isFinite(loc.lng)) out.lng = loc.lng;
  if (loc.address) out.address = loc.address;
  if (typeof loc.atOffice === "boolean") out.atOffice = loc.atOffice;
  if (typeof loc.distanceFromOfficeM === "number" && isFinite(loc.distanceFromOfficeM)) {
    out.distanceFromOfficeM = loc.distanceFromOfficeM;
  }
  return JSON.stringify(out);
}

export function parseAttLoc(raw?: string | null): AttLoc {
  if (!raw) return { mode: null };
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s);
      return {
        mode: j.mode === "remote" || j.mode === "office" ? j.mode : null,
        lat: typeof j.lat === "number" ? j.lat : undefined,
        lng: typeof j.lng === "number" ? j.lng : undefined,
        address: typeof j.address === "string" ? j.address : undefined,
        atOffice: typeof j.atOffice === "boolean" ? j.atOffice : undefined,
        distanceFromOfficeM: typeof j.distanceFromOfficeM === "number" ? j.distanceFromOfficeM : undefined,
      };
    } catch {
      return { mode: null };
    }
  }
  // Legacy plain-string values: either "remote"/"office" or a free-text address.
  if (s === "remote" || s === "office") return { mode: s };
  return { mode: null, address: s };
}

export type GeoFailReason = "unsupported" | "denied" | "position_unavailable" | "timeout" | "unknown";
export type GeoResult =
  | { ok: true;  lat: number; lng: number; address?: string }
  | { ok: false; reason: GeoFailReason; message: string };

/**
 * Browser-only: request geolocation and best-effort reverse-geocode via Nominatim.
 * Returns a tagged result so callers can show the user WHY it failed instead of
 * a generic "location required" message.
 *
 * Accuracy strategy:
 *   • watchPosition collects readings for up to 7 s (the GPS chip
 *     tightens its fix from ~100 m Wi-Fi triangulation down to
 *     ~10–20 m as it locks in). We keep the lowest `accuracy` value.
 *   • Early-exit as soon as a reading hits ≤ 20 m, so happy-path
 *     clock-ins don't wait a full 7 s.
 *   • Reuse a fix up to 5 min old (`maximumAge`) so quick / repeat
 *     punches don't re-fetch, then fall back to a fast coarse
 *     (Wi-Fi / IP) fix when the GPS chip can't lock a position —
 *     which is what makes desktop / indoor clock-ins reliable.
 */
const ACCURACY_TARGET_M = 20;    // good enough; exit early
const ACCURACY_BUDGET_MS = 7000; // hard cap on the high-accuracy stage
const RECENT_FIX_MAX_AGE_MS = 5 * 60_000; // accept a position up to 5 min old

// Stage 1 — high-accuracy GPS. watchPosition tightens the fix over a few
// seconds; we early-exit at ≤20 m. maximumAge lets a recent fix return
// instantly so quick / repeat punches don't trigger a fresh lookup.
function highAccuracyFix(): Promise<GeolocationPosition | GeolocationPositionError | null> {
  return new Promise((resolve) => {
    let best: GeolocationPosition | null = null;
    let lastErr: GeolocationPositionError | null = null;
    let settled = false;
    const settle = (v: GeolocationPosition | GeolocationPositionError | null) => {
      if (settled) return;
      settled = true;
      try { navigator.geolocation.clearWatch(id); } catch { /* noop */ }
      resolve(v);
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
        if (best.coords.accuracy <= ACCURACY_TARGET_M) settle(best);
      },
      (e) => {
        lastErr = e;
        // Prefer any reading we already have over the error; otherwise
        // surface it so the caller shows the right denied/timeout message.
        if (!best) settle(e);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: RECENT_FIX_MAX_AGE_MS },
    );
    setTimeout(() => settle(best ?? lastErr), ACCURACY_BUDGET_MS);
  });
}

// Stage 2 — fast, coarse fallback (Wi-Fi / IP). Rescues laptops and indoor
// spots where the GPS chip never locks. Lower accuracy, but well within the
// office geofence, and it accepts a slightly older cached position.
function lowAccuracyFix(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60_000 },
    );
  });
}

export async function captureClockInGeo(): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ok: false, reason: "unsupported", message: "Your browser doesn't support geolocation." };
  }

  // High-accuracy first; if it yields nothing usable, fall back to the fast
  // coarse fix before giving up. Keep the stage-1 error (e.g. "denied") for
  // messaging when both stages fail.
  let fix = await highAccuracyFix();
  if (!fix || "code" in fix) {
    const lo = await lowAccuracyFix();
    if (lo) fix = lo;
  }

  if (!fix) {
    return { ok: false, reason: "position_unavailable", message: "Your device couldn't determine a location. Make sure Location services are ON." };
  }
  if ("code" in fix) {
    const reason: GeoFailReason =
      fix.code === 1 ? "denied" :
      fix.code === 2 ? "position_unavailable" :
      fix.code === 3 ? "timeout" : "unknown";
    const message =
      reason === "denied"               ? "Location permission is blocked for this site. Click the lock icon in the address bar and allow Location." :
      reason === "position_unavailable" ? "Your device couldn't determine a location. On Windows, make sure Location services are ON in system settings." :
      reason === "timeout"              ? "Location request timed out. Check your Wi-Fi / GPS, then try again." :
                                          fix.message || "Unknown location error.";
    return { ok: false, reason, message };
  }

  const { latitude: lat, longitude: lng } = fix.coords;

  // Reverse-geocode at zoom=18 (street / building level — the most
  // precise Nominatim returns) and compose the address from
  // structured fields: street → area → city → state → pincode.
  // Best-effort and time-boxed to 4 s so a slow Nominatim response
  // can't block the clock-in.
  let address: string | undefined;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { "Accept": "application/json" }, signal: ctl.signal },
    );
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json();
      const a = j?.address || {};
      const street = [a.house_number, a.road].filter(Boolean).join(" ");
      const area   = a.suburb || a.neighbourhood || a.hamlet || a.village;
      const city   = a.city   || a.town          || a.municipality;
      const parts  = [street, area, city, a.state, a.postcode].filter(Boolean);
      // Drop adjacent duplicates (e.g. "Mohali, Mohali" can happen
      // when the suburb and city share a name).
      const deduped = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i - 1].toLowerCase());
      address = deduped.join(", ") || j?.display_name || undefined;
    }
  } catch { /* best-effort only — coords alone are enough */ }

  return { ok: true, lat, lng, address };
}
