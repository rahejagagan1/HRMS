// Probation reviews API.
//   GET  ?scope=manager (default) → the caller's reports whose probation is ending
//        ?scope=hr               → pending recommendations awaiting HR (HR/leadership only)
//   POST                         → a reporting manager submits a recommendation
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import {
  listManagerProbationReviews,
  listPendingHrReviews,
  listManagerHistory,
  listHrHistory,
  listOnProbationEmployees,
  submitProbationReview,
  type Recommendation,
} from "@/lib/hr/probation-review";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const scope = req.nextUrl.searchParams.get("scope") || "manager";
    const brand = req.nextUrl.searchParams.get("brand"); // "NB Media" | "YT Labs" | null(all)
    if (scope === "hr" || scope === "hr-history" || scope === "on-probation") {
      if (!isLeadershipOrHR(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (scope === "on-probation") return NextResponse.json({ employees: await listOnProbationEmployees(brand) });
      return NextResponse.json({ reviews: scope === "hr-history" ? await listHrHistory(brand) : await listPendingHrReviews(brand) });
    }
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "No user" }, { status: 400 });
    if (scope === "manager-history") return NextResponse.json({ reviews: await listManagerHistory(me) });
    return NextResponse.json({ employees: await listManagerProbationReviews(me) });
  } catch (e) {
    return serverError(e, "GET /api/hr/probation-reviews");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "No user" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const employeeUserId = Number(body?.employeeUserId);
    if (!Number.isInteger(employeeUserId) || employeeUserId <= 0) {
      return NextResponse.json({ error: "employeeUserId required" }, { status: 400 });
    }

    // The submitter must be the employee's reporting manager. HR / leadership
    // may act on behalf (the review is still attributed to the manager).
    const mgrRows = await prisma.$queryRawUnsafe<{ managerId: number | null }[]>(
      `SELECT "managerId" FROM "User" WHERE id = $1`, employeeUserId,
    );
    const managerId = mgrRows[0]?.managerId ?? null;
    // Don't attribute the review to the HR actor when there's no real manager —
    // reject instead, so the audit trail + outcome notification stay correct.
    if (managerId == null) {
      return NextResponse.json({ error: "This employee has no reporting manager set." }, { status: 409 });
    }
    if (managerId !== me && !isLeadershipOrHR(session!.user)) {
      return NextResponse.json({ error: "Only this employee's reporting manager can review them." }, { status: 403 });
    }

    const res = await submitProbationReview({
      employeeUserId,
      managerId,
      recommendation: body?.recommendation as Recommendation,
      extendMonths: body?.extendMonths != null ? Number(body.extendMonths) : null,
      proposedEndDate: body?.proposedEndDate || null,
      feedback: String(body?.feedback ?? ""),
    });
    return NextResponse.json({ ok: true, id: res.id });
  } catch (e: any) {
    const msg = e?.message || "Failed";
    if (/required|invalid|pick how|not found|not active|not on probation|already confirmed|must be in the future|reporting manager/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return serverError(e, "POST /api/hr/probation-reviews");
  }
}
