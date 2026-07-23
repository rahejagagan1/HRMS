// TaxOverride CRUD — drives Run Payroll page Step 6 sub-steps (PT, ESI,
// TDS, LWF). One table, four kinds. HR-admin only on all writes.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, canViewSalary, serverError } from "@/lib/api-auth";
import { resolveBrandScope } from "@/lib/hr/brand-scope";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

type Kind = "PT" | "ESI" | "TDS" | "LWF";
function parseKind(s: string | null): Kind | null {
  return s === "PT" || s === "ESI" || s === "TDS" || s === "LWF" ? s : null;
}

type Row = {
  id: number;
  userId: number;
  month: number;
  year: number;
  kind: string;
  employeeOverride: string | null;
  employerOverride: string | null;
  comment: string | null;
  name?: string;
  employeeId?: string | null;
};

// GET /api/hr/payroll/tax-override?month=N&year=YYYY&kind=PT|ESI|TDS|LWF
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const month = parseInt(searchParams.get("month") ?? "");
    const year  = parseInt(searchParams.get("year")  ?? "");
    const kind  = parseKind(searchParams.get("kind"));
    if (!Number.isFinite(month) || month < 0 || month > 11) {
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    }
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: "Bad year" }, { status: 400 });
    }
    if (!kind) {
      return NextResponse.json({ error: "kind must be PT/ESI/TDS/LWF" }, { status: 400 });
    }

    const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
    if (!scope.allBrands && !scope.brand) return NextResponse.json({ items: [] });
    const brandClause = scope.allBrands ? "" : ` AND ep."businessUnit" = $4`;
    // Pull EmployeeProfile.employeeId (the HRM number) so the table
    // can render "EMPLOYEE NUMBER" + "EMPLOYEE NAME" separately the
    // way Keka does.
    const sql = `SELECT o.id, o."userId", o.month, o.year, o.kind,
                        o."employeeOverride", o."employerOverride", o.comment,
                        u.name,
                        ep."employeeId"
                   FROM "TaxOverride" o
                   JOIN "User" u ON u.id = o."userId"
              LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
                  WHERE o.month = $1 AND o.year = $2 AND o.kind = $3
                    ${brandClause}
                  ORDER BY o.id ASC`;
    const items = scope.allBrands
      ? await prisma.$queryRawUnsafe<Row[]>(sql, month, year, kind)
      : await prisma.$queryRawUnsafe<Row[]>(sql, month, year, kind, scope.brand);
    return NextResponse.json({ items });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/tax-override");
  }
}

// POST /api/hr/payroll/tax-override
//   Body: { userId, month, year, kind, employeeOverride?, employerOverride?, comment? }
//   Upserts on (userId, month, year, kind).
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const userId = parseInt(body?.userId);
    const month  = parseInt(body?.month);
    const year   = parseInt(body?.year);
    const kind   = parseKind(body?.kind);
    const comment = body?.comment ? String(body.comment).slice(0, 500) : null;
    const employeeOverride = body?.employeeOverride === null || body?.employeeOverride === undefined || body?.employeeOverride === ""
      ? null : Number(body.employeeOverride);
    const employerOverride = body?.employerOverride === null || body?.employerOverride === undefined || body?.employerOverride === ""
      ? null : Number(body.employerOverride);

    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    if (!Number.isFinite(month) || month < 0 || month > 11) {
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    }
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: "Bad year" }, { status: 400 });
    }
    if (!kind) return NextResponse.json({ error: "Bad kind" }, { status: 400 });

    if (employeeOverride !== null && (!Number.isFinite(employeeOverride) || employeeOverride < 0)) {
      return NextResponse.json({ error: "employeeOverride must be ≥ 0" }, { status: 400 });
    }
    if (employerOverride !== null && (!Number.isFinite(employerOverride) || employerOverride < 0)) {
      return NextResponse.json({ error: "employerOverride must be ≥ 0" }, { status: 400 });
    }
    // Must provide at least one override value or there's nothing to do.
    if (employeeOverride === null && employerOverride === null) {
      return NextResponse.json({ error: "Provide at least one override amount" }, { status: 400 });
    }
    // PT and TDS have no employer-side, so we reject employer override
    // for those two kinds to keep data clean.
    if ((kind === "PT" || kind === "TDS") && employerOverride !== null) {
      return NextResponse.json({ error: `${kind} only supports a single override amount` }, { status: 400 });
    }

    const createdBy = await resolveUserId(session);

    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "TaxOverride"
              ("userId", month, year, kind, "employeeOverride", "employerOverride", comment, "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ("userId", "month", "year", "kind") DO UPDATE
         SET "employeeOverride" = EXCLUDED."employeeOverride",
             "employerOverride" = EXCLUDED."employerOverride",
             comment            = EXCLUDED.comment
       RETURNING id`,
      userId, month, year, kind, employeeOverride, employerOverride, comment, createdBy,
    );

    await writeAuditLog({
      req,
      actorId: createdBy ?? null,
      actorEmail: (session!.user as any).email ?? null,
      action: `payroll.tax_override.${kind.toLowerCase()}.set`,
      entityType: "TaxOverride",
      entityId: rows[0]?.id ?? null,
      after: { userId, month, year, kind, employeeOverride, employerOverride, comment },
    });

    return NextResponse.json({ ok: true, id: rows[0]?.id }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/payroll/tax-override");
  }
}

// DELETE /api/hr/payroll/tax-override?id=N
export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const id = parseInt(searchParams.get("id") ?? "");
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
    await prisma.$executeRawUnsafe(`DELETE FROM "TaxOverride" WHERE id = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/payroll/tax-override");
  }
}
