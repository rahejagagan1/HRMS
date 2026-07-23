import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { canUseMissingFields } from "@/lib/missing-fields/access";
import { clickupApi } from "@/lib/clickup/api-client";
import { isStatusInScope, type StatusPlan } from "@/lib/missing-fields/catalog";

export const dynamic = "force-dynamic";

// GET /api/missing-fields/config
// Each active capsule with its case count, the FULL active flow (every
// non-terminal status from the ClickUp list definition, in board order — even
// statuses with 0 cases), and its saved plan (status -> required field keys).
// Falls back to statuses-that-have-cases if the ClickUp fetch fails.
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
    const activeListIds = Array.isArray(cfgRows[0]?.activeListIds) ? (cfgRows[0]!.activeListIds as number[]) : [];
    if (activeListIds.length === 0) return NextResponse.json({ capsules: [] });

    const [listRows, planRows, statusRows] = await Promise.all([
      prisma.productionList.findMany({
        where: { id: { in: activeListIds } },
        select: { id: true, name: true, clickupListId: true, _count: { select: { cases: true } } },
      }),
      prisma.$queryRawUnsafe<Array<{ productionListId: number; requiredFields: unknown }>>(
        `SELECT "productionListId", "requiredFields" FROM "CapsuleFieldPlan"`,
      ),
      prisma.case.groupBy({
        by: ["productionListId", "status", "statusType"],
        where: { productionListId: { in: activeListIds }, isArchived: false },
        _count: { _all: true },
      }),
    ]);

    // The full status flow comes from each ClickUp list definition (so empty
    // stages still show). Each entry: { status, type, orderindex }.
    const cuByList = new Map<number, Array<{ status: string; type: string; orderindex: number }>>();
    await Promise.all(
      listRows.map(async (l) => {
        try {
          const cu = await clickupApi<any>(`/list/${l.clickupListId}`);
          cuByList.set(l.id, (cu?.statuses || []).map((s: any) => ({ status: String(s.status), type: String(s.type ?? ""), orderindex: Number(s.orderindex) })));
        } catch {
          /* fall back to statuses-with-cases below */
        }
      }),
    );

    const planByList = new Map<number, StatusPlan>();
    for (const p of planRows) {
      planByList.set(p.productionListId, (p.requiredFields && typeof p.requiredFields === "object" && !Array.isArray(p.requiredFields)) ? (p.requiredFields as StatusPlan) : {});
    }

    // Case counts keyed by (listId, lowercased status).
    const counts = new Map<string, number>();
    for (const s of statusRows) counts.set(`${s.productionListId}|${String(s.status).toLowerCase()}`, s._count._all);
    // Fallback list (in-scope statuses that have cases) — used only if ClickUp fetch failed.
    const fallbackByList = new Map<number, Array<{ status: string; count: number }>>();
    for (const s of statusRows) {
      if (!isStatusInScope(s.status, s.statusType)) continue;
      if (!fallbackByList.has(s.productionListId)) fallbackByList.set(s.productionListId, []);
      fallbackByList.get(s.productionListId)!.push({ status: s.status, count: s._count._all });
    }

    const capsules = activeListIds
      .map((id) => {
        const l = listRows.find((x) => x.id === id);
        if (!l) return null;
        const cu = cuByList.get(id);
        let statuses: Array<{ status: string; count: number }>;
        if (cu && cu.length) {
          statuses = cu
            .filter((s) => isStatusInScope(s.status, s.type))
            .sort((a, b) => a.orderindex - b.orderindex)
            .map((s) => ({ status: s.status, count: counts.get(`${id}|${s.status.toLowerCase()}`) ?? 0 }));
        } else {
          statuses = (fallbackByList.get(id) ?? []).slice().sort((a, b) => b.count - a.count);
        }
        return { id, name: l.name, caseCount: l._count.cases, statuses, plan: planByList.get(id) ?? {} };
      })
      .filter((c): c is { id: number; name: string; caseCount: number; statuses: Array<{ status: string; count: number }>; plan: StatusPlan } => c !== null);

    return NextResponse.json({ capsules });
  } catch (e) {
    return serverError(e, "GET /api/missing-fields/config");
  }
}
