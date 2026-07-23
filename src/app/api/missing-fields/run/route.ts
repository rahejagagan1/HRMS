import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { canUseMissingFields } from "@/lib/missing-fields/access";
import { FIELD_KEYS, FIELD_BY_KEY, isFieldEmpty, isStatusInScope, type StatusPlan } from "@/lib/missing-fields/catalog";

export const dynamic = "force-dynamic";

// GET /api/missing-fields/run
// Manual scan. For each case in an active capsule, look up the required fields
// the capsule's plan defines FOR THAT CASE'S STATUS, and flag the ones that are
// empty. A status with no requirements (or a status not in the plan) is skipped
// — that's how rejected / published / off-flow statuses drop out automatically.
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canUseMissingFields(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const cfgRows = await prisma.$queryRawUnsafe<Array<{ activeListIds: unknown }>>(
      `SELECT "activeListIds" FROM "MissingFieldsConfig" WHERE id = 1`,
    );
    const activeListIds: number[] = Array.isArray(cfgRows[0]?.activeListIds) ? (cfgRows[0]!.activeListIds as number[]) : [];
    if (activeListIds.length === 0) {
      return NextResponse.json({ results: [], summary: { scanned: 0, flagged: 0, noRule: 0 }, note: "No capsules configured." });
    }

    const planRows = await prisma.$queryRawUnsafe<Array<{ productionListId: number; requiredFields: unknown }>>(
      `SELECT "productionListId", "requiredFields" FROM "CapsuleFieldPlan"`,
    );
    const planByList = new Map<number, StatusPlan>();
    for (const p of planRows) {
      planByList.set(p.productionListId, (p.requiredFields && typeof p.requiredFields === "object" && !Array.isArray(p.requiredFields)) ? (p.requiredFields as StatusPlan) : {});
    }

    const cases = await prisma.case.findMany({
      where: { productionListId: { in: activeListIds }, isArchived: false },
      include: {
        productionList: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });

    // Skip terminal statuses (ClickUp done/closed: rejected, complete, for
    // compilation, copyright, move to bodycam) — but KEEP ready to upload +
    // published on yt (allowlisted). Null type = treat as active.
    const active = cases.filter((c) => isStatusInScope(c.status, c.statusType));

    const results: Array<{
      caseId: number; name: string; clickupUrl: string | null; status: string;
      capsule: { id: number; name: string }; assignee: string | null;
      missing: Array<{ key: string; label: string; phase: string | undefined }>;
    }> = [];
    let noRule = 0; // cases whose status has no requirement defined → skipped

    for (const c of active) {
      const plan = planByList.get(c.productionListId) ?? {};
      const required = Array.isArray(plan[c.status]) ? plan[c.status] : [];
      if (required.length === 0) { noRule++; continue; }

      const missing = required.filter((k) => FIELD_KEYS.has(k) && isFieldEmpty((c as any)[k]));
      if (missing.length === 0) continue;

      results.push({
        caseId: c.id,
        name: c.name,
        clickupUrl: c.clickupUrl,
        status: c.status,
        capsule: { id: c.productionListId, name: c.productionList?.name ?? `List ${c.productionListId}` },
        assignee: c.assignee?.name ?? null,
        missing: missing.map((k) => ({ key: k, label: FIELD_BY_KEY[k]?.label ?? k, phase: FIELD_BY_KEY[k]?.phase })),
      });
    }

    results.sort((a, b) => b.missing.length - a.missing.length);

    const summary = { scanned: active.length, flagged: results.length, noRule, excludedTerminal: cases.length - active.length };

    // Record this run in history (so the tool can show past runs with dates).
    // Best-effort — never fail the run if the insert hiccups.
    let runId: number | null = null;
    let runAt: string | null = null;
    try {
      const u = session!.user as any;
      const ins = await prisma.$queryRawUnsafe<Array<{ id: number; runAt: Date }>>(
        `INSERT INTO "MissingFieldsRun" ("runByName","scanned","flagged","summary","results")
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb) RETURNING id, "runAt"`,
        u?.name ?? u?.dbName ?? null, summary.scanned, summary.flagged, JSON.stringify(summary), JSON.stringify(results),
      );
      runId = ins[0]?.id ?? null;
      runAt = ins[0]?.runAt ? new Date(ins[0].runAt).toISOString() : null;
      await prisma.$executeRawUnsafe(`DELETE FROM "MissingFieldsRun" WHERE id NOT IN (SELECT id FROM "MissingFieldsRun" ORDER BY "runAt" DESC LIMIT 50)`);
    } catch { /* history is best-effort */ }

    return NextResponse.json({ results, summary, runId, runAt });
  } catch (e) {
    return serverError(e, "GET /api/missing-fields/run");
  }
}
