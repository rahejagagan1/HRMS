// Office geofencing — compute whether a clock-in's coordinates fall
// inside the office radius so HR sees a reliable "At Office" badge
// instead of relying on Nominatim's sometimes-wrong sector label.
//
// Brand-aware: NB Media and YT Labs run out of physically different
// offices in Mohali, so a single global geofence used to flag YT Labs
// employees as "off-site" whenever they clocked in from the YT Labs
// building. Each brand now has its own optional override; the
// employee's businessUnit (EmployeeProfile.businessUnit) selects
// which one applies, falling back to the NB Media default when the
// employee has no business unit set OR when the YT Labs override
// isn't configured.
//
// Config lives in env vars so HR can adjust without a deploy:
//
//   OFFICE_LAT              — default office latitude  (NB Media, e.g. "30.7100")
//   OFFICE_LNG              — default office longitude (NB Media, e.g. "76.7077")
//   OFFICE_RADIUS_M         — default radius in meters (default 100)
//
//   OFFICE_LAT_YT_LABS      — YT Labs latitude   (optional override)
//   OFFICE_LNG_YT_LABS      — YT Labs longitude  (optional override)
//   OFFICE_RADIUS_M_YT_LABS — YT Labs radius     (optional, defaults to OFFICE_RADIUS_M)
//
// When neither the per-brand override nor the global default is set,
// every clock-in for that brand is treated as "unknown" (not at
// office, not off-site) — the badge silently disables so we don't
// render misleading info before the office is configured.

const DEFAULT_RADIUS_M = 100;

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function radiusFromEnv(raw: string | undefined, fallback: number): number {
  const n = num(raw);
  return n != null && n > 0 ? n : fallback;
}

type OfficeConfig = { lat: number | null; lng: number | null; radiusM: number };

const NB_MEDIA: OfficeConfig = {
  lat:     num(process.env.OFFICE_LAT),
  lng:     num(process.env.OFFICE_LNG),
  radiusM: radiusFromEnv(process.env.OFFICE_RADIUS_M, DEFAULT_RADIUS_M),
};

// YT Labs falls back to NB Media's coords/radius when its own env
// vars aren't set, so adding YT Labs is opt-in (set the *_YT_LABS
// vars) without breaking existing single-office deployments.
const YT_LABS: OfficeConfig = {
  lat:     num(process.env.OFFICE_LAT_YT_LABS)      ?? NB_MEDIA.lat,
  lng:     num(process.env.OFFICE_LNG_YT_LABS)      ?? NB_MEDIA.lng,
  radiusM: radiusFromEnv(process.env.OFFICE_RADIUS_M_YT_LABS, NB_MEDIA.radiusM),
};

/** Normalise a businessUnit string from EmployeeProfile to the
 *  office config that should apply. Whitespace + casing tolerant
 *  ("yt labs", "YT-Labs", "YT_LABS" all map to YT_LABS). */
function officeForBrand(brand: string | null | undefined): OfficeConfig {
  if (!brand) return NB_MEDIA;
  const norm = String(brand).toLowerCase().replace(/[\s_\-]+/g, "");
  if (norm === "ytlabs") return YT_LABS;
  return NB_MEDIA;
}

/** True when the office is fully configured (lat + lng both present + finite). */
export function isGeofenceConfigured(brand?: string | null): boolean {
  const o = officeForBrand(brand);
  return o.lat !== null && o.lng !== null;
}

/** Haversine distance in meters between two lat/lng pairs. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GeofenceResult = {
  /** Whether the office is configured at all. False → atOffice/distance are undefined. */
  configured: boolean;
  /** Distance from office in meters, rounded to whole metres. Undefined when not configured. */
  distanceM?: number;
  /** True when distanceM ≤ radiusM. Undefined when not configured. */
  atOffice?: boolean;
  /** Configured radius (so the UI can show "within 100 m" / "200 m away"). */
  radiusM: number;
};

/**
 * Compute the office-geofence result for a single coordinate pair
 * against the office associated with the employee's `brand`
 * (EmployeeProfile.businessUnit — "NB Media" or "YT Labs"). When
 * `brand` is omitted/unrecognised, falls back to the NB Media
 * default office so legacy callers continue to behave as before.
 *
 * Returns `configured: false` when env vars aren't set so the
 * caller can render a neutral state instead of a misleading
 * "off-site" badge.
 */
export function evaluateOfficeGeofence(
  lat: number | null | undefined,
  lng: number | null | undefined,
  brand?: string | null,
): GeofenceResult {
  const o = officeForBrand(brand);
  if (o.lat === null || o.lng === null
      || typeof lat !== "number" || typeof lng !== "number"
      || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { configured: false, radiusM: o.radiusM };
  }
  const dist = haversineMeters(o.lat, o.lng, lat, lng);
  return {
    configured: true,
    distanceM: Math.round(dist),
    atOffice: dist <= o.radiusM,
    radiusM: o.radiusM,
  };
}
