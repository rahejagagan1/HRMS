// SalaryHold CRUD — drives Run Payroll page Step 5 sub-steps 1 & 2
// ("Salary Processing on Hold" + "Salary Payout on Hold"). HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, canViewSalary, serverError } from "@/lib/api-auth";
import { resolveBrandScope } from "@/lib/hr/brand-scope";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  userId: number;
  month: number;
  year: number;
  kind: string;
  payAction: string | null;
  comment: string | null;
  createdAt: Date;
  name?: string;
  role?: string;
};

function parseKind(s: string | null): "processing" | "payout" | null {
  return s === "processing" || s === "payout" ? s : null;
}

// GET /api/hr/payroll/salary-hold?month=N&year=YYYY&kind=processing|payout
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
      return NextResponse.json({ error: "kind must be 'processing' or 'payout'" }, { status: 400 });
    }

    const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
    if (!scope.allBrands && !scope.brand) return NextResponse.json({ items: [] });
    const brandClause = scope.allBrands ? "" : ` AND ep."businessUnit" = $4`;
    const sql = `SELECT h.id, h."userId", h.month, h.year, h.kind, h."payAction", h.comment,
                        h."createdAt",
                        u.name, u.role::text AS role
                   FROM "SalaryHold" h
                   JOIN "User" u ON u.id = h."userId"
              LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
                  WHERE h.month = $1 AND h.year = $2 AND h.kind = $3
                    ${brandClause}
                  ORDER BY h.id ASC`;
    const items = scope.allBrands
      ? await prisma.$queryRawUnsafe<Row[]>(sql, month, year, kind)
      : await prisma.$queryRawUnsafe<Row[]>(sql, month, year, kind, scope.brand);
    return NextResponse.json({ items });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/salary-hold");
  }
}

// POST /api/hr/payroll/salary-hold
//   Body: { userId, month, year, kind, payAction?, comment? }
//   Upserts on (userId, month, year). Switching kind for the same user
//   replaces the existing row (an employee can't be on both kinds at once).
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
    const payAction = body?.payAction ? String(body.payAction).slice(0, 40) : null;
    const comment   = body?.comment   ? String(body.comment).slice(0, 500) : null;

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

    const createdBy = await resolveUserId(session);

    // ON CONFLICT updates kind/payAction/comment so flipping a user
    // between processing-hold and payout-hold reuses the same row.
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "SalaryHold" ("userId", month, year, kind, "payAction", comment, "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("userId", "month", "year") DO UPDATE
         SET kind = EXCLUDED.kind,
             "payAction" = EXCLUDED."payAction",
             comment = EXCLUDED.comment
       RETURNING id`,
      userId, month, year, kind, payAction, comment, createdBy,
    );

    await writeAuditLog({
      req,
      actorId: createdBy ?? null,
      actorEmail: (session!.user as any).email ?? null,
      action: kind === "processing"
        ? "payroll.salary_hold.processing.add"
        : "payroll.salary_hold.payout.add",
      entityType: "SalaryHold",
      entityId: rows[0]?.id ?? null,
      after: { userId, month, year, kind, payAction, comment },
    });

    return NextResponse.json({ ok: true, id: rows[0]?.id }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/payroll/salary-hold");
  }
}

// DELETE /api/hr/payroll/salary-hold?id=N
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
    await prisma.$executeRawUnsafe(`DELETE FROM "SalaryHold" WHERE id = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/payroll/salary-hold");
  }
}
