// One-time bonus / perk payouts per employee. HR-admin tier writes;
// the affected employee + admins can read.

import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, canViewSalary, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { resolveBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";
// Node runtime needed for Buffer / multipart file reads (Edge can't).
export const runtime  = "nodejs";

// Optional bonus attachment limits — mirrors the violations upload
// pattern. 10 MB ceiling, doc/image whitelist (offer letter scans,
// performance memos, signed approval PDFs).
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_EXTS = new Set([
  ".pdf", ".doc", ".docx", ".rtf", ".odt",
  ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp",
]);
const ATTACHMENT_MIME_BY_EXT: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".rtf":  "application/rtf",
  ".odt":  "application/vnd.oasis.opendocument.text",
  ".txt":  "text/plain",
  ".md":   "text/markdown",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

type BonusRow = {
  id: number;
  userId: number;
  amount: string;
  reason: string | null;
  effectiveDate: Date;
  bonusType: string | null;
  paymentStatus: string;
  createdAt: Date;
  createdBy: number | null;
  attachmentName: string | null;
};

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    const admin = canViewSalary(self);

    const { searchParams } = new URL(req.url);
    const monthRaw = searchParams.get("month");  // 0-indexed (Jan=0)
    const yearRaw  = searchParams.get("year");
    const requested = searchParams.get("userId");

    // Admin-only: ?month=N&year=YYYY returns every bonus whose
    // effectiveDate falls inside that calendar month, including the
    // affected employee's name + role for table rendering. Used by
    // the Run Payroll page's Step 3 (Bonus, Salary Revisions & Overtime)
    // panel to enumerate the whole cycle's bonuses.
    if (monthRaw !== null && yearRaw !== null) {
      if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const month = parseInt(monthRaw);
      const year  = parseInt(yearRaw);
      if (!Number.isFinite(month) || month < 0 || month > 11 || !Number.isFinite(year)) {
        return NextResponse.json({ error: "Bad month/year" }, { status: 400 });
      }
      const start = new Date(Date.UTC(year, month, 1));
      const end   = new Date(Date.UTC(year, month + 1, 1));
      const scope = resolveBrandScope(session!.user, searchParams.get("brand"));
      if (!scope.allBrands && !scope.brand) return NextResponse.json({ items: [] });
      const brandClause = scope.allBrands ? "" : ` AND ep."businessUnit" = $3`;
      const sql = `SELECT b.id, b."userId", b.amount, b.reason, b."effectiveDate",
                          b."bonusType", b."paymentStatus", b."createdAt", b."createdBy",
                          b."attachmentName",
                          u.name, u.role::text AS role
                     FROM "EmployeeBonus" b
                     JOIN "User" u ON u.id = b."userId"
                LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
                    WHERE b."effectiveDate" >= $1 AND b."effectiveDate" < $2
                      ${brandClause}
                    ORDER BY b."effectiveDate" ASC, b.id ASC`;
      const items = scope.allBrands
        ? await prisma.$queryRawUnsafe<(BonusRow & { name: string; role: string })[]>(sql, start, end)
        : await prisma.$queryRawUnsafe<(BonusRow & { name: string; role: string })[]>(sql, start, end, scope.brand);
      return NextResponse.json({ items });
    }

    let userId: number;
    if (requested) {
      const n = parseInt(requested);
      // I10 fix: strict integer check — parseInt("0") = 0 passed
      // the old isFinite gate and would create phantom userId=0 FK rows.
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json({ error: "Bad userId" }, { status: 400 });
      }
      if (!admin && n !== myId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      userId = n;
    } else {
      userId = myId!;
    }

    const items = await prisma.$queryRawUnsafe<BonusRow[]>(
      `SELECT id, "userId", amount, reason, "effectiveDate",
              "bonusType", "paymentStatus",
              "createdAt", "createdBy",
              "attachmentName"
         FROM "EmployeeBonus"
        WHERE "userId" = $1
        ORDER BY "effectiveDate" DESC, id DESC`,
      userId,
    );
    return NextResponse.json({ items });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/bonus");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Accepts either application/json (legacy callers) or
    // multipart/form-data (the Add Bonus modal when an attachment is
    // picked). Multipart is the only way to ship the optional file
    // bytes; JSON callers keep working unchanged.
    let userId         = 0;
    let amount         = NaN;
    let reason: string | null = null;
    let effectiveRaw   = "";
    let bonusType: string | null = null;
    let paymentStatus  = "due_future";
    let attachmentFile: File | null = null;

    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const get = (k: string) => {
        const v = form.get(k);
        return typeof v === "string" ? v : null;
      };
      userId        = parseInt(String(get("userId") ?? ""));
      amount        = Number(get("amount"));
      reason        = (() => { const v = get("reason"); return v ? v.slice(0, 500) : null; })();
      effectiveRaw  = String(get("effectiveDate") ?? "");
      bonusType     = (() => { const v = get("bonusType"); return v ? v.slice(0, 80) : null; })();
      const psRaw   = String(get("paymentStatus") ?? "due_future");
      paymentStatus = ["due_future", "paid_past"].includes(psRaw) ? psRaw : "due_future";
      const file = form.get("attachment");
      if (file instanceof File && file.size > 0) attachmentFile = file;
    } else {
      const body = await req.json();
      userId        = parseInt(String(body?.userId ?? ""));
      amount        = Number(body?.amount);
      reason        = (body?.reason ? String(body.reason).slice(0, 500) : null) || null;
      effectiveRaw  = String(body?.effectiveDate ?? "");
      bonusType     = (body?.bonusType ? String(body.bonusType).slice(0, 80) : null) || null;
      const psRaw   = String(body?.paymentStatus ?? "due_future");
      paymentStatus = ["due_future", "paid_past"].includes(psRaw) ? psRaw : "due_future";
    }

    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveRaw)) {
      return NextResponse.json({ error: "effectiveDate must be YYYY-MM-DD" }, { status: 400 });
    }

    // Validate the optional attachment before we touch the DB so a
    // bad file doesn't leave an orphan bonus row behind.
    let attachmentBlob: Buffer | null = null;
    let attachmentName: string | null = null;
    let attachmentMime: string | null = null;
    if (attachmentFile) {
      if (attachmentFile.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json(
          { error: `Attachment "${attachmentFile.name}" must be 10 MB or smaller` },
          { status: 400 },
        );
      }
      const ext = extname(attachmentFile.name).toLowerCase();
      if (!ALLOWED_ATTACHMENT_EXTS.has(ext)) {
        return NextResponse.json(
          { error: `Attachment "${attachmentFile.name}" must be a PDF, Word, RTF, ODT, TXT, or image` },
          { status: 400 },
        );
      }
      attachmentBlob = Buffer.from(await attachmentFile.arrayBuffer());
      attachmentName = attachmentFile.name.slice(0, 200);
      attachmentMime = attachmentFile.type && attachmentFile.type !== "application/octet-stream"
        ? attachmentFile.type
        : ATTACHMENT_MIME_BY_EXT[ext] ?? "application/octet-stream";
    }

    const createdBy = await resolveUserId(session);
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "EmployeeBonus"
              ("userId", amount, reason, "effectiveDate", "bonusType", "paymentStatus", "createdBy",
               "attachmentName", "attachmentMime", "attachmentBlob")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      userId, amount, reason, new Date(effectiveRaw), bonusType, paymentStatus, createdBy,
      attachmentName, attachmentMime, attachmentBlob,
    );

    await writeAuditLog({
      req,
      actorId: createdBy ?? null,
      actorEmail: (session!.user as any).email ?? null,
      action: "payroll.bonus.add",
      entityType: "EmployeeBonus",
      entityId: rows[0]?.id ?? null,
      after: {
        userId, amount, reason, effectiveDate: effectiveRaw, bonusType, paymentStatus,
        attachmentName,
      },
    });

    return NextResponse.json({ ok: true, id: rows[0]?.id }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/payroll/bonus");
  }
}

export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get("id");
    const id = idRaw && /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : NaN;
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "EmployeeBonus" WHERE id = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/payroll/bonus");
  }
}
