// HR Hiring — JobOpening list + create.
//
// GET  /api/hr/hiring/jobs?brand=...&status=open|closed|all
//   → returns jobs with candidate counts per stage for the cards/table.
//
// POST /api/hr/hiring/jobs
//   → { title, department, location, brand, employmentType,
//       experienceLevel, salaryRange, description, internalNotes,
//       recruiterId, hiringManagerId, interviewerIds[] }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getBrandScope } from "@/lib/hr/brand-scope";
import { buildJobSlug } from "@/lib/hr/job-slug";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  // GET returns drafts, internal notes, recruiter / hiring-manager
  // names and per-stage candidate counts — strictly HR-admin tier.
  // Public callers should hit /api/public/jobs instead.
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const statusQs = (searchParams.get("status") || "all").toLowerCase();

    // Brand isolation — a single-brand HR Manager only sees their own
    // brand's job openings (overrides any ?brand= param); developers /
    // allowlisted honor the param (or see all). JobOpening.brand stores
    // slugs ("nb_media" / "yt_labs"); getBrandScope returns the
    // businessUnit display name ("NB Media" / "YT Labs") — map between.
    const scope = getBrandScope(session!.user);
    let brand = searchParams.get("brand") || "";
    if (!scope.allBrands) {
      const slug = scope.brand === "NB Media" ? "nb_media"
                 : scope.brand === "YT Labs"  ? "yt_labs"
                 : null;
      if (!slug) return NextResponse.json([]); // fail closed (no brand)
      brand = slug;
    }

    let where = `1=1`;
    const params: any[] = [];
    if (brand) { params.push(brand); where += ` AND o."brand" = $${params.length}`; }
    if (statusQs === "open")   where += ` AND o."isOpen" = true`;
    if (statusQs === "closed") where += ` AND o."isOpen" = false`;

    // Two-step query with pre-migration fallback. The legacy
    // JobOpening table doesn't have recruiterId / hiringManagerId /
    // brand columns; the legacy JobApplication doesn't have
    // currentStageId; HiringStage may not exist. Try the full query
    // first; on column / table errors, fall back to a stripped query
    // that still renders the page.
    // New status filter wins when present, otherwise legacy open/closed.
    const statusParam = (searchParams.get("statusFilter") || "").toLowerCase();
    if (["draft", "published", "on_hold", "closed"].includes(statusParam)) {
      params.push(statusParam); where += ` AND o."status" = $${params.length}`;
    }

    // Explicit projection — the jobs LIST never renders the heavy @db.Text
    // columns (description / internalNotes / jdText). Shipping them on every
    // row (re-fetched constantly) was the biggest list-payload cost; the
    // single-job + edit views fetch those separately. Everything JobsTab
    // renders is kept.
    const JOB_LIST_COLS =
      `o."id", o."title", o."department", o."location", o."isOpen", o."createdAt", o."updatedAt", ` +
      `o."brand", o."employmentType", o."experienceLevel", o."salaryRange", o."closesAt", o."status", ` +
      `o."publicSlug", o."publishedAt", o."vacancies", o."isPriority", o."jdFileUrl", o."jdFileName", ` +
      `o."recruiterId", o."hiringManagerId"`;
    let rows: any[] = [];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT ${JOB_LIST_COLS},
                r."name" AS "recruiterName",
                h."name" AS "hiringManagerName",
                (SELECT COUNT(*) FROM "JobApplication" a WHERE a."jobOpeningId" = o."id") AS "applicationCount",
                (SELECT COUNT(*) FROM "JobApplication" a JOIN "HiringStage" s ON s."id" = a."currentStageId"
                  WHERE a."jobOpeningId" = o."id" AND s."kind" = 'active') AS "activeCount",
                (SELECT COUNT(*) FROM "JobApplication" a JOIN "HiringStage" s ON s."id" = a."currentStageId"
                  WHERE a."jobOpeningId" = o."id" AND s."kind" = 'hired') AS "hiredCount",
                (SELECT COUNT(*) FROM "JobApplication" a JOIN "HiringStage" s ON s."id" = a."currentStageId"
                  WHERE a."jobOpeningId" = o."id" AND s."kind" = 'rejected') AS "rejectedCount",
                (SELECT COUNT(*) FROM "JobApplication" a
                   LEFT JOIN "HiringStage" s ON s."id" = a."currentStageId"
                  WHERE a."jobOpeningId" = o."id"
                    AND (s."id" IS NULL OR a."status" = 'new')
                    AND a."createdAt" >= NOW() - INTERVAL '48 hours') AS "newCount",
                -- Still SOURCED / stage-unchanged but older than 48h → "recent"
                (SELECT COUNT(*) FROM "JobApplication" a
                   LEFT JOIN "HiringStage" s ON s."id" = a."currentStageId"
                  WHERE a."jobOpeningId" = o."id"
                    AND (s."id" IS NULL OR a."status" = 'new')
                    AND a."createdAt" <  NOW() - INTERVAL '48 hours') AS "recentCount"
           FROM "JobOpening" o
           LEFT JOIN "User" r ON r."id" = o."recruiterId"
           LEFT JOIN "User" h ON h."id" = o."hiringManagerId"
          WHERE ${where}
          ORDER BY
            o."isPriority" DESC,
            CASE o."status"
              WHEN 'published' THEN 0
              WHEN 'draft'     THEN 1
              WHEN 'on_hold'   THEN 2
              WHEN 'closed'    THEN 3
              ELSE 4 END,
            o."createdAt" DESC`,
        ...params,
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      const msg = String(e?.meta?.message || e?.message || "");
      if (code === "42703" || code === "42P01" || /does not exist/i.test(msg)) {
        rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT ${JOB_LIST_COLS},
                  NULL AS "recruiterName",
                  NULL AS "hiringManagerName",
                  (SELECT COUNT(*) FROM "JobApplication" a WHERE a."jobOpeningId" = o."id") AS "applicationCount",
                  0 AS "activeCount",
                  0 AS "hiredCount",
                  0 AS "rejectedCount",
                  0 AS "newCount",
                  0 AS "recentCount"
             FROM "JobOpening" o
            ORDER BY o."isOpen" DESC, o."createdAt" DESC`,
        );
      } else {
        throw e;
      }
    }

    return NextResponse.json({
      jobs: rows.map((r) => ({
        ...r,
        applicationCount: Number(r.applicationCount ?? 0),
        activeCount:      Number(r.activeCount ?? 0),
        hiredCount:       Number(r.hiredCount ?? 0),
        rejectedCount:    Number(r.rejectedCount ?? 0),
        newCount:         Number(r.newCount ?? 0),
        recentCount:      Number(r.recentCount ?? 0),
        // isPriority may be absent on pre-migration rows. Default to
        // false so the front-end star treats the column as off.
        isPriority:       r.isPriority === true,
      })),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/jobs");
  }
}

