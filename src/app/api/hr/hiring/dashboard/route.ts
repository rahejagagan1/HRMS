// HR Hiring — Dashboard aggregates (the "Home → Dashboard" landing).
//
// Returns everything the Dashboard tab needs in one round-trip. Each
// query is wrapped in a soft-fail helper so a missing table / column
// (e.g. before the hiring_keka_parity migration applies on dev)
// returns a sensible empty value instead of a 500 that nukes the
// whole page. Production deploy applies the migration via
// `prisma migrate deploy` and every chart fills in automatically.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Run a raw query; return `fallback` if Postgres reports the table
 *  or column doesn't exist (42P01 / 42703) — typical pre-migration
 *  state on dev. Other errors still throw. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const code = e?.meta?.code || e?.code;
    if (code === "42P01" || code === "42703") return fallback;
    // Some Prisma versions wrap the message — check the string too.
    const msg = String(e?.meta?.message || e?.message || "");
    if (/does not exist/i.test(msg)) return fallback;
    throw e;
  }
}

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [
      openJobs,
      hiredLast12m,
      acceptedOffers3m,
      overdueJobs,
      candidatesLast6m,
      hiredLast6m,
      hiresWithDuration,
      pendingReview,
      departments,
      pendingOffers,
      acceptedOffersList,
      rejectedOffersList,
      newHiresList,
    ] = await Promise.all([
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS n FROM "JobOpening" WHERE "isOpen" = true`,
      ), [{ n: 0 }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(DISTINCT a."id") AS n
           FROM "JobApplication" a
           JOIN "HiringStage" s ON s."id" = a."currentStageId"
          WHERE s."kind" = 'hired'
            AND a."updatedAt" >= NOW() - INTERVAL '12 months'`,
      ), [{ n: 0 }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('sent','accepted','declined','expired')) AS sent,
           COUNT(*) FILTER (WHERE status = 'accepted') AS accepted
           FROM "OfferLetter"
          WHERE "createdAt" >= NOW() - INTERVAL '3 months'`,
      ), [{ sent: 0, accepted: 0 }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS n FROM "JobOpening"
          WHERE "isOpen" = true AND "createdAt" < NOW() - INTERVAL '30 days'`,
      ), [{ n: 0 }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS n FROM "JobApplication"
          WHERE "createdAt" >= NOW() - INTERVAL '6 months'`,
      ), [{ n: 0 }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(DISTINCT a."id") AS n
           FROM "JobApplication" a
           JOIN "HiringStage" s ON s."id" = a."currentStageId"
          WHERE s."kind" = 'hired'
            AND a."updatedAt" >= NOW() - INTERVAL '6 months'`,
      ), [{ n: 0 }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT AVG(EXTRACT(EPOCH FROM (a."updatedAt" - a."createdAt")) / 86400.0) AS days
           FROM "JobApplication" a
           JOIN "HiringStage" s ON s."id" = a."currentStageId"
          WHERE s."kind" = 'hired'
            AND a."updatedAt" >= NOW() - INTERVAL '6 months'`,
      ), [{ days: null }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS n
           FROM "JobApplication" a
           JOIN "HiringStage" s ON s."id" = a."currentStageId"
          WHERE s."kind" = 'active'
            AND a."createdAt" >= NOW() - INTERVAL '3 months'`,
      ), [{ n: 0 }]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT
           COALESCE(o."department", 'Unassigned') AS name,
           COUNT(DISTINCT o."id") AS jobs,
           COUNT(DISTINCT CASE WHEN s."kind" = 'hired' THEN a."id" END) AS "positionsHired",
           COUNT(DISTINCT o."id") AS target
           FROM "JobOpening" o
           LEFT JOIN "JobApplication" a ON a."jobOpeningId" = o."id"
           LEFT JOIN "HiringStage" s ON s."id" = a."currentStageId"
          WHERE o."isOpen" = true
          GROUP BY COALESCE(o."department", 'Unassigned')
          ORDER BY jobs DESC, name ASC`,
      ), [] as any[]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT ol."id", ol."ctcAnnual", ol."joiningDate", ol."createdAt",
                a."fullName" AS "candidateName", o."title" AS "jobTitle"
           FROM "OfferLetter" ol
           JOIN "JobApplication" a ON a."id" = ol."applicationId"
           JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
          WHERE ol."status" IN ('draft','sent')
          ORDER BY ol."createdAt" DESC LIMIT 10`,
      ), [] as any[]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT ol."id", ol."ctcAnnual", ol."joiningDate", ol."acceptedAt",
                a."fullName" AS "candidateName", o."title" AS "jobTitle"
           FROM "OfferLetter" ol
           JOIN "JobApplication" a ON a."id" = ol."applicationId"
           JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
          WHERE ol."status" = 'accepted'
          ORDER BY ol."acceptedAt" DESC LIMIT 10`,
      ), [] as any[]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT ol."id", ol."declinedAt", ol."revokedAt",
                a."fullName" AS "candidateName", o."title" AS "jobTitle"
           FROM "OfferLetter" ol
           JOIN "JobApplication" a ON a."id" = ol."applicationId"
           JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
          WHERE ol."status" IN ('declined','revoked','expired')
          ORDER BY COALESCE(ol."declinedAt", ol."revokedAt", ol."updatedAt") DESC LIMIT 10`,
      ), [] as any[]),
      safe(() => prisma.$queryRawUnsafe<any[]>(
        `SELECT a."id", a."fullName", a."updatedAt", o."title" AS "jobTitle"
           FROM "JobApplication" a
           JOIN "HiringStage" s ON s."id" = a."currentStageId"
           JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
          WHERE s."kind" = 'hired'
          ORDER BY a."updatedAt" DESC LIMIT 10`,
      ), [] as any[]),
    ]);

    const offerStats = acceptedOffers3m[0] || { sent: 0, accepted: 0 };
    const sentN = Number(offerStats.sent ?? 0);
    const acceptedN = Number(offerStats.accepted ?? 0);
    const offerAcceptanceRate = sentN > 0 ? (acceptedN / sentN) * 100 : null;

    const candidates6m = Number(candidatesLast6m[0]?.n ?? 0);
    const hires6m = Number(hiredLast6m[0]?.n ?? 0);
    const sourceToHirePct = candidates6m > 0 ? (hires6m / candidates6m) * 100 : null;

    const avgDays = hiresWithDuration[0]?.days;

    return NextResponse.json({
      hiringHealth: {
        openPositions: Number(openJobs[0]?.n ?? 0),
        hiredLast12m: Number(hiredLast12m[0]?.n ?? 0),
        targetLast12m: Number(openJobs[0]?.n ?? 0) + Number(hiredLast12m[0]?.n ?? 0),
      },
      offerAcceptanceRate,
      positionsOverdue: Number(overdueJobs[0]?.n ?? 0),
      sourceToHirePct,
      timeToHireDays: avgDays != null ? Math.round(Number(avgDays)) : null,
      pendingReview: Number(pendingReview[0]?.n ?? 0),
      departments: departments.map((d: any) => ({
        name: d.name,
        jobs: Number(d.jobs ?? 0),
        positionsHired: Number(d.positionsHired ?? 0),
        target: Number(d.target ?? d.jobs ?? 0),
      })),
      offers: {
        pending:  pendingOffers,
        accepted: acceptedOffersList,
        rejected: rejectedOffersList,
        newHires: newHiresList,
      },
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/dashboard");
  }
}
