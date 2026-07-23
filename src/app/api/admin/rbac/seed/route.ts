// Developer-only, idempotent seed + backfill for the designation-based RBAC.
//
//   POST /api/admin/rbac/seed
//
// 1. Upserts the permission catalog (src/lib/permissions/catalog.ts) into Permission.
// 2. Upserts the system designations (designation-seed.ts) into Designation.
// 3. Grants each designation its seeded permissions (insert-missing — never
//    clobbers grants the HR Manager added later).
// 4. Backfills User.designationId for any user that doesn't have one yet,
//    derived from their legacy (orgLevel, role) so access is reproduced 1:1.
//
// Run order (after stopping the dev server so prisma can regenerate):
//   prisma migrate deploy   # or: prisma migrate dev --name add_designation_rbac
//   prisma generate
//   # restart dev server, then POST this route once.
//
// Uses raw SQL so it works even before the typed client knows the new models.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import { DESIGNATION_SEED, legacyDesignationKey } from "@/lib/permissions/designation-seed";

export async function POST() {
  // ── Gate: developers only ──
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user as { isDeveloper?: boolean }).isDeveloper !== true) {
    return NextResponse.json({ error: "Forbidden — developer only" }, { status: 403 });
  }

  try {
    // ── 1. Permission catalog ──
    for (const p of PERMISSION_CATALOG) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Permission" ("key","label","description","category","sensitive","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
         ON CONFLICT ("key") DO UPDATE SET
           "label"=EXCLUDED."label","description"=EXCLUDED."description",
           "category"=EXCLUDED."category","sensitive"=EXCLUDED."sensitive","updatedAt"=NOW()`,
        p.key, p.label, p.description, p.category, !!p.sensitive
      );
    }

    // ── 2. System designations ──
    for (const d of DESIGNATION_SEED) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Designation" ("key","label","scorecardFunction","isActive","sortOrder","isSystem","createdAt","updatedAt")
         VALUES ($1,$2,$3,true,$4,true,NOW(),NOW())
         ON CONFLICT ("key") DO UPDATE SET
           "label"=EXCLUDED."label","scorecardFunction"=EXCLUDED."scorecardFunction",
           "sortOrder"=EXCLUDED."sortOrder","isSystem"=true,"updatedAt"=NOW()`,
        d.key, d.label, d.scorecardFunction, d.sortOrder
      );
    }

    // ── 3. Grants (insert-missing; preserves later HR edits) ──
    for (const d of DESIGNATION_SEED) {
      for (const permKey of d.permissions) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "DesignationPermission" ("designationId","permissionId","createdAt")
           SELECT dg."id", pm."id", NOW()
           FROM "Designation" dg, "Permission" pm
           WHERE dg."key"=$1 AND pm."key"=$2
           ON CONFLICT ("designationId","permissionId") DO NOTHING`,
          d.key, permKey
        );
      }
    }

    // ── 4. Backfill users without a designation ──
    const desigRows = await prisma.$queryRawUnsafe<{ id: number; key: string }[]>(
      `SELECT "id","key" FROM "Designation"`
    );
    const idByKey = new Map(desigRows.map((r) => [r.key, r.id]));

    const users = await prisma.$queryRawUnsafe<
      { id: number; orgLevel: string | null; role: string | null }[]
    >(
      `SELECT "id","orgLevel"::text AS "orgLevel","role"::text AS "role"
       FROM "User" WHERE "designationId" IS NULL`
    );

    let assigned = 0;
    const fellBackToMember: { id: number; orgLevel: string | null; role: string | null }[] = [];
    for (const u of users) {
      const key = legacyDesignationKey(u.orgLevel, u.role);
      const designationId = idByKey.get(key);
      if (!designationId) continue;
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "designationId"=$1 WHERE "id"=$2`,
        designationId, u.id
      );
      assigned++;
      // Flag anyone who only mapped to "member" by fallback (not an actual member)
      // so HR can review rather than silently under-provisioning access.
      if (key === "member" && u.orgLevel && u.orgLevel !== "member") {
        fellBackToMember.push(u);
      }
    }

    return NextResponse.json({
      ok: true,
      permissions: PERMISSION_CATALOG.length,
      designations: DESIGNATION_SEED.length,
      usersBackfilled: assigned,
      usersWithoutDesignationRemaining: users.length - assigned,
      reviewTheseFellBackToMember: fellBackToMember,
    });
  } catch (e) {
    console.error("[rbac/seed] failed:", e);
    return NextResponse.json(
      { error: "Seed failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
