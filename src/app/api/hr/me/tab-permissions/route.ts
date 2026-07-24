import { NextRequest, NextResponse } from "next/server";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { tabPermissionsForUser } from "@/lib/permissions/resolve";
import { normaliseBrandParam } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/me/tab-permissions[?brand=nb-media|yt-labs]
 *
 * Returns the *caller's* effective tab permissions. Used by the sidebar
 * to hide tabs a user can't access. Protected roles get `true` for
 * every tab. `?brand=` resolves brand-specific overrides on top of the
 * generic switches — the HR admin page passes the brand it's showing so
 * a See-all-brands user can have different tabs per brand.
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const userId = await resolveUserId(session);
    if (!userId) {
      // Fall back: allow everything so we don't soft-brick the UI for
      // accounts that aren't in the DB yet.
      return NextResponse.json({ permissions: {} });
    }
    const brand = normaliseBrandParam(req.nextUrl.searchParams.get("brand"));
    const permissions = await tabPermissionsForUser(userId, brand);
    return NextResponse.json({ permissions });
  } catch (e) {
    return serverError(e, "GET /api/hr/me/tab-permissions");
  }
}
