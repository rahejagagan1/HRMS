import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, resolveUserId, serverError } from "@/lib/api-auth";
import { decryptPII } from "@/lib/pii-crypto";

// Columns that are encrypted at rest. Decrypt on the way out so the
// frontend always sees plaintext, while a DB dump only shows ciphertext.
const PII_COLUMNS = ["bankAccountNumber", "bankIfsc", "panNumber", "aadhaarNumber", "aadhaarEnrollment", "uanNumber"] as const;

export const dynamic = "force-dynamic";

/**
 * Data for the "My Finances > Summary" page — the Keka-style payroll summary
 * banner + Payment Information card + Identity Information card.
 *
 * Uses raw SQL so it keeps working when the generated Prisma client is out of
 * sync with the latest schema (e.g. after a schema field addition but before
 * `prisma generate` runs on a dev machine).
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  const meId = await resolveUserId(session);
  if (!meId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Admins can pass ?userId=X to view another employee's summary (used by
  // the HR-side Finances tab on the people-detail page). Non-admins are
  // always pinned to themselves regardless of query.
  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("userId");
  const myId = (canViewSalary(self) && requested && /^\d+$/.test(requested))
    ? parseInt(requested, 10)
    : meId;

  try {
    const [profile] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         u."id", u."name", u."email",
         p."employeeId", p."department", p."designation",
         p."joiningDate", p."jobLocation", p."legalEntity",
         p."firstName", p."middleName", p."lastName",
         p."dateOfBirth", p."gender",
         p."address", p."city", p."state",
         p."bankName", p."bankAccountNumber", p."bankIfsc", p."bankBranch", p."accountHolderName",
         p."panNumber", p."parentName", p."aadhaarNumber", p."aadhaarEnrollment",
         p."pfNumber", p."uanNumber",
         p."pfEstablishmentId", p."pfEpsMember", p."pfNotEligible",
         p."pfJoinDate", p."pfAccountName", p."ptEstablishmentId"
       FROM "User" u
       LEFT JOIN "EmployeeProfile" p ON p."userId" = u."id"
       WHERE u."id" = $1
       LIMIT 1`,
      myId
    );

    // File-count breakdown by EmployeeDocument.category — used for the
    // "N file(s)" badge next to each verified ID row.
    const docs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "category", COUNT(*)::int AS "count"
       FROM "EmployeeDocument"
       WHERE "userId" = $1
       GROUP BY "category"`,
      myId
    );
    const docCount: Record<string, number> = {};
    for (const d of docs) docCount[d.category] = Number(d.count);

    // Latest processed payslip — populates the "Payroll summary" banner.
    const [latest] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p."id", p."month", p."year", p."workingDays", p."lopDays", p."status"
       FROM "Payslip" p
       WHERE p."userId" = $1
       ORDER BY p."year" DESC, p."month" DESC
       LIMIT 1`,
      myId
    );

    // Decrypt PII columns before returning. Non-encrypted (legacy plaintext)
    // values pass through unchanged so existing rows keep working.
    const profileDecrypted = profile ? { ...profile } : null;
    if (profileDecrypted) {
      for (const col of PII_COLUMNS) {
        if (profileDecrypted[col]) profileDecrypted[col] = decryptPII(profileDecrypted[col]);
      }
    }

    return NextResponse.json({
      profile: profileDecrypted,
      docCount,
      latestPayslip: latest || null,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/summary");
  }
}
