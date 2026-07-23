import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isSalaryDeveloper, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/hr/payroll/salary-structures
//
// Gagan-only (the salary-trusted developer — see SALARY_DEV_EMAIL in
// src/lib/api-auth.ts). Other developers pass `isDeveloper` for every
// other dev-only surface but NOT for the all-org compensation table.
// Even HR Manager / CEO don't see all-org compensation here — they use
// a single employee's Finances tab instead. Matches the UI gate in
// src/app/dashboard/hr/admin/page.tsx.
//
// We start from User (not SalaryStructure) so employees without a
// structure still appear — HR needs to see who's missing one.
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isSalaryDeveloper(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true,
        employeeProfile: { select: { department: true, designation: true, employeeId: true } },
        salaryStructure: {
          select: {
            id: true, ctc: true, basic: true, hra: true,
            dearnessAllowance: true, conveyanceAllowance: true, medicalAllowance: true,
            specialAllowance: true,
            pfEligible: true, pfEmployee: true, pfEmployer: true,
            esiEmployee: true, esiEmployer: true,
            tds: true, professionalTax: true,
            salaryType: true, effectiveFrom: true,
          },
        },
      },
    });

    // Flatten so the client doesn't have to dig through nested objects;
    // also turns Decimal columns into plain JS numbers (Prisma serialises
    // Decimal to a string by default, which is awkward for arithmetic in
    // the UI).
    const num = (v: unknown) => (v == null ? 0 : parseFloat(v.toString()));
    const rows = users.map(u => {
      const s = u.salaryStructure;
      const ctc = s ? num(s.ctc) : 0;
      return {
        userId:        u.id,
        name:          u.name,
        email:         u.email,
        employeeId:    u.employeeProfile?.employeeId ?? null,
        department:    u.employeeProfile?.department ?? null,
        designation:   u.employeeProfile?.designation ?? null,
        hasStructure:  !!s,
        salaryType:    s?.salaryType ?? null,
        annualCtc:     ctc,
        monthlyGross:  ctc / 12,
        effectiveFrom: s?.effectiveFrom ?? null,
        // Per-component MONTHLY amounts. The DB stores basic/hra/specialAllowance/
        // pfEmployee/pfEmployer/esiEmployee/esiEmployer/tds as ANNUAL figures
        // (see src/app/api/hr/payroll/generate/route.ts:144 — payslip divides
        // these by 12). professionalTax is already a flat per-month amount.
        // We divide by 12 here so the Breakdown column lines up with the
        // "Monthly Gross" column on the same row.
        basic:               s ? num(s.basic)               / 12 : 0,
        hra:                 s ? num(s.hra)                 / 12 : 0,
        dearnessAllowance:   s ? num(s.dearnessAllowance)   / 12 : 0,
        conveyanceAllowance: s ? num(s.conveyanceAllowance) / 12 : 0,
        medicalAllowance:    s ? num(s.medicalAllowance)    / 12 : 0,
        specialAllowance:    s ? num(s.specialAllowance)    / 12 : 0,
        pfEligible:      s ? !!s.pfEligible : false,
        pfEmployee:      s ? num(s.pfEmployee)       / 12 : 0,
        pfEmployer:      s ? num(s.pfEmployer)       / 12 : 0,
        esiEmployee:     s ? num(s.esiEmployee)      / 12 : 0,
        esiEmployer:     s ? num(s.esiEmployer)      / 12 : 0,
        tds:             s ? num(s.tds)              / 12 : 0,
        professionalTax: s ? num(s.professionalTax)       : 0,
      };
    });

    return NextResponse.json({ items: rows });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/salary-structures"); }
}
