// Streams an attached bonus document back to the caller. Bytes live in
// Postgres BYTEA on EmployeeBonus.attachmentBlob (see the
// 20260527120000_employee_bonus_attachment migration) — same storage
// model as ViolationActionFile so the file survives Docker redeploys.
//
// Access: HR-admin tier (canViewSalary) OR the bonus's affected
// employee. Matches the GET on /api/hr/payroll/bonus, which already
// lets users read their own bonus rows.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, canViewSalary, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function streamBytes(blob: Buffer | Uint8Array, filename: string, mime: string) {
  const bytes = blob instanceof Buffer ? new Uint8Array(blob) : new Uint8Array(blob);
  const safeName = filename
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 200);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type":        mime,
      "Content-Length":      String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control":       "private, no-store",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<Array<{
      userId: number;
      attachmentName: string | null;
      attachmentMime: string | null;
      attachmentBlob: Buffer | null;
    }>>(
      `SELECT "userId", "attachmentName", "attachmentMime", "attachmentBlob"
         FROM "EmployeeBonus"
        WHERE id = $1`,
      id,
    );
    const row = rows[0];
    if (!row || !row.attachmentBlob) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    // Either HR-admin-salary tier OR the employee whose bonus this is.
    const myId = await resolveUserId(session);
    if (!canViewSalary(session!.user) && row.userId !== myId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return streamBytes(
      row.attachmentBlob,
      row.attachmentName || `bonus-${id}`,
      row.attachmentMime || "application/octet-stream",
    );
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/bonus/[id]/file");
  }
}
