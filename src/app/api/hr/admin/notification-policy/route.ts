import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";
import { parseBody } from "@/lib/validate";
import { defaultPolicyFor, isDeveloperEmail } from "@/lib/hr/notification-policy";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/admin/notification-policy
 *
 * HR-admin only. Returns one row per active employee with the effective
 * Attendance + Payroll toggle state. `source` is "override" when there's
 * an explicit DB row, "default" when we're falling back to role-based
 * defaults (CEO + developers → both off; everyone else → both on).
 *
 * Shape:
 *   {
 *     users: [
 *       { id, name, email, department, role, orgLevel, isDeveloper,
 *         attendanceEnabled, payrollEnabled, source }
 *     ]
 *   }
 */
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // Two queries instead of a typed `notificationPolicy: { select }` join —
    // dev/VPS Prisma clients can lag behind the migration (Next caches the
    // generated client in memory; a `prisma generate` doesn't refresh a
    // running dev server). Raw SQL on the new table sidesteps the cache.
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, role: true, orgLevel: true,
        profilePictureUrl: true,
        employeeProfile: { select: { department: true, businessUnit: true } },
      },
    });
    type Override = {
      userId: number;
      attendanceEnabled: boolean;
      payrollEnabled: boolean;
      updatedAt: Date | null;
      updaterId: number | null;
      updaterName: string | null;
    };
    let policyByUser = new Map<number, Override>();
    try {
      const rows = await prisma.$queryRawUnsafe<Array<Override>>(
        `SELECT p."userId", p."attendanceEnabled", p."payrollEnabled",
                p."updatedAt", p."updatedById" AS "updaterId",
                upd.name AS "updaterName"
           FROM "EmployeeNotificationPolicy" p
           LEFT JOIN "User" upd ON upd.id = p."updatedById"`,
      );
      policyByUser = new Map(rows.map((r) => [r.userId, r]));
    } catch (e) {
      // Table missing → treat everyone as default; surface the error in
      // server logs but keep the page usable.
      console.warn("[notification-policy GET] EmployeeNotificationPolicy lookup failed:", e);
    }

    const rows = users.map((u) => {
      const isDev = isDeveloperEmail(u.email);
      const override = policyByUser.get(u.id);
      if (override) {
        return {
          id: u.id, name: u.name, email: u.email,
          department: u.employeeProfile?.department ?? null,
          businessUnit: u.employeeProfile?.businessUnit ?? null,
          role: u.role, orgLevel: u.orgLevel, isDeveloper: isDev,
          profilePictureUrl: u.profilePictureUrl,
          attendanceEnabled: override.attendanceEnabled,
          payrollEnabled:    override.payrollEnabled,
          source: "override" as const,
          // Audit trail — surfaced in the Attendance tab toggle so HR
          // can see who paused / resumed counting + when.
          updatedAt:   override.updatedAt,
          updatedById: override.updaterId,
          updatedByName: override.updaterName,
        };
      }
      const def = defaultPolicyFor({ orgLevel: u.orgLevel, email: u.email });
      return {
        id: u.id, name: u.name, email: u.email,
        department: u.employeeProfile?.department ?? null,
        businessUnit: u.employeeProfile?.businessUnit ?? null,
        role: u.role, orgLevel: u.orgLevel, isDeveloper: isDev,
        profilePictureUrl: u.profilePictureUrl,
        attendanceEnabled: def.attendanceEnabled,
        payrollEnabled:    def.payrollEnabled,
        source: "default" as const,
        updatedAt: null, updatedById: null, updatedByName: null,
      };
    });
    return NextResponse.json({ users: rows });
  } catch (e) {
    return serverError(e, "GET /api/hr/admin/notification-policy");
  }
}

const PutBody = z.object({
  userId: z.number().int(),
  attendanceEnabled: z.boolean().optional(),
  payrollEnabled:    z.boolean().optional(),
});

/**
 * PUT /api/hr/admin/notification-policy
 *
 * Upsert a single user's policy row. Either field optional; missing fields
 * default to the user's effective current value (so flipping just one
 * toggle doesn't accidentally reset the other to the role default).
 */
export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const parsed = await parseBody(req, PutBody);
    if (!parsed.ok) return parsed.error;
    const { userId } = parsed.data;
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, orgLevel: true, email: true },
    });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Existing override (if any) read via raw SQL — see GET note.
    const existing = await prisma.$queryRawUnsafe<Array<{ attendanceEnabled: boolean; payrollEnabled: boolean }>>(
      `SELECT "attendanceEnabled", "payrollEnabled" FROM "EmployeeNotificationPolicy" WHERE "userId" = $1 LIMIT 1`,
      userId,
    );
    const current = existing[0]
      ? { attendanceEnabled: existing[0].attendanceEnabled, payrollEnabled: existing[0].payrollEnabled }
      : defaultPolicyFor({ orgLevel: target.orgLevel, email: target.email });
    const next = {
      attendanceEnabled: parsed.data.attendanceEnabled ?? current.attendanceEnabled,
      payrollEnabled:    parsed.data.payrollEnabled    ?? current.payrollEnabled,
    };
    const updaterId = (self.dbId as number | undefined) ?? null;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "EmployeeNotificationPolicy" ("userId","attendanceEnabled","payrollEnabled","updatedById","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,NOW(),NOW())
       ON CONFLICT ("userId") DO UPDATE SET
         "attendanceEnabled" = EXCLUDED."attendanceEnabled",
         "payrollEnabled"    = EXCLUDED."payrollEnabled",
         "updatedById"       = EXCLUDED."updatedById",
         "updatedAt"         = NOW()`,
      userId, next.attendanceEnabled, next.payrollEnabled, updaterId,
    );
    return NextResponse.json({
      userId,
      attendanceEnabled: next.attendanceEnabled,
      payrollEnabled:    next.payrollEnabled,
      source: "override",
    });
  } catch (e) {
    return serverError(e, "PUT /api/hr/admin/notification-policy");
  }
}

/**
 * DELETE /api/hr/admin/notification-policy?userId=N
 *
 * Removes a single user's override row, falling back to role defaults.
 * Without `userId` → wipes EVERY override (bulk "restore role defaults").
 */
export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const userIdRaw = searchParams.get("userId");
    if (userIdRaw) {
      const userId = parseInt(userIdRaw, 10);
      if (!Number.isFinite(userId)) return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
      await prisma.$executeRawUnsafe(
        `DELETE FROM "EmployeeNotificationPolicy" WHERE "userId" = $1`,
        userId,
      );
      return NextResponse.json({ ok: true, scope: "single", userId });
    }
    const count = await prisma.$executeRawUnsafe(
      `DELETE FROM "EmployeeNotificationPolicy"`,
    );
    return NextResponse.json({ ok: true, scope: "all", deleted: Number(count) });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/admin/notification-policy");
  }
}
