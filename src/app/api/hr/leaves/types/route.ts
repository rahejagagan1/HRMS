import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin, resolveUserId, serverError } from "@/lib/api-auth";

// Codes hidden for interns. Their LeavePolicy ("Intern Leave Plan")
// has no CL entry, so showing CL in the apply-leave dropdown would
// just confuse them. Keep this list small and explicit.
const HIDDEN_CODES_FOR_INTERNS = ["CL"];

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const types = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

    // Strip CL for interns. requestor identity comes from session — we
    // never trust a client-supplied userId here because anyone could
    // pass a regular employee's id to peek the full list.
    const myId = await resolveUserId(session);
    if (myId) {
      const profile = await prisma.employeeProfile.findUnique({
        where: { userId: myId }, select: { employmentType: true },
      });
      if (profile?.employmentType === "intern") {
        return NextResponse.json(types.filter((t) => !HIDDEN_CODES_FOR_INTERNS.includes(t.code)));
      }
    }
    return NextResponse.json(types);
  } catch (e) { return serverError(e, "GET /api/hr/leaves/types"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const lt = await prisma.leaveType.create({ data: body });
    return NextResponse.json(lt);
  } catch (e) { return serverError(e, "POST /api/hr/leaves/types"); }
}
