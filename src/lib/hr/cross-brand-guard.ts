// Cross-brand approval guard — blocks an HR manager from one company
// from approving / rejecting a request belonging to an employee in
// the other company.
//
// Rule: approver.businessUnit must equal requester.businessUnit, UNLESS
// the approver is a founder / super-admin (orgLevel = "ceo" or
// isDeveloper = true), the requester's own reporting manager, or holds a
// both-brands HR designation (CROSS_BRAND_HR_DESIGNATIONS — the NB Media HR
// Manager). Empty businessUnit on either side is treated as
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

// Designations that run HR for BOTH brands (2026-10-09: the NB Media HR
// Manager is HR manager of NB Media and YT Labs, so must clear L1 + L2 for
// either). Keyed on the designation, not the person, so whoever holds it
// next inherits the access. The YT Labs HR Manager (hr_manager_yt_labs)
// stays single-brand.
const CROSS_BRAND_HR_DESIGNATIONS = new Set(["hr_manager"]);

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

  const [approver, requester] = await Promise.all([
    prisma.user.findUnique({
      where: { email: self.email },
      select: { id: true, designation: { select: { key: true } }, employeeProfile: { select: { businessUnit: true } } },
    }),
    prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { managerId: true, employeeProfile: { select: { businessUnit: true } } },
    }),
  ]);
  // The requester's own reporting manager may always act, whatever the
  // brands — an NB Media manager of a YT Labs report approves their L1.
  if (approver && requester?.managerId === approver.id) return null;
  if (approver?.designation?.key && CROSS_BRAND_HR_DESIGNATIONS.has(approver.designation.key)) return null;
  // No profile yet (e.g. brand-new HR account) — fall back to NB Media
  // so they aren't locked out of the existing brand by default.
  const approverBrand = normaliseBrand(approver?.employeeProfile?.businessUnit);
  const requesterBrand = normaliseBrand(requester?.employeeProfile?.businessUnit);

  if (approverBrand === requesterBrand) return null;
  return NextResponse.json(
    {
      error: `Forbidden — ${approverBrand} HR cannot action a ${requesterBrand} request. Ask a ${requesterBrand} HR manager or the founder to approve.`,
    },
    { status: 403 },
  );
}
