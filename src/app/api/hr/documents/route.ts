import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

// Tighter than the generic isHRAdmin — documents are PII. Per HR
// policy (2026-06-05): only CEO, developers, and the HR team
// (orgLevel=hr_manager) can see / write OTHER employees' documents.
// Excludes special_access and role=admin, which pass isHRAdmin in
// other contexts. Self-upload is handled separately at each call
// site (target === myId always allowed). Delegates to the shared
// isLeadershipOrHR (HR_CONFIDENTIAL via designation — policy
// 2026-07-14) so it stays in sync with canViewEmployeeDocuments.
import { isLeadershipOrHR } from "@/lib/access";
function isHRAdmin(u: any): boolean {
  return isLeadershipOrHR(u);
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    const admin = isHRAdmin(self);
    // Admins can list any user's docs (or all if no userId param);
    // non-admins are scoped to their own. Asking for someone else's
    // when not admin → 403 (not silent fallback to self) so UI bugs
    // surface instead of leaking your own docs into the wrong page.
    const requested = searchParams.get("userId");
    // Explicit self-view (profile "My documents", the personal Documents
    // page). ALWAYS scopes to the authenticated caller — even for HR
    // admins, who would otherwise fall through to the org-wide list
    // below and see everyone's (incl. other-brand) documents in their
    // OWN profile. The self-view must never depend on the client
    // sending its own id.
    const selfOnly = searchParams.get("self") === "true";
    let userId: number;
    if (selfOnly) {
      userId = myId;
    } else if (requested) {
      const n = parseInt(requested);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Bad userId" }, { status: 400 });
      }
      if (!admin && n !== myId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      userId = n;
    } else {
      userId = myId;
    }

    const docs = await prisma.employeeDocument.findMany({
      where: admin && !requested && !selfOnly ? {} : { userId },
      include: {
        user: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(docs);
  } catch (e) { return serverError(e, "GET /api/hr/documents"); }
}

// POST accepts EITHER:
//   • Legacy JSON body { userId, category, fileName, fileUrl, expiryDate? }
//     — kept for any pre-existing caller that hands in a hosted URL.
//   • multipart/form-data with `file` (the actual file bytes) +
//     `userId` + `category` + optional `fileName`
//     — new path used by the redesigned DocumentsPanel. Bytes land in
//     EmployeeDocument.fileBlob; serving is via /api/hr/documents/:id/file.
//
// Permission: HR admin OR the profile owner themselves. Self-upload
// is the key change from before — employees need to be able to fix
// their own missing PAN / Aadhaar / Education when the compliance
// cron warns them, without waiting for HR.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  try {
    const contentType = req.headers.get("content-type") || "";

    // ── Multipart path (new) ────────────────────────────────────────
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!(file instanceof Blob) || file.size === 0) {
        return NextResponse.json({ error: "File is required." }, { status: 400 });
      }
      const targetUserId = Number(fd.get("userId") || myId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return NextResponse.json({ error: "Bad userId." }, { status: 400 });
      }
      // Self-upload OR HR admin uploading for someone else.
      if (targetUserId !== myId && !isHRAdmin(self)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const category = String(fd.get("category") || "other").trim();
      // Provided name OR fall back to the file's name. Strip path
      // separators so a sneaky filename can't trick a downstream Path.
      const rawName = String(fd.get("fileName") || (file as any).name || "document");
      const fileName = rawName.replace(/[\\/]/g, "_").trim().slice(0, 200) || "document";
      // SECURITY — refuse to store dangerous MIMEs. Even if a request
      // tries to tag an upload as text/html or image/svg+xml, we
      // rewrite the stored fileMime so the serve route can't be
      // tricked into rendering it inline. The serve route also
      // safelist-gates inline rendering as a second layer, but we
      // want bad rows to never exist in the first place. Magic-byte
      // sniffing would be stronger; for now the combination of:
      //   • client-claim sanitisation here, and
      //   • allowlist + nosniff + CSP at serve time
      // closes the XSS-via-upload vector flagged in security review.
      const claimedMime = String((file as any).type || "").toLowerCase().split(";")[0]?.trim() || "";
      const SAFE_UPLOAD_MIMES = new Set([
        "application/pdf",
        "image/png", "image/jpeg", "image/webp", "image/gif",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ]);
      const NEVER_UPLOAD_MIMES = new Set([
        "text/html", "application/xhtml+xml", "image/svg+xml",
        "text/javascript", "application/javascript",
        "application/ecmascript", "text/ecmascript",
      ]);
      if (NEVER_UPLOAD_MIMES.has(claimedMime)) {
        return NextResponse.json(
          { error: "This file type isn't allowed for upload." },
          { status: 415 },
        );
      }
      // Reject text/* (except plain) and any 'script' variants so a
      // creative attacker can't slip past the deny list. Anything
      // outside the safe set is stored as octet-stream — the serve
      // route then forces attachment-download for it.
      let fileMime = claimedMime;
      if ((claimedMime.startsWith("text/") && claimedMime !== "text/plain") || claimedMime.includes("script")) {
        return NextResponse.json(
          { error: "This file type isn't allowed for upload." },
          { status: 415 },
        );
      }
      if (!SAFE_UPLOAD_MIMES.has(claimedMime)) {
        fileMime = "application/octet-stream";
      }
      // Hard cap at 10 MB to keep DB rows small (matches what HR
      // realistically uploads — Aadhaar/PAN PDFs are typically <1 MB).
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large — limit is 10 MB." }, { status: 413 });
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      // Use raw SQL because the typed Prisma client may be stale on
      // VPS and not know fileBlob/fileMime yet. Insert then re-fetch
      // the row metadata to return to the caller.
      const inserted = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "EmployeeDocument"
           ("userId","category","fileName","fileUrl","fileBlob","fileMime",
            "uploadedById","isVerified","createdAt")
         VALUES ($1,$2,$3,'',$4::bytea,$5,$6,false,NOW())
         RETURNING id, "userId", category, "fileName", "fileMime", "createdAt"`,
        targetUserId, category, fileName, bytes, fileMime, myId,
      );
      const id = inserted[0]?.id;
      // Set the fileUrl now that we know the id — internal serve URL.
      const url = `/api/hr/documents/${id}/file`;
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeDocument" SET "fileUrl" = $1 WHERE id = $2`,
        url, id,
      );
      return NextResponse.json({ ...inserted[0], fileUrl: url });
    }

    // ── Legacy JSON path ────────────────────────────────────────────
    if (!isHRAdmin(self)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json();
    if (body.expiryDate) body.expiryDate = new Date(body.expiryDate);
    const doc = await prisma.employeeDocument.create({
      data: { ...body, uploadedById: myId },
    });
    return NextResponse.json(doc);
  } catch (e) { return serverError(e, "POST /api/hr/documents"); }
}
