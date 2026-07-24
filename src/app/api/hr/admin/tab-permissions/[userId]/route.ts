import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import {
  tabPermissionsForUser,
  seedDefaultPermissionsIfMissing,
  hasProtectedRole,
  savePermissions,
} from "@/lib/permissions/resolve";
import { getPermissionsForUserId } from "@/lib/permissions/resolve-permissions";
import { normaliseBrandParam } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): shared isHRAdmin resolves
// MANAGE_HR from the caller's designation. Replaced a local legacy copy.
import { isHRAdmin } from "@/lib/access";
function canManage(session: any): boolean {
  return isHRAdmin(session?.user);
}

/**
 * GET /api/hr/admin/tab-permissions/:userId
 *
 * Returns the target user's current tab permissions + protected flag.
 * SIDE EFFECT: if the user has never had permissions set, seeds the
 * defaults and clears the "NEW" badge. Calling GET on a new user's row
 * is how the admin "acknowledges" them.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const { userId: userIdRaw } = await params;
    const targetId = parseInt(userIdRaw, 10);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }

    const actorId = await resolveUserId(session);
    const { seeded } = await seedDefaultPermissionsIfMissing(targetId, actorId);

    // ?brand= (nb-media / yt-labs) resolves that brand's effective switches;
    // omitted → the generic all-brands view. Only meaningful for targets
    // holding VIEW_ALL_BRANDS — the UI shows brand pills for them.
    const brand = normaliseBrandParam(_req.nextUrl.searchParams.get("brand"));

    const [target, permissions, targetPerms] = await Promise.all([
      prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, name: true, email: true, profilePictureUrl: true, orgLevel: true, role: true },
      }),
      tabPermissionsForUser(targetId, brand),
      getPermissionsForUserId(targetId),
    ]);

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const targetIsDeveloper = devEmails.includes(target.email.toLowerCase());

    // Whether the *viewer* is a developer — they can override the
    // protected lock and edit anyone's permissions, including CEO and
    // other developers. The UI uses this to keep toggles enabled.
    const actorIsDeveloper = (session!.user as any)?.isDeveloper === true;

    return NextResponse.json({
      user: { ...target, isDeveloper: targetIsDeveloper },
      protected: hasProtectedRole({ ...target, isDeveloper: targetIsDeveloper }),
      actorIsDeveloper,
      permissions,
      // True when the target can see multiple brands (VIEW_ALL_BRANDS) —
      // the UI shows per-brand pills so their switches can differ per brand.
      targetAllBrands: targetPerms.includes("VIEW_ALL_BRANDS"),
      brand: brand ?? "",
      wasNew: seeded,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/admin/tab-permissions/[userId]");
  }
}

/**
 * PUT /api/hr/admin/tab-permissions/:userId
 *
 * Body: { permissions: { [tabKey]: boolean } }
 * Upserts each key; protected-role users are returned unchanged (UI
 * already greys out their toggles, this is the backend enforcement).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const { userId: userIdRaw } = await params;
    const targetId = parseInt(userIdRaw, 10);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    const actorId = await resolveUserId(session);
    const body = await req.json();
    const incoming: Record<string, boolean> = body?.permissions ?? {};
    // Optional brand scope for the switches being saved: "" (default) =
    // generic all-brands rows; "NB Media"/"YT Labs" = that brand's
    // override rows (used for See-all-brands users).
    const brand = normaliseBrandParam(body?.brand) ?? "";

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { email: true, orgLevel: true, role: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const targetIsDeveloper = devEmails.includes(target.email.toLowerCase());

    // Developers (the actor, not the target) are the ultimate override —
    // they can flip toggles on anyone, including CEO / special_access /
    // other developers. The "protected" lock exists to stop HR-admins
    // from accidentally locking the CEO out, but a developer doing it
    // deliberately is a debugging / power-user action we permit.
    const actorIsDeveloper = (session!.user as any)?.isDeveloper === true;

    if (
      !actorIsDeveloper &&
      hasProtectedRole({ ...target, isDeveloper: targetIsDeveloper })
    ) {
      // Silent success — protected users always have everything.
      const permissions = await tabPermissionsForUser(targetId);
      return NextResponse.json({ permissions, protected: true });
    }

    // Uses raw SQL internally so it's resilient to the typed Prisma
    // client not yet knowing about the UserTabPermission model.
    await savePermissions(targetId, incoming, actorId ?? null, brand);
    const permissions = await tabPermissionsForUser(targetId, brand || null);
    return NextResponse.json({
      permissions,
      // Surface "protected" honestly (so the UI shows the lock note for
      // non-devs) but still report `false` to the developer who just
      // saved it — they unlocked it for this write.
      protected: !actorIsDeveloper && hasProtectedRole({ ...target, isDeveloper: targetIsDeveloper }),
    });
  } catch (e) {
    return serverError(e, "PUT /api/hr/admin/tab-permissions/[userId]");
  }
}
