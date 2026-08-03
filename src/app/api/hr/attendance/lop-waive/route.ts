import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, resolveUserId, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { adjustLwpUsage } from "@/lib/hr/lop-integrity";

export const dynamic = "force-dynamic";

// POST /api/hr/attendance/lop-waive — the ONE sanctioned way to forgive (or
// re-apply) an LOP penalty on an attendance day.
//
//   { userId, date: "YYYY-MM-DD", action: "waive" | "restore", note? }
//
// Why this exists (2026-08-03): forgiving a penalty used to require a manual
// DB edit, which flipped the status but left the LWP usage counter charged —
// the two sides of the same penalty permanently disagreed, and nothing
// recorded who did it or why. This endpoint moves BOTH sides atomically and
// writes an AuditLog entry:
//   waive   → isRegularized = true  (every charging path skips regularized
//             rows), LWP usage counter reversed by what the row was charged.
//   restore → isRegularized = false (charging resumes via the repricing
//             engine), LWP usage counter re-charged.
// The status string itself is intentionally left untouched — it's history,
// not money; payroll no longer prices off it for unresolved rows.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  if (!canViewSalary(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { userId, date, action, note } = await req.json();
    if (!Number.isFinite(Number(userId))) return NextResponse.json({ error: "userId required" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    if (action !== "waive" && action !== "restore") return NextResponse.json({ error: "action must be waive|restore" }, { status: 400 });

    const day = new Date(`${date}T00:00:00.000Z`);
    const row = await prisma.attendance.findUnique({
      where: { userId_date: { userId: Number(userId), date: day } },
    });
    if (!row) return NextResponse.json({ error: "No attendance row for that user/date" }, { status: 404 });

    // How much the auto-LOP job charged this row to the LWP usage counter —
    // the amount a waive must hand back (and a restore must re-charge).
    // missed_clock_out with the auto-LOP note = a penalty that was applied
    // and later lost its status (out-of-band edit); the charge is still 0.5.
    const notes = String(row.notes ?? "");
    const lwpCharged =
      row.status === "lop" ? 1
      : row.status === "half_day_lop" ? 0.5
      : row.status === "missed_clock_out" && /Auto-marked half-day LOP|Auto-LOP:/i.test(notes) ? 0.5
      : 0;

    if (action === "waive" && row.isRegularized)
      return NextResponse.json({ ok: true, noop: true, message: "Already waived/regularized" });
    if (action === "restore" && !row.isRegularized)
      return NextResponse.json({ ok: true, noop: true, message: "Not currently waived" });

    const actorEmail = String(user.email ?? "");
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = action === "waive"
      ? `LOP waived by ${actorEmail} on ${stamp}${note ? `: ${String(note)}` : ""}`
      : `LOP waive reverted by ${actorEmail} on ${stamp}${note ? `: ${String(note)}` : ""}`;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.attendance.update({
        where: { id: row.id },
        data: {
          isRegularized: action === "waive",
          notes: notes ? `${notes} | ${suffix}` : suffix,
        },
      });
      return u;
    });
    // LWP counter moves through the shared adjuster (floors at 0, upserts the
    // year row). Outside the tx: a failed adjustment must not roll back the
    // waive silently — it surfaces in the response instead.
    let lwpAdjusted = 0;
    if (lwpCharged > 0) {
      const delta = action === "waive" ? -lwpCharged : lwpCharged;
      await adjustLwpUsage(row.userId, day.getUTCFullYear(), delta);
      lwpAdjusted = delta;
    }

    await writeAuditLog({
      req,
      actorId: await resolveUserId(session!),
      actorEmail,
      action: action === "waive" ? "attendance.lop.waive" : "attendance.lop.restore",
      entityType: "Attendance",
      entityId: row.id,
      before: { status: row.status, isRegularized: row.isRegularized },
      after: { status: updated.status, isRegularized: updated.isRegularized, lwpAdjusted },
      metadata: { userId: row.userId, date, note: note ?? null },
    });

    return NextResponse.json({ ok: true, action, attendanceId: row.id, status: updated.status, isRegularized: updated.isRegularized, lwpAdjusted });
  } catch (e) { return serverError(e, "POST /api/hr/attendance/lop-waive"); }
}
