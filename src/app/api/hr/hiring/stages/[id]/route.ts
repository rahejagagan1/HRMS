// HR Hiring — per-stage update + delete.
//
// PATCH  /api/hr/hiring/stages/[id]
//   body: { label?, color?, isActive? }
//   - Cannot change `kind` (changing terminal-ness would break the
//     funnel logic). Cannot change `key` (system identifier other
//     code depends on).
//   - Terminal stages (hired / rejected) can still be renamed /
//     recoloured / deactivated, but their kind stays terminal.
//
// DELETE /api/hr/hiring/stages/[id]
//   - Only if the stage has zero candidates assigned AND no history
//     rows reference it. Otherwise the handler returns 409 with a
//     friendly count + hint to deactivate instead (so the audit
//     trail isn't lost).
//   - Terminal stages (hired / rejected) refuse delete — they're
//     system-required.
//
// FKs pointing at HiringStage (per migrations):
//   - JobApplication.currentStageId        ON DELETE SET NULL    (safe)
//   - Candidate.currentStageId             ON DELETE SET NULL    (safe)
//   - EmailTemplate.stageId                ON DELETE SET NULL    (safe)
//   - JobApplicationStage.stageId          ON DELETE RESTRICT    ← blocks
//   - CandidateStage.stageId (legacy)      ON DELETE RESTRICT    ← blocks
// We pre-check both RESTRICT FKs and bubble up Postgres 23503 with a
// useful message if a new FK gets added later.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

const ALLOWED_COLORS = new Set([
  "slate", "blue", "cyan", "violet", "amber", "pink", "emerald", "rose", "indigo", "teal", "orange",
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const body = await req.json();
    const set: string[] = [];
    const args: any[] = [];
    if (typeof body?.label === "string") {
      const v = body.label.trim();
      if (!v) return NextResponse.json({ error: "Label cannot be empty" }, { status: 400 });
      args.push(v); set.push(`"label" = $${args.length}`);
    }
    if (typeof body?.color === "string") {
      if (!ALLOWED_COLORS.has(body.color)) {
        return NextResponse.json({ error: `Unsupported color. Allowed: ${[...ALLOWED_COLORS].join(", ")}` }, { status: 400 });
      }
      args.push(body.color); set.push(`"color" = $${args.length}`);
    }
    if (typeof body?.isActive === "boolean") {
      args.push(body.isActive); set.push(`"isActive" = $${args.length}`);
    }
    if (set.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    args.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE "HiringStage" SET ${set.join(", ")}, "updatedAt" = NOW() WHERE "id" = $${args.length}`,
      ...args,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/stages/[id]");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    // Look up the stage so we can refuse system-critical kinds.
    const stageRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "kind", "key", "label" FROM "HiringStage" WHERE "id" = $1`,
      id,
    );
    const stage = stageRows[0];
    if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 });

    if (stage.kind === "hired" || stage.kind === "rejected") {
      return NextResponse.json(
        { error: `"${stage.label}" is a system stage — it can be deactivated but not deleted.` },
        { status: 400 },
      );
    }

    // 1. Active candidates currently sitting in this stage.
    const usage = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS n FROM "JobApplication" WHERE "currentStageId" = $1`,
      id,
    );
    const n = Number(usage[0]?.n ?? 0);
    if (n > 0) {
      return NextResponse.json(
        {
          error: `Can't delete "${stage.label}" — ${n} candidate${n === 1 ? " is" : "s are"} currently in this stage. Move them first, or deactivate the stage to hide it without losing history.`,
          candidatesInStage: n,
        },
        { status: 409 },
      );
    }

    // 2. Historical references in JobApplicationStage (ON DELETE
    //    RESTRICT). Even if no candidate sits here right now, every
    //    candidate that ever passed through leaves a row pointing
    //    here — deleting would lose audit trail, so refuse.
    const historyRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS n FROM "JobApplicationStage" WHERE "stageId" = $1`,
      id,
    );
    const historyCount = Number(historyRows[0]?.n ?? 0);
    if (historyCount > 0) {
      return NextResponse.json(
        {
          error: `Can't delete "${stage.label}" — ${historyCount} candidate stage-history entr${historyCount === 1 ? "y" : "ies"} reference this stage. Deactivate it instead (toggle "Active" off) so it's hidden from the funnel without losing the audit trail.`,
          historyEntries: historyCount,
          hint: "deactivate",
        },
        { status: 409 },
      );
    }

    // 3. Legacy CandidateStage references (only present on DBs that
    //    ran the older 20260429 migration — probe information_schema
    //    so we don't crash on DBs where the table doesn't exist).
    const hasCandidateStage = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CandidateStage' LIMIT 1`,
    );
    if (hasCandidateStage.length > 0) {
      const legacy = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS n FROM "CandidateStage" WHERE "stageId" = $1`,
        id,
      );
      const legacyCount = Number(legacy[0]?.n ?? 0);
      if (legacyCount > 0) {
        return NextResponse.json(
          {
            error: `Can't delete "${stage.label}" — ${legacyCount} legacy candidate-stage row${legacyCount === 1 ? "" : "s"} reference this stage. Deactivate it instead so its history is preserved.`,
            historyEntries: legacyCount,
            hint: "deactivate",
          },
          { status: 409 },
        );
      }
    }

    // All clear — attempt the delete. Catch 23503 defensively in
    // case a new FK gets added that we didn't pre-check.
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "HiringStage" WHERE "id" = $1`, id);
    } catch (fkErr: any) {
      const msg = String(fkErr?.message ?? fkErr ?? "");
      if (msg.includes("23503") || /foreign key/i.test(msg)) {
        return NextResponse.json(
          {
            error: `Can't delete "${stage.label}" — other records still reference it. Deactivate the stage instead.`,
            hint: "deactivate",
          },
          { status: 409 },
        );
      }
      throw fkErr;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/hiring/stages/[id]");
  }
}
