// Receives access events pushed by the Hikvision DS-K1T342MFWX terminal
// (Configuration → Network → Network Service → HTTP Listening). Each
// successful face / fingerprint authentication becomes a clock-in or
// clock-out in the dashboard.
//
// Device setup (HTTP Listening):
//   Event Alarm IP/Domain : studio.nbmedia.co.in
//   URL                   : /api/devices/hikvision/event?key=<HIKVISION_WEBHOOK_KEY>
//   Port                  : 443      Protocol: HTTPS
// (The key may instead be sent as the header `X-Hikvision-Key` if the
//  firmware supports custom headers — preferred, since it stays out of logs.)
//
// Security model:
//   • Shared secret (HIKVISION_WEBHOOK_KEY) — required in production; compared
//     in constant time. In dev (NODE_ENV !== production) the endpoint is open
//     so a LAN test needs no env setup.
//   • Punch time is clamped to ±15 min of now, so a forged/stale dateTime
//     can't backdate attendance.
//   • Device-serial pin (HIKVISION_DEVICE_SERIAL) is a HYGIENE filter only —
//     a serial can be spoofed; real device identity should come from TLS /
//     reverse-proxy IP allowlist. Not relied on for auth.
//   • Raw payload logging is gated to dev / HIKVISION_LOG_RAW=1 (onboarding)
//     to keep employee PII out of steady-state logs.
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { recordDevicePunch } from "@/lib/hr/device-punch";
import { publishPunch } from "@/lib/realtime/attendance-bus";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const CLOCK_SKEW_MS = 15 * 60_000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false; // length is not secret here
  return timingSafeEqual(ab, bb);
}

// Returns an error response if auth fails, else null.
function checkAuth(req: NextRequest): NextResponse | null {
  const expectedKey = process.env.HIKVISION_WEBHOOK_KEY;
  if (expectedKey) {
    const provided = req.headers.get("x-hikvision-key") ?? req.nextUrl.searchParams.get("key") ?? "";
    if (!safeEqual(provided, expectedKey)) {
      console.warn("[hikvision] rejected: bad/missing key");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  }
  // No key configured: fail CLOSED in production, open only in dev for testing.
  if (process.env.NODE_ENV === "production") {
    console.error("[hikvision] HIKVISION_WEBHOOK_KEY not set in production — refusing.");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }
  console.warn("[hikvision] dev mode, no key set — open for LOCAL testing only.");
  return null;
}

// Pull the event JSON out of whatever the device sent: a JSON body, or a
// multipart/form-data body (event JSON in one part + optional capture image).
async function extractEventJson(req: NextRequest): Promise<any | null> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) return await req.json();
    if (ct.includes("form-data")) {
      const form = await req.formData();
      for (const [, value] of form.entries()) {
        const text = typeof value === "string" ? value : await (value as Blob).text().catch(() => "");
        const trimmed = text.trim();
        if (trimmed.startsWith("{")) { try { return JSON.parse(trimmed); } catch { /* next part */ } }
      }
      return null;
    }
    const body = (await req.text()).trim();
    return body.startsWith("{") ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

async function handlePunch(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const payload = await extractEventJson(req);

  // Raw logging only during onboarding (dev or HIKVISION_LOG_RAW=1) — the
  // payload carries employee PII. Steady state logs structural metadata only.
  const logRaw = process.env.NODE_ENV !== "production" || process.env.HIKVISION_LOG_RAW === "1";
  if (logRaw) {
    try { console.log("[hikvision] raw:", JSON.stringify(payload).slice(0, 1500)); }
    catch { console.log("[hikvision] raw: <unparseable>"); }
  }
  if (!payload) return NextResponse.json({ ok: true, ignored: "no-json" });

  // Hygiene filter only (not auth) — drop events from an unexpected serial.
  const pinnedSerial = process.env.HIKVISION_DEVICE_SERIAL;
  const serial = payload.AccessControllerEvent?.serialNo ?? payload.serialNo ?? payload.deviceID ?? null;
  if (pinnedSerial && serial && String(serial) !== pinnedSerial) {
    console.warn(`[hikvision] dropped: serial ${serial} != pinned`);
    return NextResponse.json({ error: "Unknown device" }, { status: 403 });
  }

  const ace = payload.AccessControllerEvent ?? payload.accessControllerEvent ?? null;
  const employeeNo = String(ace?.employeeNoString ?? ace?.employeeNo ?? ace?.employeeID ?? "").trim();

  // Only act on events that identify a person (a successful auth). Door
  // status, heartbeats, tamper, failed/unknown reads carry no employee no.
  if (!ace || !employeeNo) return NextResponse.json({ ok: true, ignored: "no-employee" });

  // Only act on LIVE punches (event time within ±15 min of now). The
  // terminal buffers events while it has no destination and flushes the
  // whole backlog on first connect — those carry old timestamps and must
  // NOT be recorded (they'd pollute today's attendance). Future-dated
  // events (clock skew / forgery) are dropped too. We still return 200 so
  // the device clears them from its buffer instead of retrying forever.
  const dtRaw = payload.dateTime ?? ace.time ?? ace.dateTime ?? null;
  const eventAt = dtRaw ? new Date(dtRaw) : null;
  const haveValidTime = !!eventAt && !Number.isNaN(eventAt.getTime());
  if (haveValidTime && Math.abs(eventAt!.getTime() - Date.now()) > CLOCK_SKEW_MS) {
    console.warn(`[hikvision] ignoring non-live event emp=${employeeNo} time=${dtRaw}`);
    return NextResponse.json({ ok: true, ignored: "stale-or-future" });
  }
  const at = haveValidTime ? eventAt! : new Date();

  // A scan only ever clocks IN. The one exception: if the device's attendance
  // mode is on and the employee explicitly chose "Check Out", honor it.
  const checkOut = String(ace.attendanceStatus ?? "").toLowerCase().endsWith("out");
  console.log(`[hikvision] emp=${employeeNo} at=${at.toISOString()} checkOut=${checkOut}`);

  try {
    const result = await recordDevicePunch({ employeeNo, at, checkOut });
    console.log("[hikvision] →", JSON.stringify(result));
    // Push the live update to any open dashboard for this user (instant SSE).
    if ((result.action === "clock_in" || result.action === "clock_out") && "userId" in result) {
      publishPunch(result.userId);
    }
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    console.error("[hikvision] record failed:", e?.message ?? e);
    return NextResponse.json({ ok: false, error: "record-failed" }); // 200 so the device doesn't retry-storm
  }
}

export const POST = handlePunch;

// GET is a no-op probe only (some firmware checks the URL with GET first).
// It never records a punch — state changes go through POST.
export function GET() {
  return NextResponse.json({ ok: true, probe: true });
}
