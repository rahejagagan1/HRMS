// Employee Referrals — read-side endpoints (open referral jobs +
// my-referrals).
//
// GET /api/hr/jobs/referrals
//   Returns the list of currently-published jobs where HR has
//   ticked the "referral" channel. Visible to EVERY authenticated
//   employee (not gated on HR-admin). The fields exposed are
//   employee-safe: title, brand, department, location, public
//   slug for the JD viewer. No salary, no internal notes.
//
// GET /api/hr/jobs/referrals?my=1
//   Returns the candidates THIS employee has referred (filter on
//   referredById = session userId), with current stage info.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const my = searchParams.get("my") === "1";

    if (my) {
      const me = await resolveUserId(session);
      if (!me) return NextResponse.json({ referrals: [] });
      // Each referral pulls the candidate's name + email +
      // current stage info + the job title they applied to.
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT a.id, a."fullName", a.email, a."createdAt", a."enteredStageAt",
                o.title AS "jobTitle", o.id AS "jobId",
                s.key AS "stageKey", s.label AS "stageLabel",
                s.kind AS "stageKind", s.color AS "stageColor"
           FROM "JobApplication" a
           JOIN "JobOpening" o ON o.id = a."jobOpeningId"
           LEFT JOIN "HiringStage" s ON s.id = a."currentStageId"
          WHERE a."referredById" = $1
          ORDER BY a."createdAt" DESC`,
        me,
      );
      return NextResponse.json({ referrals: rows });
    }

    // Open referral jobs — published + "referral" channel + open.
    // `publishChannels` is a text[] on JobOpening; the
    // ANY('referral' = ANY(...)) idiom is the Postgres-native
    // match.
    // Brand label comes from `brand` (the canonical column).
    // Locations use the legacy single-column `location` field
    // because the per-job multi-location table (JobLocation) isn't
    // present on every env yet — try to join it, fall back to the
    // simpler shape if the relation is missing.
    // Field set kept STRICTLY employee-safe — no salary, no internal
    // notes, no jdText. This endpoint is open to every authenticated
    // employee (referrers don't need HR-admin access), so the
    // contract is "what's already public on the JD page" plus
    // priority badge. Salary band lives only on the JD details page
    // and behind the HR-admin gates that serve it.
    let rows: any[] = [];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT o.id, o.title, o.department, o.brand, o."publicSlug",
                o."publishedAt", o."experienceLevel", o."employmentType",
                o."isPriority", o.location,
                COALESCE(string_agg(l.name, ', ' ORDER BY l.name), '') AS locations_agg
           FROM "JobOpening" o
           LEFT JOIN "JobLocation" l ON l."jobOpeningId" = o.id
          WHERE o.status = 'published'
            AND o."isOpen" = true
            AND 'referral' = ANY(o."publishChannels")
          GROUP BY o.id
          ORDER BY o."isPriority" DESC NULLS LAST, o."publishedAt" DESC NULLS LAST`,
      );
    } catch (e: any) {
      // 42P01 = relation does not exist. Re-run without the join.
      if (e?.meta?.code === "42P01" || /JobLocation/.test(String(e?.message ?? ""))) {
        rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT o.id, o.title, o.department, o.brand, o."publicSlug",
                  o."publishedAt", o."experienceLevel", o."employmentType",
                  o."isPriority", o.location,
                  ''::text AS locations_agg
             FROM "JobOpening" o
            WHERE o.status = 'published'
              AND o."isOpen" = true
              AND 'referral' = ANY(o."publishChannels")
            ORDER BY o."isPriority" DESC NULLS LAST, o."publishedAt" DESC NULLS LAST`,
        );
      } else {
        throw e;
      }
    }
    const jobs = rows.map((r) => ({
      id:              r.id,
      title:           r.title,
      department:      r.department,
      businessUnit:    r.brand === "yt_labs" ? "YT Labs"
                     : r.brand === "nb_media" ? "NB Media"
                     : r.brand ?? null,
      publicSlug:      r.publicSlug,
      publishedAt:     r.publishedAt,
      experienceLevel: r.experienceLevel,
      employmentType:  r.employmentType,
      isPriority:      r.isPriority,
      locations:       r.locations_agg && r.locations_agg.length > 0 ? r.locations_agg : (r.location ?? ""),
    }));
    return NextResponse.json({ jobs });
  } catch (e) {
    return serverError(e, "GET /api/hr/jobs/referrals");
  }
}
