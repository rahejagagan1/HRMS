// Parked documents for new joiners not yet in the DB.
//
// The letter generator's manual-entry mode renders an offer letter (etc.)
// for a typed-in person and calls savePendingDocument() — stored keyed by
// EMAIL. When a User with that email is created (Add-Employee / onboarding
// / ClickUp sync), attachPendingDocuments() copies the parked PDF into
// their EmployeeDocument list so it shows in the Documents tab. A sweep
// (attachDuePendingDocuments) covers users created by any path.
//
// Raw SQL throughout — the typed client lags behind new tables on the
// dev/VPS box (same pattern as the rest of the HR module).

import prisma from "@/lib/prisma";

export type PendingDocRow = {
  id: number;
  email: string;
  fullName: string | null;
  category: string;
  templateKey: string | null;
  fileName: string;
  brand: string | null;
  createdAt: string;
  attachedUserId: number | null;
  attachedAt: string | null;
};

/** Park a generated document for a not-yet-created joiner. Returns the
 *  new row id, or null if the store is unavailable. */
export async function savePendingDocument(args: {
  email: string;
  fullName?: string | null;
  category?: string;
  templateKey?: string | null;
  fileName: string;
  fileBlob: Buffer;
  fileMime?: string;
  brand?: string | null;
  createdById?: number | null;
}): Promise<number | null> {
  const email = (args.email || "").trim().toLowerCase();
  if (!email) return null;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "PendingDocument"
         ("email","fullName","category","templateKey","fileName","fileBlob","fileMime","brand","createdById","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6::bytea,$7,$8,$9,NOW())
       RETURNING id`,
      email, args.fullName ?? null, args.category ?? "employee_letter",
      args.templateKey ?? null, args.fileName, args.fileBlob,
      args.fileMime ?? "application/pdf", args.brand ?? null, args.createdById ?? null,
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    console.warn("[pending-docs] save failed:", (e as any)?.message);
    return null;
  }
}

/** Copy any UNATTACHED pending docs for `email` into the user's
 *  EmployeeDocument list. Idempotent (guarded on attachedUserId IS NULL).
 *  Best-effort — never throws. Returns how many were attached. */
export async function attachPendingDocuments(userId: number, email: string | null | undefined): Promise<number> {
  if (!email || !Number.isInteger(userId) || userId <= 0) return 0;
  let rows: any[] = [];
  try {
    rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, category, "fileName", "fileBlob", "fileMime", "createdById"
         FROM "PendingDocument"
        WHERE lower("email") = lower($1) AND "attachedUserId" IS NULL`,
      email.trim(),
    );
  } catch (e) {
    console.warn("[pending-docs] lookup failed (table missing?):", (e as any)?.message);
    return 0;
  }
  let n = 0;
  for (const r of rows) {
    try {
      const ins = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "EmployeeDocument"
           ("userId","category","fileName","fileUrl","fileBlob","fileMime","uploadedById","isVerified","createdAt")
         VALUES ($1,$2,$3,'',$4::bytea,$5,$6,false,NOW())
         RETURNING id`,
        userId, r.category, r.fileName, r.fileBlob, r.fileMime ?? "application/pdf",
        r.createdById ?? userId,
      );
      const docId = ins[0]?.id;
      if (docId) {
        await prisma.$executeRawUnsafe(
          `UPDATE "EmployeeDocument" SET "fileUrl" = $1 WHERE id = $2`,
          `/api/hr/documents/${docId}/file`, docId,
        );
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "PendingDocument" SET "attachedUserId" = $1, "attachedAt" = NOW() WHERE id = $2`,
        userId, r.id,
      );
      n++;
    } catch (e) {
      console.warn(`[pending-docs] attach row #${r.id} failed:`, (e as any)?.message);
    }
  }
  return n;
}

/** Sweep: attach every unattached pending doc whose email matches an
 *  existing ACTIVE user. Covers users created by ANY path (Add-Employee,
 *  ClickUp sync, manual) without hooking each creation site. Safe to run
 *  repeatedly. Returns total attached. */
export async function attachDuePendingDocuments(): Promise<number> {
  let pairs: Array<{ userId: number; email: string }> = [];
  try {
    pairs = await prisma.$queryRawUnsafe<Array<{ userId: number; email: string }>>(
      `SELECT DISTINCT u.id AS "userId", u.email AS email
         FROM "PendingDocument" pd
         JOIN "User" u ON lower(u.email) = lower(pd.email)
        WHERE pd."attachedUserId" IS NULL AND u."isActive" = true AND u.email IS NOT NULL`,
    );
  } catch (e) {
    console.warn("[pending-docs] sweep lookup failed:", (e as any)?.message);
    return 0;
  }
  let total = 0;
  for (const p of pairs) total += await attachPendingDocuments(Number(p.userId), p.email);
  return total;
}

/** List parked docs (unattached by default) for the HR management view. */
export async function listPendingDocuments(opts?: { includeAttached?: boolean }): Promise<PendingDocRow[]> {
  try {
    const where = opts?.includeAttached ? "" : `WHERE "attachedUserId" IS NULL`;
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, email, "fullName", category, "templateKey", "fileName", brand,
              to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS') AS "createdAt",
              "attachedUserId",
              to_char("attachedAt", 'YYYY-MM-DD"T"HH24:MI:SS') AS "attachedAt"
         FROM "PendingDocument" ${where}
        ORDER BY "createdAt" DESC
        LIMIT 500`,
    );
    return rows as PendingDocRow[];
  } catch {
    return [];
  }
}

/** Delete an unattached parked doc (HR cancels a mistake). */
export async function cancelPendingDocument(id: number): Promise<boolean> {
  try {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "PendingDocument" WHERE id = $1 AND "attachedUserId" IS NULL`,
      id,
    );
    return Number(n) > 0;
  } catch {
    return false;
  }
}
