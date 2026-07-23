// GET /api/hr/payroll/salary-structure/history?userId=N
//
// Per-employee salary-revision timeline, reconstructed from the AuditLog
// (entityType='SalaryStructure' — same source the payroll Salary Revisions
// list uses). Each row is one change: old CTC → new CTC, the effectiveFrom it
// was set to, when it was changed, and by whom. Newest first.
//
// There's no separate salary-history table; the audit before/after blobs are
// the record. HR-admin (salary viewers) only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  action: string;
  oldCtc: string | null;
  newCtc: string | null;
  effectiveFrom: Date | null;
  changedAt: Date;
  actorName: string | null;
};

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const userId = parseInt(new URL(req.url).searchParams.get("userId") ?? "");
    if (!Number.isFinite(userId)) return NextResponse.json({ error: "Bad userId" }, { status: 400 });

    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT al.id,
              al.action,
              (al.before->>'ctc')                               AS "oldCtc",
              (al.after->>'ctc')                                AS "newCtc",
              NULLIF(al.after->>'effectiveFrom','')::timestamp  AS "effectiveFrom",
              al."createdAt"                                    AS "changedAt",
              actor.name                                        AS "actorName"
         FROM "AuditLog" al
         LEFT JOIN "User" actor ON actor.id = al."actorId"
        WHERE al."entityType" = 'SalaryStructure'
          AND (al.after->>'userId')::int = $1
        ORDER BY al."createdAt" DESC`,
      userId,
    );
    return NextResponse.json({ items: rows });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/salary-structure/history"); }
}
