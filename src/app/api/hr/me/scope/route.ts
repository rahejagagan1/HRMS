// GET /api/hr/me/scope
//
// Returns the caller's brand-scope info so client components can
// decide whether to render a brand switcher (super-admins) or lock
// the view to the user's own brand (single-brand HR Managers).
//
// Response:
//   { allBrands: boolean, brand: "NB Media" | "YT Labs" | null }

import { NextResponse } from "next/server";
import { requireAuth, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const scope = getBrandScope(session!.user);
    return NextResponse.json({
      allBrands: scope.allBrands,
      brand: scope.brand,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/me/scope");
  }
}