// ─────────────────────────────────────────────────────────────────────
// POST — accepts the full Create-Job wizard payload (Keka parity).
//
// Body shape (all fields optional except `title`):
//   Step 1: { title, brand, department, description, internalNotes }
//   Step 2: { employmentType, experienceLevel,
//             locations: [{ name, startHireDate, targetHireDate, positions }],
//             currency, salaryMin, salaryMax, salaryUnit, salaryRange (legacy),
//             allowReapplyDays, isPriority, archiveAfterFilled }
//   Step 3: { recruiterIds[], inboundOwnerStrategy, inboundOwnerUserId,
//             hiringManagerIds[], interviewerIds[],
//             recruitersAccessOwnOnly, interviewersAccessOwnOnly,
//             notifyRecruiterOnNewCandidate, notifyHiringMgrOnNewCandidate,
//             interviewFeedbackVisibility }
//   Step 4: { publishChannels[], publish?: boolean }
//
// Backwards-compat: also accepts the OLD flat payload
//   (location: string, vacancies: number, recruiterId, hiringManagerId)
// so the legacy CreateJobModal stays functional during cutover.
// ─────────────────────────────────────────────────────────────────────

const VALID_STRATEGIES = new Set(["round_robin", "individual", "none"]);
const VALID_VISIBILITY = new Set(["open", "restricted", "private"]);
// "lpa" = Lakhs per Annum (current UI). "annual" kept for legacy rows
// created before the LPA rename; new jobs default to "lpa".
const VALID_SAL_UNIT   = new Set(["lpa", "monthly", "annual"]);
const VALID_CHANNELS   = new Set(["career_site", "indeed", "linkedin", "naukri", "referral"]);

