// Daily safety-net: auto-put every eligible employee on probation.
//
// The onboarding paths (/api/users, /api/hr/employees, Keka import) already set
// a 3-month probation window at creation. This sweep catches everyone else —
// employees added by some other route, seeded directly, or whose joining date
// was filled in AFTER creation — so nobody who should be on probation is ever
// silently left off it.
//
// Eligibility: active, has a joining date within the last PROBATION_MONTHS,
// no probation end date yet, and not already confirmed. probationEndDate is
// computed the same way the app helper does — joiningDate + 3 months, with
// Postgres clamping month-end (30 Nov + 3mo -> 28/29 Feb), matching addMonths().
//
// Idempotent: once a window is set the row no longer matches, so re-running is
// a no-op. Raw SQL so it works without a fresh prisma generate cycle.

import prisma from "@/lib/prisma";
import { PROBATION_MONTHS } from "@/lib/hr/probation";

export async function applyMissingProbationWindows(): Promise<number> {
  const where = `
    u."isActive" = true
    AND ep."joiningDate" IS NOT NULL
    AND ep."joiningDate" >= (CURRENT_DATE - INTERVAL '${PROBATION_MONTHS} months')
    AND ep."probationEndDate" IS NULL
    AND ep."probationConfirmedAt" IS NULL
  `;
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "EmployeeProfile" ep
       SET "probationStartDate" = ep."joiningDate",
           "probationEndDate"   = (ep."joiningDate" + INTERVAL '${PROBATION_MONTHS} months'),
           "probationPolicy"    = COALESCE(ep."probationPolicy", 'Regular Employees')
      FROM "User" u
     WHERE u.id = ep."userId" AND ${where}
  `);
  if (updated > 0) console.log(`[probation-autoassign] set probation window for ${updated} employee(s)`);
  return updated;
}
