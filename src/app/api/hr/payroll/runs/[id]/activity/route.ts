import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";

// GET /api/hr/payroll/runs/[id]/activity
//
// Activity feed for the Keka "Run Payroll" right-rail. Surfaces every
// AuditLog row tied to:
//   • PayrollRun          (this exact id)
//   • Payslip / EmployeeBonus / SalaryStructure (during the run's month
//     — those are the audited surfaces that affect the cycle)
// Sorted newest first, capped at 20 (the rail is tight).
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idRaw } = await params;
    const runId = parseInt(idRaw);
    if (!Number.isFinite(runId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Inclusive month boundary in UTC. Bonuses + structure edits use
    // createdAt; for "affected this cycle" we filter by ±the run month.
    const monthStart = new Date(Date.UTC(run.year, run.month,     1));
    const monthEnd   = new Date(Date.UTC(run.year, run.month + 1, 1));

    const rows = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "PayrollRun", entityId: String(runId) },
          { entityType: { in: ["Payslip", "EmployeeBonus", "SalaryStructure"] }, createdAt: { gte: monthStart, lt: monthEnd } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, action: true, entityType: true, entityId: true,
        actorId: true, actorEmail: true, createdAt: true, metadata: true,
      },
    });

    // Hydrate actor names so the UI can render "Tanvi locked May 2026"
    // instead of bare emails.
    const actorIds = Array.from(new Set(rows.map((r) => r.actorId).filter((x): x is number => !!x)));
    const actors = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const actorMap = new Map(actors.map((u) => [u.id, u.name]));

    return NextResponse.json({
      runId,
      items: rows.map((r) => ({
        id:        r.id,
        action:    r.action,
        entityType: r.entityType,
        entityId:  r.entityId,
        actorName: r.actorId ? (actorMap.get(r.actorId) ?? r.actorEmail) : (r.actorEmail ?? "system"),
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/runs/[id]/activity");
  }
}
