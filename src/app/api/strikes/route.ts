import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendEmail } from "@/lib/email/sender";
import {
  violationCreatedEmail,
  violationStatusChangedEmail,
} from "@/lib/email/templates";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
// Need the Node runtime for fs (Edge can't write files).
export const runtime  = "nodejs";

// Action-Taken attachment limits — mirrors the jobs/apply pattern.
// 10 MB ceiling, doc/image whitelist (HR mostly uploads PDFs of warning
// letters, screenshots of chats, etc.). Larger ceiling than resumes
// because a multi-page PDF with screenshots can run > 5 MB.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTS = new Set([
  ".pdf", ".doc", ".docx", ".rtf", ".odt",
  ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp",
]);

// Fallback MIME map — used only when the upload's own `type` field
// is missing or generic (octet-stream). Keys mirror ALLOWED_EXTS.
const MIME_BY_EXT: Record<string, string> = {
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

// HR access is RBAC-designation-driven (policy 2026-07-14): the shared
// isHRAdmin resolves MANAGE_HR from the caller's designation permissions,
// so HR staff provisioned by designation alone (role/orgLevel still
// "member") pass. Replaced a local orgLevel/role-only copy.
function hasViolationAccess(session: any): boolean {
    return isHRAdmin(session?.user as any);
}

// GET: Fetch violations with summary
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasViolationAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status");
        const severity = searchParams.get("severity");
        const category = searchParams.get("category");
        // Brand scope — filters by the offender's businessUnit so the
        // YT Labs Violation Log only shows YT Labs employees' rows and
        // vice versa. NULL businessUnit buckets to NB Media (parent-
        // brand default, matches the rest of the app). Empty / "all"
        // = no filter.
        const brandRaw = (searchParams.get("brand") || "").toLowerCase();
        const brand: "NB Media" | "YT Labs" | null =
            brandRaw === "yt-labs" || brandRaw === "yt"   ? "YT Labs" :
            brandRaw === "nb-media" || brandRaw === "nb"  ? "NB Media" :
            null;
        const brandUserClause: any = !brand ? {} :
            brand === "YT Labs"
                ? { user: { employeeProfile: { businessUnit: "YT Labs" } } }
                : { user: { OR: [
                    { employeeProfile: { businessUnit: "NB Media" } },
                    { employeeProfile: { businessUnit: null } },
                    { employeeProfile: null },
                ] } };

        const where: any = { ...brandUserClause };
        // `status` is filtered in JS after fetch (see below) rather than in the
        // typed where — a stale prisma client (pre-`paused` regeneration) would
        // reject the new "paused" enum value here and break the whole list.
        if (severity) where.severity = severity;
        if (category) where.category = category;
        // Counts use the same brand-clause so the summary cards stay
        // in sync with the rows below them.
        const countBase = brand ? brandUserClause : {};

        const [violationsRaw, summary] = await Promise.all([
            // Explicit `select` — keeps the multi-MB BYTEA blobs out of
            // the list payload. Each Violation's attached files are
            // exposed as a metadata-only `actionFiles` list (id + name
            // + mime), so the UI can list them without downloading any
            // bytes. The dedicated `/api/strikes/[id]/file?fileId=N`
            // route streams the actual blob.
            //
            // The cast-to-any wraps both the typed-client lag from the
            // recent schema additions and the safety of skipping the
            // blob columns on the SELECT for list-mode.
            (prisma.violation as any).findMany({
                where,
                select: {
                    id: true,
                    userId: true,
                    reportedBy: true,
                    title: true,
                    description: true,
                    severity: true,
                    status: true,
                    category: true,
                    actionTaken: true,
                    actionTakenFileUrl: true,
                    actionTakenFileName: true,
                    actionTakenFileMime: true,
                    // Detect the legacy single-file fallback case
                    // (legacy blob populated AND no ViolationActionFile
                    // rows yet). The blob bytes themselves stay out of
                    // the list payload — we only need to know whether
                    // the legacy blob is present.
                    notes: true,
                    violationDate: true,
                    responsiblePersonId: true,
                    resolvedAt: true,
                    // Surfaced to the UI so the violation card can render
                    // a "Follow-up email sent" badge under the Manager
                    // row once the cron has fired for this violation.
                    followUpSentAt: true,
                    createdAt: true,
                    updatedAt: true,
                    user: { select: { id: true, name: true, role: true, profilePictureUrl: true, teamCapsule: true } },
                    reporter: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                    responsiblePerson: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                    actionFiles: {
                        select: { id: true, fileName: true, fileMime: true, uploadedAt: true },
                        orderBy: { uploadedAt: "asc" },
                    },
                },
                orderBy: { createdAt: "desc" },
            }),
            // Summary counts — same brand scope as the row query above.
            Promise.all([
                prisma.violation.count({ where: countBase }),
                prisma.violation.count({ where: { ...countBase, status: "open" } }),
                prisma.violation.count({ where: { ...countBase, status: "in_progress" } }),
                // `paused` was added to the enum recently; on a dev box whose
                // prisma client hasn't been regenerated yet the typed client
                // rejects the value and throws. Swallow that to 0 so the WHOLE
                // list load can't be taken down by the summary — it self-heals
                // to the real count once `prisma generate` has run.
                (prisma.violation.count({ where: { ...countBase, status: "paused" } as any }) as Promise<number>).catch(() => 0),
                prisma.violation.count({ where: { ...countBase, status: "closed" } }),
                prisma.violation.count({ where: { ...countBase, severity: { in: ["high", "critical"] } } }),
            ]),
        ]);

        // Backward-compat shim: rows with a legacy single-file but no
        // ViolationActionFile entries yet expose a synthetic file in
        // the same shape so the UI doesn't need to know about legacy.
        // The synthetic id is the special string "legacy" — the file
        // route recognises it and falls back to the legacy columns.
        const violations = (violationsRaw as any[]).map((v) => {
            const hasMulti = Array.isArray(v.actionFiles) && v.actionFiles.length > 0;
            if (hasMulti) return v;
            if (v.actionTakenFileName) {
                return {
                    ...v,
                    actionFiles: [{
                        id: "legacy",
                        fileName: v.actionTakenFileName,
                        fileMime: v.actionTakenFileMime ?? null,
                        uploadedAt: v.createdAt,
                    }],
                };
            }
            return v;
        });

        // Status filter applied here (not in the DB where) so the "paused"
        // enum value works even on a stale prisma client. The per-brand row
        // set is small, so filtering in memory is cheap.
        const filteredViolations = status
            ? violations.filter((v: any) => v.status === status)
            : violations;

        return NextResponse.json({
            violations: filteredViolations,
            summary: {
                total: summary[0],
                open: summary[1],
                inProgress: summary[2],
                paused: summary[3],
                closed: summary[4],
                highCritical: summary[5],
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// Validate + materialize a File from the form into a tuple of
// (blob, fileName, fileMime). Returns null when the slot is empty.
// Used for both the POST create path and the PATCH add-more path.
async function readUploadedFile(file: File): Promise<{ blob: Buffer; fileName: string; fileMime: string } | { error: string }> {
    if (file.size > MAX_FILE_BYTES) {
        return { error: `File "${file.name}" must be 10 MB or smaller` };
    }
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
        return { error: `File "${file.name}" must be a PDF, Word, RTF, ODT, TXT, or image` };
    }
    return {
        blob: Buffer.from(await file.arrayBuffer()),
        fileName: file.name,
        fileMime: file.type && file.type !== "application/octet-stream"
            ? file.type
            : MIME_BY_EXT[ext] ?? "application/octet-stream",
    };
}

// POST: Create a new violation.
//
// Accepts EITHER application/json (legacy callers) or
// multipart/form-data (the violations form). The form-data path now
// pulls *multiple* files out of the `actionTakenFile` field — HR can
// attach several PDFs / docs per violation. Each file lands as its own
// row in `ViolationActionFile`; the legacy single-file columns on
// `Violation` are no longer written. Bytes live in BYTEA so they
// survive redeploys (the old `/public/uploads/` path got wiped on
// every Docker rebuild).
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasViolationAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const user = session?.user as any;
        const ctype = request.headers.get("content-type") ?? "";

        // Branch on content-type so JSON callers (curl, integration
        // tests, edits) keep working — only the form upload path
        // carries a file payload.
        let body: any = {};
        // Collected ViolationActionFile rows to insert after the parent
        // Violation row is created. Stays empty for JSON callers.
        const filesToInsert: Array<{ blob: Buffer; fileName: string; fileMime: string }> = [];

        if (ctype.includes("multipart/form-data")) {
            const form = await request.formData();
            const get = (k: string) => {
                const v = form.get(k);
                return typeof v === "string" ? v : null;
            };
            body = {
                userId:               Number(get("userId")) || 0,
                severity:             get("severity"),
                status:               get("status"),
                category:             get("category"),
                actionTaken:          get("actionTaken"),
                notes:                get("notes"),
                violationDate:        get("violationDate"),
                responsiblePersonId:  get("responsiblePersonId") ? Number(get("responsiblePersonId")) : null,
                reportedById:         get("reportedById") ? Number(get("reportedById")) : null,
            };

            // Multiple files arrive under the same field name —
            // `getAll` returns each one. Both the legacy "actionTakenFile"
            // (now repeatable) and the newer "actionTakenFiles" key are
            // accepted so older clients keep working.
            const uploads: File[] = [
                ...form.getAll("actionTakenFile"),
                ...form.getAll("actionTakenFiles"),
            ].filter((f): f is File => f instanceof File && f.size > 0);
            for (const file of uploads) {
                const ready = await readUploadedFile(file);
                if ("error" in ready) {
                    return NextResponse.json({ error: ready.error }, { status: 400 });
                }
                filesToInsert.push(ready);
            }
        } else {
            body = await request.json();
        }

        const title = body.title || (body.category
            ? body.category.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) + " Strike"
            : "Strike Report");

        // The reporter defaults to the logged-in user but the form
        // lets HR pick anyone in the directory — they may be filing
        // a violation on behalf of a peer who flagged it. We just
        // confirm the user exists (FK guard); access to the form
        // itself is already gated by `hasViolationAccess` above, so
        // we don't need to re-restrict the reportedBy candidate.
        let reportedBy = user.dbId as number;
        if (body.reportedById && Number(body.reportedById) !== user.dbId) {
            const candidate = await prisma.user.findUnique({
                where: { id: Number(body.reportedById) },
                select: { id: true },
            });
            if (candidate) reportedBy = candidate.id;
        }

        // `data: any` so TypeScript doesn't fight schema additions until
        // the next clean `prisma generate` runs. New uploads go to the
        // side `ViolationActionFile` table (handled below); the legacy
        // single-file columns on Violation stay null on new rows.
        // Create with the DB-default status ("open"); the requested status is
        // applied via raw SQL below so the recently-added "paused" enum value
        // works even on a stale prisma client (which would reject it here).
        const requestedStatus = body.status || "open";
        const data: any = {
            userId: body.userId,
            reportedBy,
            title,
            description: body.description || null,
            severity: body.severity || "medium",
            category: body.category || null,
            actionTaken: body.actionTaken || null,
            notes: body.notes || null,
            violationDate: body.violationDate ? new Date(body.violationDate) : null,
            responsiblePersonId: body.responsiblePersonId || null,
        };

        const violation = await prisma.violation.create({
            data,
            include: {
                user: { select: { id: true, name: true, email: true, role: true, profilePictureUrl: true, teamCapsule: true } },
                reporter: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                responsiblePerson: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
            },
        });

        // Apply a non-default requested status (in_progress / paused / closed).
        if (requestedStatus !== "open") {
            await prisma.$executeRawUnsafe(
                `UPDATE "Violation" SET "status" = $1::"ViolationStatus" WHERE id = $2`,
                requestedStatus, violation.id,
            );
            (violation as any).status = requestedStatus; // reflect in response + email
        }

        // Persist each uploaded file as its own ViolationActionFile row,
        // sequentially. Using `createMany` would be tidier but the
        // typed client may lag the new model; raw SQL via $executeRawUnsafe
        // works regardless of the generated client's state.
        if (filesToInsert.length > 0) {
            for (const f of filesToInsert) {
                await prisma.$executeRawUnsafe(
                    `INSERT INTO "ViolationActionFile"
                       ("violationId", "fileName", "fileMime", "fileBlob", "uploadedById")
                     VALUES ($1, $2, $3, $4, $5)`,
                    violation.id,
                    f.fileName,
                    f.fileMime,
                    f.blob,
                    user.dbId ?? null,
                );
            }
        }

        // Notify the affected employee. Fire-and-forget so a transient
        // SMTP failure doesn't block the create from returning.
        if (violation.user?.email) {
            void sendEmail({
                to: violation.user.email,
                content: violationCreatedEmail({
                    userName:      violation.user.name || "there",
                    title:         violation.title,
                    description:   violation.description,
                    severity:      violation.severity,
                    status:        violation.status,
                    category:      violation.category,
                    actionTaken:   violation.actionTaken,
                    notes:         violation.notes,
                    reporterName:  violation.reporter?.name ?? null,
                    violationDate: violation.violationDate,
                }),
            });
        }

        return NextResponse.json(violation);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PATCH: Update violation status/action.
//
// Accepts EITHER application/json (status flips, simple text edits)
// or multipart/form-data (the edit panel, where HR adds new action
// documents and / or removes existing ones). The form-data path
// supports:
//   • `actionTakenFile` (repeatable) — each entry is a new file to
//     append to the violation's attachments (ViolationActionFile rows).
//   • `removeFileIds` (repeatable) — each entry is the integer id of
//     an existing ViolationActionFile row to delete.
//   • Legacy `clearActionTakenFile=1` — kept for the single-file
//     transition; nulls the legacy columns on Violation. (Only matters
//     until the migration backfill clears them everywhere.)
// Edits that don't touch attachments stay on the JSON path so we
// don't pay the multipart parsing cost on every status change.
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasViolationAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const ctype = request.headers.get("content-type") ?? "";
        let id:                  number | undefined;
        let status:              string | undefined;
        let actionTaken:         string | undefined;
        let severity:            string | undefined;
        let notes:               string | undefined;
        let responsiblePersonId: number | null | undefined;
        // New attachments to append to the existing list.
        const filesToInsert: Array<{ blob: Buffer; fileName: string; fileMime: string }> = [];
        // Per-file removals — id numbers from ViolationActionFile, plus
        // the special "legacy" sentinel meaning "clear the legacy
        // single-file columns on Violation".
        const fileIdsToRemove: number[] = [];
        let clearLegacyFile = false;

        if (ctype.includes("multipart/form-data")) {
            const form = await request.formData();
            const get = (k: string) => {
                const v = form.get(k);
                return typeof v === "string" ? v : null;
            };
            id                  = Number(get("id")) || undefined;
            status              = get("status")     || undefined;
            actionTaken         = get("actionTaken") ?? undefined;
            severity            = get("severity")   || undefined;
            notes               = get("notes")      ?? undefined;
            const rp            = get("responsiblePersonId");
            responsiblePersonId = rp === null ? undefined : (rp ? Number(rp) : null);
            clearLegacyFile     = get("clearActionTakenFile") === "1";

            // Per-file remove ids (repeatable). Special "legacy" string
            // flips the legacy-file clear flag — the UI sends this when
            // HR removes a row that's still using the pre-migration
            // single-file slot.
            for (const v of form.getAll("removeFileIds")) {
                if (typeof v !== "string") continue;
                if (v === "legacy") clearLegacyFile = true;
                else if (Number.isFinite(Number(v))) fileIdsToRemove.push(Number(v));
            }

            // New uploads (repeatable). Both old "actionTakenFile" and
            // the more explicit "actionTakenFiles" key are honoured.
            const uploads: File[] = [
                ...form.getAll("actionTakenFile"),
                ...form.getAll("actionTakenFiles"),
            ].filter((f): f is File => f instanceof File && f.size > 0);
            for (const file of uploads) {
                const ready = await readUploadedFile(file);
                if ("error" in ready) {
                    return NextResponse.json({ error: ready.error }, { status: 400 });
                }
                filesToInsert.push(ready);
            }
        } else {
            const body = await request.json();
            id                  = body.id;
            status              = body.status;
            actionTaken         = body.actionTaken;
            severity            = body.severity;
            notes               = body.notes;
            responsiblePersonId = body.responsiblePersonId;
        }

        if (!id) {
            return NextResponse.json({ error: "id is required" }, { status: 400 });
        }

        // Snapshot the row first so we can detect a status change AFTER
        // the update and know what to email about.
        const before = await prisma.violation.findUnique({ where: { id }, select: { status: true } });

        const data: any = {};
        // NOTE: `status` is intentionally NOT written through the typed client
        // here — it's applied via raw SQL below so the newly-added "paused"
        // enum value works even on a dev box with a stale `prisma generate`
        // cache (the typed client would reject an unknown enum value).
        if (actionTaken !== undefined) data.actionTaken = actionTaken;
        if (notes !== undefined) data.notes = notes;
        if (severity) data.severity = severity;
        if (responsiblePersonId !== undefined) data.responsiblePersonId = responsiblePersonId || null;
        if (status === "closed") data.resolvedAt = new Date();
        // Legacy single-file clear path — only fires when the UI
        // explicitly asks to drop the pre-migration inline attachment.
        if (clearLegacyFile) {
            data.actionTakenFileBlob = null;
            data.actionTakenFileName = null;
            data.actionTakenFileMime = null;
            data.actionTakenFileUrl  = null;
        }
        // (lastReminderAt reset is handled via raw SQL after the typed
        //  update below — the typed client may not know about the new
        //  column on a stale `prisma generate` cache.)

        // Per-file deletes from ViolationActionFile. Scoped by
        // violationId so a stale UI can't poke siblings of other rows.
        if (fileIdsToRemove.length > 0) {
            await prisma.$executeRawUnsafe(
                `DELETE FROM "ViolationActionFile"
                  WHERE "violationId" = $1
                    AND id = ANY($2::int[])`,
                id,
                fileIdsToRemove,
            );
        }

        // Inserts for newly-added files — same raw-SQL path as POST.
        if (filesToInsert.length > 0) {
            const uploaderId = (session?.user as any)?.dbId ?? null;
            for (const f of filesToInsert) {
                await prisma.$executeRawUnsafe(
                    `INSERT INTO "ViolationActionFile"
                       ("violationId", "fileName", "fileMime", "fileBlob", "uploadedById")
                     VALUES ($1, $2, $3, $4, $5)`,
                    id,
                    f.fileName,
                    f.fileMime,
                    f.blob,
                    uploaderId,
                );
            }
        }

        // Apply the status via raw SQL (client-agnostic enum cast) so any
        // value — including the recently-added "paused" — is written even
        // when the generated prisma client is stale. Runs before the typed
        // update so the returned row reflects the new status.
        if (status) {
            await prisma.$executeRawUnsafe(
                `UPDATE "Violation" SET "status" = $1::"ViolationStatus" WHERE id = $2`,
                status, id,
            );
        }

        // The typed update carries the remaining (non-status) fields. When
        // only the status changed, `data` is empty and we just re-read the
        // row with its relations for the response / email below.
        const includeRel = {
            user: { select: { id: true, name: true, email: true, role: true, profilePictureUrl: true, teamCapsule: true } },
            reporter: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
            responsiblePerson: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
        } as const;
        const violation = Object.keys(data).length > 0
            ? await prisma.violation.update({ where: { id }, data, include: includeRel })
            : (await prisma.violation.findUnique({ where: { id }, include: includeRel }))!;

        // Email the affected employee if the status actually changed.
        // Same fire-and-forget pattern as the create path.
        if (status && before?.status && status !== before.status && violation.user?.email) {
            const session2 = session;
            const changedByName = (session2?.user as any)?.name || null;
            void sendEmail({
                to: violation.user.email,
                content: violationStatusChangedEmail({
                    userName:      violation.user.name || "there",
                    title:         violation.title,
                    oldStatus:     before.status,
                    newStatus:     status,
                    actionTaken:   violation.actionTaken,
                    notes:         violation.notes,
                    changedByName,
                }),
            });
            // Reset the reminder clock so the cron starts the new
            // "still in progress" countdown from this status change,
            // not from when the violation was first logged. Raw SQL
            // bypasses any typed-client lag on the new column.
            try {
                await prisma.$executeRawUnsafe(
                    `UPDATE "Violation" SET "lastReminderAt" = NULL WHERE id = $1`,
                    id,
                );
            } catch (e) {
                console.warn("[violations PATCH] lastReminderAt reset failed:", e);
            }
        }

        return NextResponse.json(violation);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE: admin tier (CEO / dev / special_access / role=admin). HR
// Manager intentionally NOT included — destructive log delete should
// stay above HR's normal write access.
export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as any;
        const canDelete =
            user?.orgLevel === "ceo" ||
            user?.orgLevel === "special_access" ||
            user?.role === "admin" ||
            user?.isDeveloper === true;
        if (!canDelete) {
            return NextResponse.json({ error: "Only admins can delete violations" }, { status: 403 });
        }

        const { id } = await request.json();
        await prisma.violation.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
