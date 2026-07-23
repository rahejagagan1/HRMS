// GET /api/hr/my-team/pip — the caller's direct reports currently on a
// Performance Improvement Plan (pipStartedAt set, active, plan not ended).
// Raw SQL — the pip* columns lag the typed client.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "No user" }, { status: 400 });

    let employees: any[] = [];
    try {
      employees = await prisma.$queryRawUnsafe<any[]>(
        `SELECT u.id AS "userId", u.name,
                ep.designation, ep."employeeId",
                COALESCE(ep."businessUnit", 'NB Media') AS "businessUnit",
                to_char(ep."pipStartedAt", 'YYYY-MM-DD') AS "pipStartedAt",
                to_char(ep."pipEndDate",   'YYYY-MM-DD') AS "pipEndDate",
                ep."pipReason",
                rb.name AS "reportedByName",
                CASE WHEN ep."pipEndDate" IS NULL THEN NULL
                     ELSE (ep."pipEndDate"::date - CURRENT_DATE) END AS "daysRemaining"
           FROM "User" u
           JOIN "EmployeeProfile" ep ON ep."userId" = u.id
           LEFT JOIN "User" rb ON rb.id = ep."pipReportedById"
          WHERE u."managerId" = $1
            AND u."isActive" = true
            AND ep."pipStartedAt" IS NOT NULL
            AND (ep."pipEndDate" IS NULL OR ep."pipEndDate" >= CURRENT_DATE)
          ORDER BY ep."pipStartedAt" DESC`,
        me,
      );
    } catch (e) {
      // pip columns not present yet (pre-migration) → empty list, no 500.
      console.warn("[my-team/pip] lookup failed (columns missing?):", e);
      employees = [];
    }

    return NextResponse.json({ employees });
  } catch (e) {
    return serverError(e, "GET /api/hr/my-team/pip");
  }
}
