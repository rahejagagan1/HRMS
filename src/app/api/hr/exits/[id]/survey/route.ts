// HR-side offboarding — ExitSurvey endpoint (the exit-interview form).
//
//   GET  /api/hr/exits/:id/survey  → existing survey (or null)
//   PUT  /api/hr/exits/:id/survey  → upsert and optionally mark submitted
//
// Ratings are 1-5; blank ratings persist as NULL. Setting
// `submitted: true` stamps submittedAt and ticks
// EmployeeExit.exitInterviewDone so the global checklist updates.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// Use canonical isHRAdmin helper.
const canManage = (session: any) => isHRAdmin(session?.user);

type SurveyRow = {
  id: number; exitId: number;
  reasonForLeaving: string | null;
  satisfactionRating: number | null;
  managementRating: number | null;
  workEnvironmentRating: number | null;
  growthRating: number | null;
  wouldRecommend: boolean | null;
  additionalFeedback: string | null;
  submittedAt: Date | null;
  createdAt: Date; updatedAt: Date;
};

function clampRating(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 1 || i > 5) return null;
  return i;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const rows = await prisma.$queryRawUnsafe<SurveyRow[]>(
      `SELECT * FROM "ExitSurvey" WHERE "exitId" = $1`, id,
    );
    return NextResponse.json(rows[0] ?? null);
  } catch (e: any) {
    console.error("[GET /api/hr/exits/:id/survey] failed:", e);
    return NextResponse.json({ error: "Could not load survey" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json();
    const reasonForLeaving = body?.reasonForLeaving ? String(body.reasonForLeaving) : null;
    const satisfactionRating = clampRating(body?.satisfactionRating);
    const managementRating = clampRating(body?.managementRating);
    const workEnvironmentRating = clampRating(body?.workEnvironmentRating);
    const growthRating = clampRating(body?.growthRating);
    const wouldRecommend = typeof body?.wouldRecommend === "boolean" ? body.wouldRecommend : null;
    const additionalFeedback = body?.additionalFeedback ? String(body.additionalFeedback) : null;
    const submit = body?.submitted === true;

    const exists = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "EmployeeExit" WHERE id = $1`, id,
    );
    if (exists.length === 0) return NextResponse.json({ error: "Exit not found" }, { status: 404 });

    const submittedClause = submit
      ? `, "submittedAt" = COALESCE("submittedAt", now())`
      : ``;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "ExitSurvey"
         ("exitId", "reasonForLeaving",
          "satisfactionRating", "managementRating", "workEnvironmentRating", "growthRating",
          "wouldRecommend", "additionalFeedback", "submittedAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ${submit ? "now()" : "NULL"}, now())
       ON CONFLICT ("exitId") DO UPDATE
          SET "reasonForLeaving" = EXCLUDED."reasonForLeaving",
              "satisfactionRating" = EXCLUDED."satisfactionRating",
              "managementRating" = EXCLUDED."managementRating",
              "workEnvironmentRating" = EXCLUDED."workEnvironmentRating",
              "growthRating" = EXCLUDED."growthRating",
              "wouldRecommend" = EXCLUDED."wouldRecommend",
              "additionalFeedback" = EXCLUDED."additionalFeedback",
              "updatedAt" = now()
              ${submittedClause}`,
      id, reasonForLeaving,
      satisfactionRating, managementRating, workEnvironmentRating, growthRating,
      wouldRecommend, additionalFeedback,
    );

    // Keep the global "exit interview done" checkbox in lockstep with
    // the survey submission timestamp.
    if (submit) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeExit"
            SET "exitInterviewDone" = TRUE, "updatedAt" = now()
          WHERE id = $1`,
        id,
      );
    }

    const fresh = await prisma.$queryRawUnsafe<SurveyRow[]>(
      `SELECT * FROM "ExitSurvey" WHERE "exitId" = $1`, id,
    );
    return NextResponse.json(fresh[0] ?? null);
  } catch (e: any) {
    console.error("[PUT /api/hr/exits/:id/survey] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
