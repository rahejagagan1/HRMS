// POST /api/hr/exits/[id]/rehire
//
// Brings a past employee back as a CLEAN, ordinary employee — not as an
// "exited person who is somehow active". Everything the exit turned off is
// turned back on, and everything that made them look like a leaver is
// removed, so the profile is indistinguishable from a normal hire and a
// FUTURE exit can be recorded from scratch.
//
// What it does, in one transaction:
//   1. snapshot the exit (+ its settlement / notes / tasks) into AuditLog —
//      the row itself is about to go, and its children cascade with it
//   2. DELETE the EmployeeExit row → the person leaves the offboard list,
//      stops being hidden from the attendance board, and `userId @unique`
//      is freed so they can be exited again later
//   3. User.isActive = true
//   4. EmployeeProfile.joiningDate = the rejoin date → attendance-log
//      synthesis, payroll proration and tenure all restart from that day
//      using the existing new-joiner paths (no special-casing anywhere)
//   5. leave balances for the CURRENT year reset to a fresh entitlement:
//      usedDays / pendingDays zeroed, totalDays re-seeded from the assigned
//      leave policy. The previous stint's consumption (and any carry-over
//      that was encashed at F&F) must not follow them into the new one.
//
// The old employee code, documents, payslips and attendance history are all
// kept — those belong to the person, not to the stint.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const exitId = parseInt((await params).id, 10);
    if (!Number.isFinite(exitId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({} as any));
    const raw = String(body?.rejoinDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return NextResponse.json({ error: "rejoinDate is required (YYYY-MM-DD)" }, { status: 400 });
    }
    const rejoin = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(rejoin.getTime())) {
      return NextResponse.json({ error: "Invalid rejoinDate" }, { status: 400 });
    }

    // ── Load everything we're about to destroy, for the audit snapshot ──
    const exitRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT e.*, u.name AS "userName", u.email AS "userEmail", ep."joiningDate" AS "previousJoiningDate"
         FROM "EmployeeExit" e
         JOIN "User" u ON u.id = e."userId"
    LEFT JOIN "EmployeeProfile" ep ON ep."userId" = e."userId"
        WHERE e.id = $1`,
      exitId,
    );
    const exit = exitRows[0];
    if (!exit) return NextResponse.json({ error: "Exit not found" }, { status: 404 });
    const userId: number = exit.userId;

    const [settlement, notes, tasks] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ExitSettlement" WHERE "exitId" = $1`, exitId).catch(() => []),
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ExitNote" WHERE "exitId" = $1`, exitId).catch(() => []),
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ExitTask" WHERE "exitId" = $1`, exitId).catch(() => []),
    ]);

    // Leave entitlement for the fresh stint. Same source new joiners use:
    // the assigned LeavePolicy's per-type daysPerYear. No policy → balances
    // are simply zeroed and HR sets them on the Leave Balances matrix.
    const year = rejoin.getUTCFullYear();
    // NOTE: the FK on LeavePolicyEntry is `policyId` (NOT `leavePolicyId`,
    // which is the column on User). Deliberately NOT wrapped in a catch — a
    // failure here must surface, because the balance wipe below would
    // otherwise leave the person on zero days with nothing re-seeded.
    const policyEntries = await prisma.$queryRawUnsafe<Array<{ leaveTypeId: number; daysPerYear: any }>>(
      `SELECT lpe."leaveTypeId", lpe."daysPerYear"
         FROM "User" u
         JOIN "LeavePolicyEntry" lpe ON lpe."policyId" = u."leavePolicyId"
        WHERE u.id = $1`,
      userId,
    );

    const actorId = await resolveUserId(session);

    // ── Snapshot BEFORE the delete (children cascade away with the row) ──
    await writeAuditLog({
      req,
      actorId: actorId ?? null,
      actorEmail: (session!.user as any)?.email ?? null,
      action: "hr.employee.rehire",
      entityType: "EmployeeExit",
      entityId: exitId,
      before: {
        exit,
        settlement: settlement[0] ?? null,
        notes,
        tasks,
      },
      after: { rejoinDate: raw, userId },
      metadata: {
        note: "Exit record removed on rehire; this entry is the archived copy.",
        previousJoiningDate: exit.previousJoiningDate ?? null,
        previousLastWorkingDay: exit.lastWorkingDay ?? null,
      },
    });

    await prisma.$transaction(async (tx) => {
      // 1. account back on
      await tx.$executeRawUnsafe(`UPDATE "User" SET "isActive" = TRUE WHERE id = $1`, userId);

      // 2. fresh joining date — drives attendance synthesis + payroll proration
      await tx.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "joiningDate" = $1 WHERE "userId" = $2`,
        rejoin, userId,
      );

      // 3. leave balances restart: wipe this year's consumption, re-seed the
      //    entitlement. Types outside the policy are zeroed rather than
      //    deleted so the Leave Balances matrix keeps its shape.
      await tx.$executeRawUnsafe(
        `UPDATE "LeaveBalance"
            SET "usedDays" = 0, "pendingDays" = 0, "totalDays" = 0,
                "lastAccrualMonth" = NULL, "updatedAt" = NOW()
          WHERE "userId" = $1 AND year = $2`,
        userId, year,
      );
      for (const e of policyEntries) {
        // `updatedAt` must be written explicitly: Prisma's @updatedAt is
        // applied by the CLIENT, so a raw INSERT leaves it NULL and trips
        // the NOT NULL constraint.
        await tx.$executeRawUnsafe(
          `INSERT INTO "LeaveBalance"
             ("userId","leaveTypeId",year,"totalDays","usedDays","pendingDays","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,0,0,NOW(),NOW())
           ON CONFLICT ("userId","leaveTypeId",year)
           DO UPDATE SET "totalDays" = EXCLUDED."totalDays", "usedDays" = 0, "pendingDays" = 0,
                         "lastAccrualMonth" = NULL, "updatedAt" = NOW()`,
          userId, e.leaveTypeId, year, e.daysPerYear,
        );
      }

      // 4. the exit itself goes — profile becomes an ordinary employee and
      //    a future exit can be recorded against the freed unique userId.
      await tx.$executeRawUnsafe(`DELETE FROM "EmployeeExit" WHERE id = $1`, exitId);
    });

    return NextResponse.json({
      ok: true,
      userId,
      rejoinDate: raw,
      leaveTypesReset: policyEntries.length,
      archivedToAuditLog: true,
    });
  } catch (e) {
    return serverError(e, "POST /api/hr/exits/[id]/rehire");
  }
}
