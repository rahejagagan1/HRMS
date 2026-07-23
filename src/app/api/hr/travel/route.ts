import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  const isAdmin = isHRAdmin(user);
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "my";

  try {
    // Brand-scope: admin "view=all" stays scoped to caller's brand
    // unless allowlisted. Closes cross-brand travel-request leak.
    const scope = getBrandScope(user);
    const adminBrandFilter: any = scope.allBrands
      ? {}
      : (scope.brand
          ? { user: { employeeProfile: { businessUnit: scope.brand } } }
          : { userId: -1 });

    const where =
      view === "team" && !isAdmin ? { user: { managerId: myId! } } :
      view === "all"  && isAdmin  ? adminBrandFilter :
                                    { userId: myId! };

    const reqs = await prisma.travelRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approvedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reqs);
  } catch (e) { return serverError(e, "GET /api/hr/travel"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { purpose, fromLocation, toLocation, travelDate, returnDate, estimatedCost, advanceNeeded, advanceAmount } = await req.json();
    if (!purpose || !fromLocation || !toLocation || !travelDate)
      return NextResponse.json({ error: "purpose, fromLocation, toLocation, travelDate required" }, { status: 400 });

    const rec = await prisma.travelRequest.create({
      data: {
        userId: myId, purpose, fromLocation, toLocation,
        travelDate: new Date(travelDate),
        returnDate: returnDate ? new Date(returnDate) : null,
        estimatedCost: estimatedCost ? parseFloat(estimatedCost) : null,
        advanceNeeded: !!advanceNeeded,
        advanceAmount: advanceAmount ? parseFloat(advanceAmount) : null,
      },
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/travel"); }
}