interface LocationInput {
  name: string;
  startHireDate?: string | null;
  targetHireDate?: string | null;
  positions?: number | null;
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const title = String(body?.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

    // ── Normalise inputs across new wizard + legacy modal ────────
    const locations: LocationInput[] = Array.isArray(body?.locations) && body.locations.length
      ? body.locations
          .map((l: any) => ({
            name: String(l?.name ?? "").trim(),
            startHireDate: l?.startHireDate || null,
            targetHireDate: l?.targetHireDate || null,
            positions: Number.isInteger(Number(l?.positions)) && Number(l.positions) > 0
              ? Number(l.positions) : 1,
          }))
          .filter((l: LocationInput) => l.name)
      : body?.location
        ? [{ name: String(body.location).trim(), positions: Number(body?.vacancies) || 1 }]
        : [];

    // Aggregate vacancies = sum of per-location positions (or fall
    // back to the flat `vacancies` field for legacy callers).
    const vacancies = locations.length
      ? locations.reduce((s, l) => s + (Number(l.positions) || 1), 0)
      : Number.isInteger(Number(body?.vacancies)) && Number(body?.vacancies) > 0
        ? Number(body.vacancies) : 1;
    const primaryLocation = locations[0]?.name || null;

    const recruiterIds: number[] = Array.isArray(body?.recruiterIds)
      ? body.recruiterIds.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
      : Number.isInteger(Number(body?.recruiterId)) ? [Number(body.recruiterId)] : [];
    const hiringManagerIds: number[] = Array.isArray(body?.hiringManagerIds)
      ? body.hiringManagerIds.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
      : Number.isInteger(Number(body?.hiringManagerId)) ? [Number(body.hiringManagerId)] : [];
    const interviewerIds: number[] = Array.isArray(body?.interviewerIds)
      ? body.interviewerIds.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];

    const inboundOwnerStrategy = VALID_STRATEGIES.has(body?.inboundOwnerStrategy)
      ? body.inboundOwnerStrategy : "none";
    const inboundOwnerUserId = inboundOwnerStrategy === "individual" && Number.isInteger(Number(body?.inboundOwnerUserId))
      ? Number(body.inboundOwnerUserId) : null;
    const interviewFeedbackVisibility = VALID_VISIBILITY.has(body?.interviewFeedbackVisibility)
      ? body.interviewFeedbackVisibility : "open";
    const salaryUnit = VALID_SAL_UNIT.has(body?.salaryUnit) ? body.salaryUnit : "lpa";

    const channels: string[] = Array.isArray(body?.publishChannels)
      ? body.publishChannels.filter((c: any) => VALID_CHANNELS.has(c))
      : ["career_site"];

    const wantsPublish = body?.publish === true;
    const status = wantsPublish ? "published" : "draft";
    const isOpen = wantsPublish;
    const publishedAt = wantsPublish ? new Date() : null;

