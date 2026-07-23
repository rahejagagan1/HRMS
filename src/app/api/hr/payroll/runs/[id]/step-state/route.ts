// GET  /api/hr/payroll/runs/[id]/step-state                      -> { states: {...} }
// PATCH /api/hr/payroll/runs/[id]/step-state  body: { step:N, state:"complete"|"pending" }
//
// Backs the 6 outer-step "Done / Pending" badges on the Run Payroll page.
// HR-admin only on writes.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, resolveUserId, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { normaliseBrandParam } from "@/lib/hr/brand-scope";
import { readBrandStatus } from "@/lib/hr/payroll-run-status";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// stepStates is stored per-brand — { "NB Media": { "1": "complete" },
// "YT Labs": {...} } — because a PayrollRun is one row per month shared by
// both brands. Without the brand namespace, NB completing a step would show
// as complete on the YT run too. Legacy flat rows ({ "1": "complete" }) are
// ignored on read, so completion resets once per brand and is then correct.
type RunRow = { id: number; status: string; stepStates: Record<string, any> | null; brandStatus: Record<string, any> | null };

function brandKey(raw: string | null | undefined): "NB Media" | "YT Labs" {
  return normaliseBrandParam(raw) ?? "NB Media";
}
function brandSlice(all: Record<string, any> | null, brand: string): Record<string, string> {
  const slice = all?.[brand];
  return slice && typeof slice === "object" ? slice as Record<string, string> : {};
}

async function loadRun(idStr: string): Promise<RunRow | null> {
  const id = parseInt(idStr);
  if (!Number.isFinite(id)) return null;
  const rows = await prisma.$queryRawUnsafe<RunRow[]>(
    `SELECT id, status, "stepStates", "brandStatus" FROM "PayrollRun" WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await ctx.params;
    const run = await loadRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const brand = brandKey(new URL(req.url).searchParams.get("brand"));
    return NextResponse.json({ states: brandSlice((run as any).stepStates, brand) });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/runs/[id]/step-state"); }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await ctx.params;
    const run = await loadRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const body = await req.json();
    const step  = parseInt(body?.step);
    const state = String(body?.state ?? "");
    const brand = brandKey(body?.brand);

    // Lock check is per-brand: a locked NB Media run must not freeze YT Labs'
    // step editing (and vice versa).
    if (["locked", "paid"].includes(readBrandStatus(run, brand).status)) {
      return NextResponse.json({ error: "Run is locked" }, { status: 409 });
    }
    if (!Number.isFinite(step) || step < 1 || step > 6) {
      return NextResponse.json({ error: "step must be 1..6" }, { status: 400 });
    }
    if (state !== "complete" && state !== "pending") {
      return NextResponse.json({ error: "state must be complete|pending" }, { status: 400 });
    }

    // Merge into the caller's brand slice only — the other brand's slice
    // (and any legacy flat keys) are preserved untouched.
    const all: Record<string, any> = { ...(run.stepStates ?? {}) };
    const slice: Record<string, string> = { ...brandSlice(all, brand) };
    slice[String(step)] = state;
    all[brand] = slice;

    await prisma.$executeRawUnsafe(
      `UPDATE "PayrollRun" SET "stepStates" = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
      JSON.stringify(all), run.id,
    );

    const actorId = await resolveUserId(session);
    await writeAuditLog({
      req,
      actorId: actorId ?? null,
      actorEmail: (session!.user as any).email ?? null,
      action: `payroll.step.${state}`,
      entityType: "PayrollRun",
      entityId: run.id,
      after: { step, state, brand },
    });

    return NextResponse.json({ states: slice });
  } catch (e) { return serverError(e, "PATCH /api/hr/payroll/runs/[id]/step-state"); }
}
