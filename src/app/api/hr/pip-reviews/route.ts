// PIP reviews API (mirrors /api/hr/probation-reviews).
//   GET  ?scope=manager (default)  → caller's reports on a plan that's ending
//        ?scope=hr                 → pending recommendations awaiting HR
//        ?scope=manager-history    → caller's decided reviews
//        ?scope=hr-history         → all decided reviews (HR)
//   POST                           → a reporting manager submits a recommendation
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import {
  listManagerPipReviews,
  listPendingHrPipReviews,
  listManagerPipHistory,
  listHrPipHistory,
  listOnPipEmployees,
  submitPipReview,
  type Recommendation,
} from "@/lib/hr/performance-plan-review";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const scope = req.nextUrl.searchParams.get("scope") || "manager";
    const brand = req.nextUrl.searchParams.get("brand"); // "NB Media" | "YT Labs" | null(all)
    if (scope === "hr" || scope === "hr-history" || scope === "on-pip") {
      if (!isLeadershipOrHR(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (scope === "on-pip") return NextResponse.json({ employees: await listOnPipEmployees(brand) });
      return NextResponse.json({ reviews: scope === "hr-history" ? await listHrPipHistory(brand) : await listPendingHrPipReviews(brand) });
    }
    const me = await resolveUserId(session);
    if (!me) return NextResponse.json({ error: "No user" }, { status: 400 });
    if (scope === "manager-history") return NextResponse.json({ reviews: await listManagerPipHistory(me) });
    return NextResponse.json({ employees: await listManagerPipReviews(me) });
  } catch (e) {
    return serverError(e, "GET /api/hr/pip-reviews");
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

    const mgrRows = await prisma.$queryRawUnsafe<{ managerId: number | null }[]>(
      `SELECT "managerId" FROM "User" WHERE id = $1`, employeeUserId,
    );
    const managerId = mgrRows[0]?.managerId ?? null;
    if (managerId == null) {
      return NextResponse.json({ error: "This employee has no reporting manager set." }, { status: 409 });
    }
    if (managerId !== me && !isLeadershipOrHR(session!.user)) {
      return NextResponse.json({ error: "Only this employee's reporting manager can review them." }, { status: 403 });
    }

    const res = await submitPipReview({
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
    if (/required|invalid|pick how|not found|not active|not on|already|must be in the future|reporting manager/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return serverError(e, "POST /api/hr/pip-reviews");
  }
}
