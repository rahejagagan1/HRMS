// Public endpoint — returns the visible field configuration for the
// candidate-facing application form. The form template editor in the
// HR dashboard writes to this same table.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        fieldKey: string;
        label: string;
        fieldType: string;
        isVisible: boolean;
        isRequired: boolean;
        sortOrder: number;
        isMandatory: boolean;
      }>
    >(
      `SELECT "fieldKey", label, "fieldType", "isVisible", "isRequired",
              "sortOrder", "isMandatory"
         FROM "JobApplicationFormField"
        WHERE "isVisible" = true
        ORDER BY "sortOrder" ASC`,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[/api/jobs/form-fields] failed:", e);
    return NextResponse.json({ error: "Could not load form" }, { status: 500 });
  }
}
