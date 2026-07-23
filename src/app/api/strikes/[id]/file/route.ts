import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireHRAdmin, serverError } from "@/lib/api-auth";

// Streams an action-taken document for a violation back to the caller,
// gated by the same HR-admin tier (CEO / dev / special_access /
// role=admin / orgLevel=hr_manager) that can view the violations log
// in the first place. Bytes live in Postgres BYTEA so they survive
// redeploys (the old /public/uploads/ path got wiped on every prod
// Docker rebuild).
//
// Two storage paths, decided by the `?fileId=N` query parameter:
//   • `?fileId=N`         — stream from ViolationActionFile(id=N).
//                           Used by the new multi-file UI. Verifies
//                           the file belongs to the requested
//                           violation so a stale URL can't leak rows
//                           that have since been moved.
//   • no `fileId`         — legacy single-file path. Returns the
//                           Violation.actionTakenFileBlob inline.
//                           Kept for pre-migration rows.
//
// Force-download by default (`Content-Disposition: attachment`) so
// browsers save the file straight to disk instead of trying to render
// PDFs / Word docs inline. HR has explicitly asked for this UX —
// "click → file in Downloads folder" matches their workflow.

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function streamBytes(blob: Buffer | Uint8Array, filename: string, mime: string) {
    // Convert Buffer / Uint8Array into a fresh Uint8Array so the
    // Response BodyInit type-checks across Node + Edge runtimes.
    const bytes = blob instanceof Buffer ? new Uint8Array(blob) : new Uint8Array(blob);

    // Sanitize the filename for the header — strip CR/LF (header
    // injection) and quotes that would break the value. RFC 6266
    // also lets us pass UTF-8 names via filename*=UTF-8''…; but
    // the simple ASCII-only `filename="…"` form covers the cases
    // HR realistically uploads (English names, dashes, dots).
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
            // No-cache: a violation file should never be served to
            // someone whose access we revoke afterwards. Belt-and-
            // suspenders alongside the auth gate above.
            "Cache-Control":       "private, no-store",
        },
    });
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { session, errorResponse } = await requireHRAdmin();
        if (errorResponse) return errorResponse;
        void session;

        const { id: idRaw } = await params;
        const id = Number(idRaw);
        if (!Number.isFinite(id)) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        const fileIdRaw = req.nextUrl.searchParams.get("fileId");
        const fileId = fileIdRaw === null ? null : Number(fileIdRaw);

        // ── New multi-file path ─────────────────────────────────────
        // Cast to `any` because the typed Prisma client may lag the
        // ViolationActionFile model until `prisma generate` reruns.
        if (fileId !== null) {
            if (!Number.isFinite(fileId)) {
                return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
            }
            // Raw SQL — defensive against a stale typed client that
            // doesn't know about the new table yet, and lets us scope
            // by violationId in a single round-trip.
            const rows = await prisma.$queryRawUnsafe<Array<{
                fileName: string; fileMime: string | null; fileBlob: Buffer;
            }>>(
                `SELECT "fileName", "fileMime", "fileBlob"
                   FROM "ViolationActionFile"
                  WHERE id = $1 AND "violationId" = $2`,
                fileId, id,
            );
            const row = rows[0];
            if (!row || !row.fileBlob) {
                return NextResponse.json(
                    { error: "Attachment not found" },
                    { status: 404 },
                );
            }
            return streamBytes(
                row.fileBlob,
                row.fileName || `violation-${id}-${fileId}`,
                row.fileMime || "application/octet-stream",
            );
        }

        // ── Legacy single-file path ─────────────────────────────────
        const row = await (prisma.violation as any).findUnique({
            where: { id },
            select: {
                actionTakenFileBlob: true,
                actionTakenFileName: true,
                actionTakenFileMime: true,
            },
        }) as {
            actionTakenFileBlob: Buffer | Uint8Array | null;
            actionTakenFileName: string | null;
            actionTakenFileMime: string | null;
        } | null;

        if (!row || !row.actionTakenFileBlob) {
            // Either the violation was deleted or its file pre-dates
            // the BYTEA migration (URL-only legacy row, file is gone).
            return NextResponse.json(
                { error: "Attachment not found — file may have been lost in an earlier redeploy" },
                { status: 404 },
            );
        }

        return streamBytes(
            row.actionTakenFileBlob,
            row.actionTakenFileName || `violation-${id}`,
            row.actionTakenFileMime || "application/octet-stream",
        );
    } catch (error) {
        return serverError(error, "violations/[id]/file GET");
    }
}
