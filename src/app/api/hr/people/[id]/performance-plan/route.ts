// POST /api/hr/people/:id/performance-plan
// HR places an employee on a Performance Improvement Plan (PIP). Writes the
// pip* columns on EmployeeProfile (raw SQL — the typed client lags the new
// columns) and stores any attachments as EmployeeDocument rows. HR-admin only.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// RBAC-designation-driven (policy 2026-07-14): shared isHRAdmin resolves
// MANAGE_HR from the caller's designation. Replaced a local legacy copy.
import { isHRAdmin } from "@/lib/access";
function canEditOthers(session: any): boolean {
  return isHRAdmin(session?.user);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canEditOthers(session)) {
    return NextResponse.json({ error: "Only HR / CEO / admins can place an employee on a plan" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const me = await resolveUserId(session);
    const body = await req.json().catch(() => ({}));

    const reason = String(body?.reason ?? "").trim();
    const reportedById = Number(body?.reportedById);
    const startRaw = body?.startDate ? new Date(body.startDate) : null;
    const reviewRaw = body?.reviewDate ? new Date(body.reviewDate) : null;

    if (!reason) return NextResponse.json({ error: "Reason / area of concern is required" }, { status: 400 });
    if (!Number.isInteger(reportedById) || reportedById <= 0) {
      return NextResponse.json({ error: "Select who's reporting this" }, { status: 400 });
    }
    const startedAt = startRaw && !Number.isNaN(startRaw.getTime()) ? startRaw : new Date();
    const reviewDate = reviewRaw && !Number.isNaN(reviewRaw.getTime()) ? reviewRaw : null;

    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "EmployeeProfile"
          SET "pipStartedAt" = $2, "pipEndDate" = $3, "pipReason" = $4, "pipReportedById" = $5
        WHERE "userId" = $1`,
      id, startedAt, reviewDate, reason, reportedById,
    );
    if (!Number(updated)) {
      return NextResponse.json({ error: "This employee has no profile to attach a plan to." }, { status: 404 });
    }

    // Attachments — store as EmployeeDocument (category performance_plan).
    // Best-effort: a file failure never undoes the saved plan.
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
    for (const a of attachments) {
      try {
        const name = String(a?.name ?? "attachment").slice(0, 200);
        const mime = String(a?.contentType ?? "application/octet-stream");
        const buf = Buffer.from(String(a?.contentBase64 ?? ""), "base64");
        if (buf.length === 0) continue;
        await prisma.$executeRawUnsafe(
          `INSERT INTO "EmployeeDocument"
             ("userId","category","fileName","fileUrl","fileBlob","fileMime","uploadedById","isVerified","createdAt")
           VALUES ($1,'performance_plan',$2,'',$3::bytea,$4,$5,false,NOW())`,
          id, name, buf, mime, me,
        );
      } catch (e) {
        console.warn("[performance-plan] attachment insert failed:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "POST /api/hr/people/[id]/performance-plan");
  }
}
