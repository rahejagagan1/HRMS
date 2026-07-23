import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const isAdmin = canViewSalary(user);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const runs = await prisma.payrollRun.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { _count: { select: { payslips: true } } },
    });
    return NextResponse.json(runs);
  } catch (e) { return serverError(e, "GET /api/hr/payroll/runs"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const isAdmin = canViewSalary(user);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { month, year } = await req.json();
    if (month === undefined || !year)
      return NextResponse.json({ error: "month and year required" }, { status: 400 });

    const existing = await prisma.payrollRun.findUnique({ where: { month_year: { month, year } } });
    if (existing) return NextResponse.json({ error: "Payroll run already exists for this month" }, { status: 409 });

    const run = await prisma.payrollRun.create({
      data: { month, year, runBy: user.dbId, status: "draft" },
    });
    return NextResponse.json(run, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/runs"); }
}
