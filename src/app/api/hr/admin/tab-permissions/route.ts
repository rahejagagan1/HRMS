import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): shared isHRAdmin resolves
// MANAGE_HR from the caller's designation. Replaced a local legacy copy.
function canManage(session: any): boolean {
  return isHRAdmin(session?.user);
}

/**
 * GET /api/hr/admin/tab-permissions
 *
 * Returns every active user with an `isNew` flag = true when they have
 * zero rows in UserTabPermission yet. Uses raw SQL for the
 * permission-lookup so the handler stays functional even before the
 * Prisma client is regenerated after adding the new model.
 */
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, profilePictureUrl: true,
        orgLevel: true, role: true,
        employeeProfile: { select: { businessUnit: true } },
      },
      orderBy: [{ name: "asc" }],
    });

    // Raw SQL avoids needing the UserTabPermission model on the typed
    // client — works immediately after `prisma migrate deploy`, before
    // `prisma generate` has re-run. If the table doesn't exist yet (pre-
    // migrate), treat every user as NEW.
    let userIdsWithPerms = new Set<number>();
    try {
      const rows = await prisma.$queryRawUnsafe<{ userId: number }[]>(
        `SELECT DISTINCT "userId" FROM "UserTabPermission"`
      );
      userIdsWithPerms = new Set(rows.map((r) => Number(r.userId)));
    } catch {
      // Table not created yet — everyone is NEW.
    }

    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        profilePictureUrl: u.profilePictureUrl,
        orgLevel: u.orgLevel,
        role: u.role,
        businessUnit: u.employeeProfile?.businessUnit ?? null,
        isNew: !userIdsWithPerms.has(u.id),
      }))
    );
  } catch (e) {
    return serverError(e, "GET /api/hr/admin/tab-permissions");
  }
}
