import { NextResponse } from "next/server";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { tabPermissionsForUser } from "@/lib/permissions/resolve";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/me/tab-permissions
 *
 * Returns the *caller's* effective tab permissions. Used by the sidebar
 * to hide tabs a user can't access. Protected roles get `true` for
 * every tab.
 */
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const userId = await resolveUserId(session);
    if (!userId) {
      // Fall back: allow everything so we don't soft-brick the UI for
      // accounts that aren't in the DB yet.
      return NextResponse.json({ permissions: {} });
    }
    const permissions = await tabPermissionsForUser(userId);
    return NextResponse.json({ permissions });
  } catch (e) {
    return serverError(e, "GET /api/hr/me/tab-permissions");
  }
}
