// HR Hiring — Interview reschedule + cancel.
//
// PATCH  /api/hr/hiring/interviews/[id]
//   body: { action: "reschedule",
//           scheduledAt?: ISO string,
//           durationMinutes?: number,
//           title?: string,
//           notifyCandidate?: boolean }
//
// DELETE /api/hr/hiring/interviews/[id]
//   Cancels the interview. Sets status='cancelled' and tears down the
//   Google Calendar event (if it was Meet-created). HR-admin only.
//
// Both operations are best-effort wrt the Google side: if the Calendar
// API fails (404 because the event was deleted manually, network blip,
// etc.) the DB row still gets updated. The activity log captures the
// outcome so HR can audit what happened.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import {
  updateGoogleMeetEvent, deleteGoogleMeetEvent, isGoogleMeetConfigured,
} from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (action !== "reschedule") {
      return NextResponse.json({ error: `Unknown action: ${action || "(missing)"}` }, { status: 400 });
    }
    const actorId = await resolveUserId(session);

    // Pull the current row so we know the prior schedule + Google
    // event id. If the row's already cancelled, refuse to reschedule.
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "applicationId", title, "scheduledAt", "durationMinutes",
              location, status, "googleEventId"
         FROM "Interview" WHERE id = $1`,
      id,
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.status === "cancelled") {
      return NextResponse.json({ error: "Interview already cancelled — schedule a new one instead" }, { status: 400 });
    }

    const newScheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!newScheduledAt || isNaN(newScheduledAt.getTime())) {
      return NextResponse.json({ error: "Valid scheduledAt required" }, { status: 400 });
    }
    const newDuration = Number.isInteger(body?.durationMinutes)
      ? Number(body.durationMinutes)
      : Number(row.durationMinutes ?? 45);
    const newTitle = typeof body?.title === "string" && body.title.trim()
      ? body.title.trim()
      : String(row.title);

    // ── 1. Update the DB row.
    await prisma.$executeRawUnsafe(
      `UPDATE "Interview"
          SET "scheduledAt" = $1, "durationMinutes" = $2, "title" = $3,
              "status" = 'scheduled', "updatedAt" = NOW()
        WHERE id = $4`,
      newScheduledAt, newDuration, newTitle, id,
    );

    // ── 2. Patch the Google Calendar event so the candidate's invite
    //       updates in place. Soft-fails — we don't roll back the DB.
    let googleStatus: "patched" | "skipped" | "failed" = "skipped";
    if (row.googleEventId && isGoogleMeetConfigured()) {
      try {
        const endISO = new Date(newScheduledAt.getTime() + newDuration * 60_000).toISOString();
        await updateGoogleMeetEvent({
          eventId:  row.googleEventId,
          summary:  newTitle,
          startISO: newScheduledAt.toISOString(),
          endISO,
        });
        googleStatus = "patched";
      } catch (e: any) {
        console.error("[interview reschedule] Calendar patch failed:", e?.message ?? e);
        googleStatus = "failed";
      }
    }

    // ── 3. Activity log.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
       VALUES ($1, 'interview_rescheduled', $2, $3::jsonb, $4)`,
      row.applicationId,
      `Rescheduled to ${newScheduledAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      JSON.stringify({
        interviewId: id,
        from: row.scheduledAt,
        to: newScheduledAt.toISOString(),
        googleStatus,
      }),
      actorId,
    );

    return NextResponse.json({ ok: true, googleStatus });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/interviews/[id]");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: idParam } = await params;
    const id = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const actorId = await resolveUserId(session);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "applicationId", title, status, "googleEventId"
         FROM "Interview" WHERE id = $1`,
      id,
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.status === "cancelled") {
      return NextResponse.json({ error: "Already cancelled" }, { status: 400 });
    }

    // ── 1. Soft-cancel in the DB (keep the row for history; scorecards
    //       and panel chips stay accessible). Mark status='cancelled'.
    await prisma.$executeRawUnsafe(
      `UPDATE "Interview" SET "status" = 'cancelled', "updatedAt" = NOW() WHERE id = $1`,
      id,
    );

    // ── 2. Tear down the Google Calendar event so the candidate's
    //       invite disappears from their calendar.
    let googleStatus: "deleted" | "skipped" | "failed" = "skipped";
    if (row.googleEventId && isGoogleMeetConfigured()) {
      try {
        await deleteGoogleMeetEvent(row.googleEventId);
        googleStatus = "deleted";
      } catch (e: any) {
        console.error("[interview cancel] Calendar delete failed:", e?.message ?? e);
        googleStatus = "failed";
      }
    }

    // ── 3. Activity log.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
       VALUES ($1, 'interview_cancelled', $2, $3::jsonb, $4)`,
      row.applicationId,
      `Cancelled interview: ${row.title}`,
      JSON.stringify({ interviewId: id, googleStatus }),
      actorId,
    );

    return NextResponse.json({ ok: true, googleStatus });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/hiring/interviews/[id]");
  }
}
