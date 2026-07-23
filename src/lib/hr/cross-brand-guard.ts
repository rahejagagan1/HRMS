// Cross-brand approval guard — blocks an HR manager from one company
// from approving / rejecting a request belonging to an employee in
// the other company.
//
// Rule: approver.businessUnit must equal requester.businessUnit, UNLESS
// the approver is a founder / super-admin (orgLevel = "ceo" or
// isDeveloper = true). Empty businessUnit on either side is treated as
// "NB Media" (the parent brand), so legacy rows without the column set
// keep working.
//
// Usage in an approval handler (e.g. /api/hr/leaves/[id]):
//
//   const requesterUserId = application.userId;
//   const blocked = await assertSameBrandOrSuperAdmin(session, requesterUserId);
//   if (blocked) return blocked;   // pre-built 403 response
//
// The helper does ONE small DB read (the requester's businessUnit). We
// keep it as a helper rather than inlining so the rule lives in exactly
// one place — if we ever loosen / tighten the policy, only this file
// changes.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function isSuperAdmin(user: any): boolean {
  return user?.orgLevel === "ceo" || user?.isDeveloper === true;
}

function normaliseBrand(bu: string | null | undefined): string {
  return (bu || "").trim() || "NB Media";
}

/**
 * Returns a 403 NextResponse if the session user is a single-brand HR
 * manager trying to action a request from the OTHER brand. Returns null
 * when the call is allowed.
 */
export async function assertSameBrandOrSuperAdmin(
  session: any,
  requesterUserId: number,
): Promise<NextResponse | null> {
  const self = session?.user as any;
  if (!self) return null; // upstream auth guard handles this
  if (isSuperAdmin(self)) return null;

  // Approver's brand — fetch from their EmployeeProfile. Cache-friendly
  // because Prisma will batch with the request-scope cache and this row
  // is small.
  const approverProfile = await prisma.employeeProfile.findFirst({
    where: { user: { email: self.email } },
    select: { businessUnit: true },
  });
  // No profile yet (e.g. brand-new HR account) — fall back to NB Media
  // so they aren't locked out of the existing brand by default.
  const approverBrand = normaliseBrand(approverProfile?.businessUnit);

  const requesterProfile = await prisma.employeeProfile.findUnique({
    where: { userId: requesterUserId },
    select: { businessUnit: true },
  });
  const requesterBrand = normaliseBrand(requesterProfile?.businessUnit);

  if (approverBrand === requesterBrand) return null;
  return NextResponse.json(
    {
      error: `Forbidden — ${approverBrand} HR cannot action a ${requesterBrand} request. Ask a ${requesterBrand} HR manager or the founder to approve.`,
    },
    { status: 403 },
  );
}
