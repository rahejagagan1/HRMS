// Lightweight active-designation list for pickers + badges across the app.
// Any authenticated user — it only exposes designation names, nothing sensitive.
// (Editing designations stays on /api/admin/rbac/designations, which is gated.)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const designations = await prisma.$queryRawUnsafe<
      { id: number; key: string; label: string; scorecardFunction: string | null; businessUnit: string | null }[]
    >(
      `SELECT "id","key","label","scorecardFunction","businessUnit"
       FROM "Designation" WHERE "isActive" = true ORDER BY "sortOrder","label"`
    );
    return NextResponse.json({ designations });
  } catch {
    return NextResponse.json({ designations: [] }); // RBAC tables not migrated → empty.
  }
}
