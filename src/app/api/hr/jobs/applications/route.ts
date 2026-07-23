// HR-side list of all candidate submissions. Joins to JobOpening so the
// table shows the role title alongside each row.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// Use the canonical isHRAdmin helper (includes special_access +
// admin role) instead of an inline copy that drifted off the
// original. Drift was the bug: special_access users got 403 here
// but worked on every other HR surface.
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: number; status: string; fullName: string; email: string; phone: string | null;
        coverLetter: string | null; linkedinUrl: string | null; portfolioUrl: string | null;
        experienceYears: number | null; currentCompany: string | null; noticePeriod: string | null;
        resumeFileName: string | null; resumeUrl: string | null; hrNotes: string | null;
        createdAt: Date; jobOpeningId: number; roleTitle: string;
      }>
    >(
      `SELECT a.id, a.status, a."fullName", a.email, a.phone, a."coverLetter",
              a."linkedinUrl", a."portfolioUrl", a."experienceYears",
              a."currentCompany", a."noticePeriod", a."resumeFileName",
              a."resumeUrl", a."hrNotes", a."createdAt",
              a."jobOpeningId", o.title AS "roleTitle"
         FROM "JobApplication" a
         JOIN "JobOpening"     o ON o.id = a."jobOpeningId"
        ORDER BY a."createdAt" DESC`,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[GET /api/hr/jobs/applications] failed:", e);
    return NextResponse.json({ error: "Could not load applications" }, { status: 500 });
  }
}
