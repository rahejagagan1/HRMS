import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { parseBody } from "@/lib/validate";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

// SyncConfig row key. Value shape:
//   { enabled: boolean, updatedById: number | null, updatedByName: string | null, updatedAt: ISO }
// Default when missing: enabled = true (matches the legacy behaviour).
const KEY = "regularization_window_enforced";

// HR access is RBAC-designation-driven (policy 2026-07-14): use the shared
// isHRAdmin (MANAGE_HR via designation permissions) instead of a local
// orgLevel/role-only copy, so designation-provisioned HR staff pass.
import { isHRAdmin } from "@/lib/access";

type PolicyValue = {
  enabled: boolean;
  updatedById: number | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

function parseValue(raw: unknown): PolicyValue {
  if (raw && typeof raw === "object") {
    const v = raw as Record<string, unknown>;
    return {
      enabled:        v.enabled !== false,  // default true
      updatedById:    typeof v.updatedById === "number" ? v.updatedById : null,
      updatedByName:  typeof v.updatedByName === "string" ? v.updatedByName : null,
      updatedAt:      typeof v.updatedAt === "string" ? v.updatedAt : null,
    };
  }
  return { enabled: true, updatedById: null, updatedByName: null, updatedAt: null };
}

/** Read-only helper used by the regularize POST to decide whether to enforce
 *  the 2-day window. Defaults to true when the row is missing or malformed. */
export async function isRegularizationWindowEnforced(): Promise<boolean> {
  const row = await prisma.syncConfig.findUnique({ where: { key: KEY } });
  if (!row) return true;
  return parseValue(row.value).enabled;
}

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const row = await prisma.syncConfig.findUnique({ where: { key: KEY } });
    return NextResponse.json(parseValue(row?.value));
  } catch (e) {
    return serverError(e, "GET /api/hr/policy/regularization-window");
  }
}

const PutBody = z.object({ enabled: z.boolean() });

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const callerUser = session!.user as any;
  if (!isHRAdmin(callerUser)) {
    return NextResponse.json(
      { error: "Only HR admins can change this policy." },
      { status: 403 },
    );
  }
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const parsed = await parseBody(req, PutBody);
    if (!parsed.ok) return parsed.error;
    const { enabled } = parsed.data;

    const before = parseValue(
      (await prisma.syncConfig.findUnique({ where: { key: KEY } }))?.value,
    );
    if (before.enabled === enabled) {
      return NextResponse.json(before);
    }

    const me = await prisma.user.findUnique({
      where: { id: myId },
      select: { name: true },
    });
    const next: PolicyValue = {
      enabled,
      updatedById:   myId,
      updatedByName: me?.name ?? null,
      updatedAt:     new Date().toISOString(),
    };
    await prisma.syncConfig.upsert({
      where:  { key: KEY },
      create: { key: KEY, value: next as any },
      update: { value: next as any },
    });

    await writeAuditLog({
      req,
      actorId: myId,
      actorEmail: callerUser?.email ?? null,
      action: enabled ? "policy.regularization_window.enable" : "policy.regularization_window.disable",
      entityType: "SyncConfig",
      entityId: KEY,
      before: { enabled: before.enabled },
      after:  { enabled },
    });

    return NextResponse.json(next);
  } catch (e) {
    return serverError(e, "PUT /api/hr/policy/regularization-window");
  }
}
