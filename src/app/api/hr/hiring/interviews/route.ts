// HR Hiring — Interview CRUD.
//
// POST   /api/hr/hiring/interviews          → schedule a new interview
//   body: { applicationId, title, scheduledAt, durationMinutes,
//           location, panelistIds[], roundNumber? }
//
// PATCH  /api/hr/hiring/interviews/[id]     → reschedule / update / mark
//                                             outcome
// DELETE /api/hr/hiring/interviews/[id]     → cancel

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const applicationId = Number(body?.applicationId);
    const title = String(body?.title ?? "").trim();
    if (!Number.isInteger(applicationId) || !title) {
      return NextResponse.json({ error: "applicationId + title required" }, { status: 400 });
    }
    const actorId = await resolveUserId(session);

    // Next round number = max + 1. Interview table doesn't exist
    // pre-migration — return a clear 503 so the UI knows to show a
    // "Hiring pipeline isn't set up on this DB" hint instead of a
    // mysterious 500.
    let next: any[] = [];
    try {
      next = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COALESCE(MAX("roundNumber"), 0) + 1 AS n FROM "Interview" WHERE "applicationId" = $1`,
        applicationId,
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      const msg = String(e?.meta?.message || e?.message || "");
      if (code === "42P01" || /does not exist/i.test(msg)) {
        return NextResponse.json(
          { error: "Interview table not migrated yet. Run `prisma migrate deploy`." },
          { status: 503 },
        );
      }
      throw e;
    }

    const created = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "Interview" ("applicationId","roundNumber","title","scheduledAt",
                                "durationMinutes","location","status")
       VALUES ($1,$2,$3,$4,$5,$6,'scheduled')
       RETURNING "id"`,
      applicationId,
      Number(body?.roundNumber) || Number(next[0]?.n) || 1,
      title,
      body?.scheduledAt ? new Date(body.scheduledAt) : null,
      Number(body?.durationMinutes) || 45,
      body?.location || null,
    );
    const interviewId = created[0]?.id;

    if (Array.isArray(body?.panelistIds)) {
      for (const uid of body.panelistIds) {
        const n = Number(uid);
        if (!Number.isInteger(n)) continue;
        await prisma.$executeRawUnsafe(
          `INSERT INTO "InterviewPanelist" ("interviewId","userId") VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          interviewId, n,
        );
      }
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "CandidateActivity" ("applicationId","kind","summary","meta","actorId")
       VALUES ($1,'interview_scheduled',$2,$3::jsonb,$4)`,
      applicationId,
      `Scheduled: ${title}`,
      JSON.stringify({ interviewId, title, scheduledAt: body?.scheduledAt }),
      actorId,
    );

    return NextResponse.json({ id: interviewId }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/interviews");
  }
}