    // ── Single transaction: job + locations + junctions ──────────
    const id = await prisma.$transaction(async (tx) => {
      const created = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO "JobOpening" (
            "title", "department", "location", "description", "isOpen",
            "status", "vacancies", "brand", "employmentType", "experienceLevel",
            "salaryRange", "internalNotes", "closesAt",
            "recruiterId", "hiringManagerId",
            "currency", "salaryMin", "salaryMax", "salaryUnit",
            "allowReapplyDays", "archiveAfterFilled",
            "inboundOwnerStrategy", "inboundOwnerUserId",
            "interviewFeedbackVisibility",
            "recruitersAccessOwnOnly", "interviewersAccessOwnOnly",
            "notifyRecruiterOnNewCandidate", "notifyHiringMgrOnNewCandidate",
            "publishChannels", "isPriority", "publishedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
         RETURNING "id"`,
        title,
        body?.department || null,
        primaryLocation,
        body?.description || null,
        isOpen,
        status,
        vacancies,
        body?.brand || "nb_media",
        body?.employmentType || null,
        body?.experienceLevel || null,
        body?.salaryRange || null,
        body?.internalNotes || null,
        body?.closesAt ? new Date(body.closesAt) : null,
        recruiterIds[0] ?? null,        // legacy primary recruiter
        hiringManagerIds[0] ?? null,    // legacy primary hiring manager
        body?.currency || "INR",
        Number.isInteger(Number(body?.salaryMin)) ? Number(body.salaryMin) : null,
        Number.isInteger(Number(body?.salaryMax)) ? Number(body.salaryMax) : null,
        salaryUnit,
        Number.isInteger(Number(body?.allowReapplyDays)) ? Number(body.allowReapplyDays) : 0,
        body?.archiveAfterFilled === true,
        inboundOwnerStrategy,
        inboundOwnerUserId,
        interviewFeedbackVisibility,
        body?.recruitersAccessOwnOnly === true,
        body?.interviewersAccessOwnOnly === true,
        body?.notifyRecruiterOnNewCandidate === true,
        body?.notifyHiringMgrOnNewCandidate === true,
        channels,
        body?.isPriority === true,
        publishedAt,
      );
      const newId = Number(created[0]?.id);

      // Locations
      for (let i = 0; i < locations.length; i++) {
        const l = locations[i];
        await tx.$executeRawUnsafe(
          `INSERT INTO "JobOpeningLocation"
            ("jobOpeningId", "name", "startHireDate", "targetHireDate", "positions", "sortOrder")
           VALUES ($1, $2, $3, $4, $5, $6)`,
          newId,
          l.name,
          l.startHireDate ? new Date(l.startHireDate) : null,
          l.targetHireDate ? new Date(l.targetHireDate) : null,
          l.positions ?? 1,
          (i + 1) * 10,
        );
      }

      // Recruiter + hiring-manager + interviewer junctions
      for (const uid of recruiterIds) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "JobOpeningRecruiterJoin" ("jobOpeningId", "userId")
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          newId, uid,
        );
      }
      for (const uid of hiringManagerIds) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "JobOpeningHiringManagerJoin" ("jobOpeningId", "userId")
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          newId, uid,
        );
      }
      for (const uid of interviewerIds) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "JobOpeningInterviewer" ("jobOpeningId", "userId")
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          newId, uid,
        );
      }

      // Publishing directly from the create wizard needs a publicSlug —
      // the /api/public/jobs feed filters out any job missing one. The
      // /publish endpoint mints the slug on first publish for jobs that
      // started as drafts; we mirror that here so wizard-published jobs
      // are visible on the careers page immediately.
      if (wantsPublish) {
        const slug = buildJobSlug(title, newId);
        await tx.$executeRawUnsafe(
          `UPDATE "JobOpening"
              SET "publicSlug" = COALESCE("publicSlug", $1)
            WHERE "id" = $2`,
          slug, newId,
        );
      }
      return newId;
    });

    return NextResponse.json({ id, status }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/jobs");
  }
}
