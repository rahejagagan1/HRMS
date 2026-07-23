// Admin → Emails Automation: get / patch the email toggle state.
//
// Two layers of toggling, both managed through this one endpoint:
//   • Global per-kind  (existing) — kills an email for everyone
//   • Per-role override (new)     — under each role (CEO / HR Manager /
//                                    Special Access / Admin), individual
//                                    kinds can be toggled off without
//                                    killing the global broadcast.
//
// GET   → catalog (kinds + roles) + the current full toggle state
// PATCH → body: { global?: { [kind]: bool }, perRole?: { [role]: { [kind]: bool } } }
//
// CEO + special_access + role=admin + developer can read / write.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverError } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  EMAIL_TOGGLE_CATALOG,
  EMAIL_ROLE_CATALOG,
  getEmailToggleState,
  saveEmailToggleState,
  type EmailKey,
  type EmailRole,
} from "@/lib/email/toggles";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
  const u = session?.user;
  if (!u) return false;
  return (
    u.orgLevel === "ceo" ||
    u.orgLevel === "special_access" ||
    u.role === "admin" ||
    u.isDeveloper === true
  );
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!canManage(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const state = await getEmailToggleState();
    return NextResponse.json({
      catalog:     EMAIL_TOGGLE_CATALOG,
      roleCatalog: EMAIL_ROLE_CATALOG,
      toggles:     state.global,             // legacy field — flat map
      perRole:     state.perRole,            // new nested map
      history:     state.history,            // per-key last-changed { by, byId, at }
    });
  } catch (error) {
    return serverError(error, "admin/email-toggles GET");
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!canManage(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({} as any));

    const knownKinds = new Set<string>(EMAIL_TOGGLE_CATALOG.map((t) => t.key));
    const knownRoles = new Set<string>(EMAIL_ROLE_CATALOG.map((r) => r.key));

    // Two accepted body shapes for back-compat:
    //   1. legacy flat: { feedback: false, leave: true, ... }
    //   2. new nested:  { global: {...}, perRole: { ceo: {...}, ... } }
    // Mix-and-match supported too — any top-level key matching a known
    // EmailKey lands in `global` while `perRole` updates the nested map.
    const globalPatch: Partial<Record<EmailKey, boolean>> = {};
    const perRolePatch: Partial<Record<EmailRole, Partial<Record<EmailKey, boolean>>>> = {};

    if (body && typeof body === "object") {
      for (const [k, v] of Object.entries(body)) {
        if (k === "global" && v && typeof v === "object") {
          for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
            if (knownKinds.has(kk) && typeof vv === "boolean") {
              globalPatch[kk as EmailKey] = vv;
            }
          }
        } else if (k === "perRole" && v && typeof v === "object") {
          for (const [role, kindsMap] of Object.entries(v as Record<string, unknown>)) {
            if (!knownRoles.has(role) || !kindsMap || typeof kindsMap !== "object") continue;
            const out: Partial<Record<EmailKey, boolean>> = {};
            for (const [kk, vv] of Object.entries(kindsMap as Record<string, unknown>)) {
              if (knownKinds.has(kk) && typeof vv === "boolean") out[kk as EmailKey] = vv;
            }
            if (Object.keys(out).length) perRolePatch[role as EmailRole] = out;
          }
        } else if (knownKinds.has(k) && typeof v === "boolean") {
          // Legacy flat key — treat as global.
          globalPatch[k as EmailKey] = v;
        }
      }
    }

    // Resolve actor for the per-key history stamp. Prefer the session
    // dbId if present; fall back to a DB lookup by email so we still
    // get an ID for older sessions that didn't carry dbId.
    const sUser = session?.user as { name?: string | null; email?: string | null; dbId?: number | string | null } | undefined;
    let actorId: number | null = null;
    if (sUser?.dbId != null) {
      const n = Number(sUser.dbId);
      if (Number.isInteger(n) && n > 0) actorId = n;
    }
    if (actorId == null && sUser?.email) {
      const row = await prisma.user.findUnique({ where: { email: sUser.email }, select: { id: true, name: true } });
      if (row?.id) actorId = row.id;
    }
    const actorName = sUser?.name?.trim() || sUser?.email?.split("@")[0] || "Unknown";

    const state = await saveEmailToggleState({
      global:  globalPatch,
      perRole: perRolePatch,
    }, { name: actorName, id: actorId });
    return NextResponse.json({
      ok:      true,
      toggles: state.global,
      perRole: state.perRole,
      history: state.history,
    });
  } catch (error) {
    return serverError(error, "admin/email-toggles PATCH");
  }
}
