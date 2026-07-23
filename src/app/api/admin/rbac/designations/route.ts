// GET  /api/admin/rbac/designations  → permission catalog + all designations (with grants + user counts)
// POST /api/admin/rbac/designations  → create a new designation
//
// Gated to the HR Manager + top admins. Raw SQL (no typed-client dependency).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import { canManageDesignations, syncGrants, syncReportGrants, syncReportTemplates, toDesignationKey } from "@/lib/permissions/designation-admin";
import { getManagerReportFormat, isManagerReportEligible, REPORT_TEMPLATES } from "@/lib/reports/manager-report-format";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Self-heal: ensure every code-defined permission exists as a row, so a newly
  // added catalog permission is immediately grantable on ANY database without a
  // manual re-seed. Prevents the "ticked it but it didn't save" drift that
  // happens when the code has a permission the DB hasn't been seeded with.
  try {
    for (const perm of PERMISSION_CATALOG) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Permission" ("key","label","description","category","sensitive","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
         ON CONFLICT ("key") DO UPDATE SET
           "label"=EXCLUDED."label","description"=EXCLUDED."description",
           "category"=EXCLUDED."category","sensitive"=EXCLUDED."sensitive","updatedAt"=NOW()`,
        perm.key, perm.label, perm.description, perm.category, !!perm.sensitive
      );
    }
  } catch { /* RBAC tables missing pre-migration → ignore */ }

  const designations = await prisma.$queryRawUnsafe<
    { id: number; key: string; label: string; scorecardFunction: string | null;
      isActive: boolean; isSystem: boolean; sortOrder: number; businessUnit: string | null; userCount: number }[]
  >(
    `SELECT d."id", d."key", d."label", d."scorecardFunction", d."isActive", d."isSystem", d."sortOrder", d."businessUnit",
            (SELECT count(*)::int FROM "User" u WHERE u."designationId" = d."id") AS "userCount"
     FROM "Designation" d ORDER BY d."sortOrder", d."label"`
  );
  const grants = await prisma.$queryRawUnsafe<{ did: number; key: string }[]>(
    `SELECT dp."designationId" AS "did", pm."key" AS "key"
     FROM "DesignationPermission" dp JOIN "Permission" pm ON pm."id" = dp."permissionId"`
  );
  const byDesig = new Map<number, string[]>();
  for (const g of grants) {
    const arr = byDesig.get(g.did) ?? [];
    arr.push(g.key);
    byDesig.set(g.did, arr);
  }

  // Report-owners: the people whose weekly/monthly reports exist, that a
  // designation can be granted view access to. Same eligibility + role label
  // the reports system uses, so the editor shows them grouped by report role.
  const ownerRows = await prisma.$queryRawUnsafe<
    { id: number; name: string; role: string | null; orgLevel: string | null; reportAccess: boolean | null }[]
  >(
    `SELECT u."id", u."name", u."role", u."orgLevel", u."reportAccess"
     FROM "User" u WHERE u."isActive" = true ORDER BY u."name" ASC`
  );
  const reportOwners = ownerRows
    .filter((u) => isManagerReportEligible(u))
    .map((u) => ({ id: Number(u.id), name: u.name, role: getManagerReportFormat(u) }));

  // Per-designation granted report-owner ids. Wrapped so a pre-migration DB
  // (table absent) degrades to "no grants" instead of 500-ing.
  const ownersByDesig = new Map<number, number[]>();
  try {
    const reportGrants = await prisma.$queryRawUnsafe<{ did: number; mid: number }[]>(
      `SELECT "designationId" AS "did", "managerId" AS "mid" FROM "DesignationReportAccess"`
    );
    for (const g of reportGrants) {
      const arr = ownersByDesig.get(Number(g.did)) ?? [];
      arr.push(Number(g.mid));
      ownersByDesig.set(Number(g.did), arr);
    }
  } catch { /* table not yet created — no grants */ }

  // Per-designation report-template assignments (production|researcher|qa|hr).
  // Wrapped so a pre-migration DB degrades to "none".
  const templatesByDesig = new Map<number, string[]>();
  try {
    const tmplGrants = await prisma.$queryRawUnsafe<{ did: number; tmpl: string }[]>(
      `SELECT "designationId" AS "did", "template" AS "tmpl" FROM "DesignationReportTemplate"`
    );
    for (const g of tmplGrants) {
      const arr = templatesByDesig.get(Number(g.did)) ?? [];
      arr.push(g.tmpl);
      templatesByDesig.set(Number(g.did), arr);
    }
  } catch { /* table not yet created — no template grants */ }

  return NextResponse.json({
    catalog: PERMISSION_CATALOG,
    reportOwners,
    reportTemplateCatalog: REPORT_TEMPLATES,
    designations: designations.map((d) => ({
      ...d,
      userCount: Number(d.userCount),
      permissionKeys: byDesig.get(d.id) ?? [],
      reportOwnerIds: ownersByDesig.get(d.id) ?? [],
      reportTemplates: templatesByDesig.get(d.id) ?? [],
    })),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });

  const baseKey = (body.key ? toDesignationKey(String(body.key)) : toDesignationKey(label)) || "designation";
  const scorecardFunction = body.scorecardFunction ? String(body.scorecardFunction) : null;
  // Brand the designation belongs to. New ones default to NB Media unless the
  // YT Labs tab created them. Drives which brand's list it shows up in.
  const businessUnit = body.businessUnit ? String(body.businessUnit) : "NB Media";
  // Designations are per-brand, but `key` is globally unique — so the SAME label
  // can legitimately exist in two brands with different permissions. Qualify the
  // key with the brand for non-NB-Media brands; NB Media keeps the bare key for
  // back-compat with the seed/legacy keys (hr_manager, production_manager, …).
  const key = businessUnit === "NB Media" ? baseKey : `${baseKey}_${toDesignationKey(businessUnit)}`;
  const permissionKeys: string[] = Array.isArray(body.permissionKeys) ? body.permissionKeys.map(String) : [];
  const reportOwnerIds: number[] = Array.isArray(body.reportOwnerIds) ? body.reportOwnerIds.map(Number) : [];
  const reportTemplates: string[] = Array.isArray(body.reportTemplates) ? body.reportTemplates.map(String) : [];
  const actorId = (session.user as { dbId?: number }).dbId ?? null;

  const created = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO "Designation" ("key","label","scorecardFunction","businessUnit","isActive","sortOrder","isSystem","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,true, COALESCE((SELECT max("sortOrder") + 1 FROM "Designation"), 0), false, NOW(), NOW())
     ON CONFLICT ("key") DO NOTHING
     RETURNING "id"`,
    key, label, scorecardFunction, businessUnit
  );
  if (!created.length) {
    return NextResponse.json({ error: `A "${label}" designation already exists in ${businessUnit}.` }, { status: 409 });
  }
  await syncGrants(created[0].id, permissionKeys, actorId);
  await syncReportGrants(created[0].id, reportOwnerIds, actorId);
  await syncReportTemplates(created[0].id, reportTemplates, actorId);
  return NextResponse.json({ ok: true, id: created[0].id, key });
}
