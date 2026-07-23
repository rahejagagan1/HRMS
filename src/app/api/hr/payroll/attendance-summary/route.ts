// GET /api/hr/payroll/attendance-summary?month=N&year=YYYY&kind=no_attendance|lop|lop_reversal
//
// Three Step 1 sub-steps share one endpoint, differentiated by ?kind=.
//   no_attendance : every active employee whose Attendance.absent count == 0
//                   AND present count == 0 for the cycle. Means HR forgot
//                   to mark them, or they were never clocked in.
//   lop           : per-user absent + half-day counts contributing to LOP.
//   lop_reversal  : approved leaves on a paid LeaveType that overlap the
//                   cycle — these should reverse any LOP otherwise stamped
//                   by an absent attendance row on the same date.
//
// HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { resolveBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { searchParams } = new URL(req.url);
    const month = parseInt(searchParams.get("month") ?? "");
    const year  = parseInt(searchParams.get("year")  ?? "");
    const kind  = String(searchParams.get("kind") ?? "");
    if (!Number.isFinite(month) || month < 0 || month > 11)
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    if (!Number.isFinite(year))
      return NextResponse.json({ error: "Bad year" }, { status: 400 });
    if (!["no_attendance", "lop", "lop_reversal"].includes(kind))
      return NextResponse.json({ error: "Bad kind" }, { status: 400 });

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0));

    // Brand-scope: filter to the caller's brand, or — for a cross-brand /
    // developer caller — to the brand chosen via the Run Payroll toggle
    // (?brand=). Without this, Step 1 leaked the OTHER brand's attendance,
    // LOP, and leave data. $3 carries the brand when scoped.
    const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
    if (!scope.allBrands && !scope.brand) return NextResponse.json({ items: [] });
    const brandClause = scope.allBrands ? "" : ` AND ep."businessUnit" = $3`;
    const brandArgs = scope.allBrands ? [] : [scope.brand];

    if (kind === "no_attendance") {
      const rows = await prisma.$queryRawUnsafe<{
        userId: number; userName: string; employeeId: string | null;
      }[]>(
        `SELECT u.id AS "userId", u.name AS "userName", ep."employeeId"
           FROM "User" u
      LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
          WHERE u."isActive" = TRUE
            ${brandClause}
            AND NOT EXISTS (
              SELECT 1 FROM "Attendance" a
               WHERE a."userId" = u.id
                 AND a.date >= $1 AND a.date <= $2
            )
          ORDER BY u.name ASC`,
        monthStart, monthEnd, ...brandArgs,
      );
      return NextResponse.json({ items: rows });
    }

    if (kind === "lop") {
      type LopRow = {
        userId: number; userName: string; employeeId: string | null;
        absentDays: number; halfDays: number; lwpDays: number; lopDays: number;
      };
      // 1) Attendance-based LOP. Include ALL loss-of-pay statuses so every LOP
      // employee shows — 'lop'/'half_day_lop' come from the auto-LOP job and
      // were previously missing. Mirrors payroll/generate: full-day = absent +
      // lop (1.0 each); half-day = half_day + half_day_lop (0.5 each).
      const attRows = await prisma.$queryRawUnsafe<{
        userId: number; userName: string; employeeId: string | null;
        absentDays: string; halfDays: string; lopDays: string;
      }[]>(
        `SELECT a."userId",
                u.name AS "userName",
                ep."employeeId",
                SUM(CASE WHEN a.status IN ('absent','lop') THEN 1 ELSE 0 END)::text            AS "absentDays",
                SUM(CASE WHEN a.status IN ('half_day','half_day_lop') THEN 1 ELSE 0 END)::text AS "halfDays",
                (SUM(CASE WHEN a.status IN ('absent','lop') THEN 1 ELSE 0 END)
                 + SUM(CASE WHEN a.status IN ('half_day','half_day_lop') THEN 0.5 ELSE 0 END))::text AS "lopDays"
           FROM "Attendance" a
           JOIN "User" u ON u.id = a."userId"
      LEFT JOIN "EmployeeProfile" ep ON ep."userId" = a."userId"
          WHERE a.date >= $1 AND a.date <= $2
            AND a.status IN ('absent', 'lop', 'half_day', 'half_day_lop')
            ${brandClause}
          GROUP BY a."userId", u.name, ep."employeeId"`,
        monthStart, monthEnd, ...brandArgs,
      );
      const byUser = new Map<number, LopRow>();
      for (const r of attRows) {
        byUser.set(r.userId, {
          userId: r.userId, userName: r.userName, employeeId: r.employeeId,
          absentDays: parseFloat(r.absentDays) || 0,
          halfDays:   parseFloat(r.halfDays) || 0,
          lwpDays:    0,
          lopDays:    parseFloat(r.lopDays) || 0,
        });
      }

      // 2) Unpaid-leave (LWP) days — approved leaves on an UNPAID leave type
      // that overlap the cycle. Payroll counts these weekdays as LOP too, so
      // include them here (as an LWP column, added into the final LOP) to give
      // HR the full picture of what was deducted.
      const lwpRows = await prisma.$queryRawUnsafe<{
        userId: number; userName: string; employeeId: string | null; fromDate: Date; toDate: Date;
      }[]>(
        `SELECT la."userId", u.name AS "userName", ep."employeeId", la."fromDate", la."toDate"
           FROM "LeaveApplication" la
           JOIN "User" u ON u.id = la."userId"
      LEFT JOIN "EmployeeProfile" ep ON ep."userId" = la."userId"
           JOIN "LeaveType" lt ON lt.id = la."leaveTypeId"
          WHERE la.status = 'approved' AND lt."isPaid" = FALSE
            AND la."fromDate" <= $2 AND la."toDate" >= $1
            ${brandClause}`,
        monthStart, monthEnd, ...brandArgs,
      );
      for (const lv of lwpRows) {
        const from = new Date(lv.fromDate), to = new Date(lv.toDate);
        const start = from > monthStart ? from : monthStart;
        const end   = to   < monthEnd   ? to   : monthEnd;
        const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
        const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
        let days = 0;
        while (cur.getTime() <= stop.getTime()) {
          const dow = cur.getUTCDay();
          if (dow !== 0 && dow !== 6) days += 1; // weekdays only, like payroll
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
        if (days <= 0) continue;
        const existing = byUser.get(lv.userId) ?? {
          userId: lv.userId, userName: lv.userName, employeeId: lv.employeeId,
          absentDays: 0, halfDays: 0, lwpDays: 0, lopDays: 0,
        };
        existing.lwpDays += days;
        existing.lopDays += days;
        byUser.set(lv.userId, existing);
      }

      const items = Array.from(byUser.values())
        .filter(r => r.lopDays > 0)
        .sort((a, b) => b.lopDays - a.lopDays)
        .map(r => ({
          userId: r.userId, userName: r.userName, employeeId: r.employeeId,
          absentDays: String(r.absentDays),
          halfDays:   String(r.halfDays),
          lwpDays:    String(r.lwpDays),
          lopDays:    String(r.lopDays),
        }));
      return NextResponse.json({ items });
    }

    // lop_reversal — leaves approved on a paid LeaveType during the cycle
    const rows = await prisma.$queryRawUnsafe<{
      id: number; userId: number; userName: string; employeeId: string | null;
      leaveType: string; fromDate: Date; toDate: Date; totalDays: string;
    }[]>(
      `SELECT la.id, la."userId", u.name AS "userName", ep."employeeId",
              lt.name AS "leaveType", la."fromDate", la."toDate",
              la."totalDays"::text AS "totalDays"
         FROM "LeaveApplication" la
         JOIN "User" u ON u.id = la."userId"
    LEFT JOIN "EmployeeProfile" ep ON ep."userId" = la."userId"
         JOIN "LeaveType" lt ON lt.id = la."leaveTypeId"
        WHERE la.status = 'approved'
          AND lt."isPaid" = TRUE
          AND la."fromDate" <= $2
          AND la."toDate"   >= $1
          ${brandClause}
        ORDER BY la."fromDate" DESC`,
      monthStart, monthEnd, ...brandArgs,
    );
    return NextResponse.json({ items: rows });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/attendance-summary"); }
}
