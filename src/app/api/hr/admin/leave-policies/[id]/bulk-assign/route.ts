import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
type Params = Promise<{ id: string }>;

// POST /api/hr/admin/leave-policies/[id]/bulk-assign?scope=unassigned|all
//
// HR-admin only. Bulk-assigns this policy to active users.
//
// Scopes:
//   • unassigned (default) — only users with leavePolicyId IS NULL.
//                            Use this when migrating from the old
//                            "Apply policy defaults" world to policies.
//   • all                  — every active user, overwriting any prior
//                            policy assignment. Use carefully.
//
// Does NOT call Apply afterwards — that's a separate explicit action so
// HR can review counts first.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idRaw } = await params;
    const id = parseInt(idRaw);
    if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const scope = (req.nextUrl.searchParams.get("scope") || "unassigned").toLowerCase();
    if (scope !== "unassigned" && scope !== "all") {
      return NextResponse.json({ error: "scope must be 'unassigned' or 'all'" }, { status: 400 });
    }

    // Confirm the policy exists and is active.
    const policy = await prisma.leavePolicy.findUnique({
      where: { id }, select: { id: true, isActive: true, name: true },
    });
    if (!policy)            return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    if (!policy.isActive)   return NextResponse.json({ error: "Cannot assign an inactive policy. Re-activate first." }, { status: 400 });

    const where: any = { isActive: true };
    if (scope === "unassigned") where.leavePolicyId = null;
    else                        where.leavePolicyId = { not: id }; // skip users already on this policy in "all" mode

    const r = await prisma.user.updateMany({ where, data: { leavePolicyId: id } });
    return NextResponse.json({ ok: true, assigned: r.count, policyName: policy.name, scope });
  } catch (e) { return serverError(e, "POST /api/hr/admin/leave-policies/[id]/bulk-assign"); }
}
