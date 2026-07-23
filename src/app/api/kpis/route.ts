// KPI listing — returns the KPI document(s) the caller is allowed to
// see. Scope is role-based:
//
//   • Admin tier (CEO / developer / special_access / role=admin /
//     role=hr_manager / orgLevel=hr_manager) → every department's doc.
//   • Everyone else → only their own bucket (resolved from the
//     viewer's role/orgLevel + EmployeeProfile.department — see
//     bucketFor() below).
//
// Each entry includes the doc URL (or null if the bucket has no doc
// uploaded yet) plus a small "members" preview so the listing page
// can show who the doc applies to.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError, isHRAdmin } from "@/lib/api-auth";
import { DEPARTMENTS } from "@/lib/departments";
import { DEPARTMENTS_YT_LABS } from "@/lib/departments-yt-labs";

export const dynamic = "force-dynamic";

type Member = {
  id: number;
  name: string | null;
  profilePictureUrl: string | null;
  designation: string | null;
};
type DepartmentEntry = {
  brand: string;
  department: string;
  fileName: string | null;
  fileUrl:  string | null;
  uploadedAt: string | null;
  members: Member[];
};

// Specific manager-named cards win over the generic "Managers"
// catch-all so a Research Manager lands under "Research Manager".
function bucketForManager(role: string | null): string {
  if (role === "researcher_manager" || role === "research_manager") return "Research Manager";
  if (role === "qa_manager") return "QA Manager";
  if (role === "social_media_manager") return "Social Media Manager";
  return "Managers";
}

// Anyone with a manager-flavoured org level/role goes to a manager
// bucket regardless of their stored EmployeeProfile.department —
// otherwise the "Managers" card shows 0 members because nobody has
// `department = "Managers"` (department is a domain, not a role).
//
// HR-tier users (orgLevel/role = "hr_manager") are an exception:
// they belong to the HR card, not the generic Managers card, since
// HR has its own KPI doc and their domain IS HR.
function bucketFor(m: { orgLevel: string | null; role: string | null; department: string | null }): string | null {
  if (m.orgLevel === "hr_manager" || m.role === "hr_manager") return "HR";
  const isManager =
    m.orgLevel === "manager" ||
    (m.role || "").endsWith("_manager");
  if (isManager) return bucketForManager(m.role);
  return m.department;
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const myId = await resolveUserId(session);
    const u = session!.user as any;
    // RBAC-designation-driven (policy 2026-07-14) — shared isHRAdmin
    // resolves MANAGE_HR from the caller's designation.
    const isTopTier = isHRAdmin(u);

    // Resolve the viewer's department + role/orgLevel + brand — used
    // to pick the right KPI bucket AND the right brand-tagged doc.
    // The brand split means the same department name (e.g. "HR
    // Operations & TA") can hold two distinct docs and we have to
    // pick the one matching the viewer.
    const viewerInfo = await prisma.$queryRawUnsafe<Array<{
      department:   string | null;
      orgLevel:     string | null;
      role:         string | null;
      businessUnit: string | null;
    }>>(
      `SELECT ep.department, u."orgLevel", u."role", ep."businessUnit"
         FROM "User" u
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE u.id = $1 LIMIT 1`,
      myId,
    );
    const myDepartment = viewerInfo[0]?.department || null;
    const myOrgLevel   = viewerInfo[0]?.orgLevel   || null;
    const myRole       = viewerInfo[0]?.role       || null;
    const myBrand: "NB Media" | "YT Labs" =
      (viewerInfo[0]?.businessUnit || "NB Media") === "YT Labs" ? "YT Labs" : "NB Media";
    const viewerBucket = bucketFor({
      orgLevel: myOrgLevel, role: myRole, department: myDepartment,
    });

    // Admins (top tier) can optionally narrow to a specific brand via
    // ?brand=. Falls back to all brands when unset / "all" so the
    // existing org-wide view stays the default.
    const adminBrandSlug = (req.nextUrl.searchParams.get("brand") || "").toLowerCase();
    const adminBrand: "NB Media" | "YT Labs" | null =
      adminBrandSlug === "yt-labs" || adminBrandSlug === "yt"     ? "YT Labs" :
      adminBrandSlug === "nb-media" || adminBrandSlug === "nb"    ? "NB Media" :
      null;

    type DocRow = {
      brand: string;
      department: string;
      fileName: string;
      fileUrl: string;
      uploadedAt: Date;
    };
    let docs: DocRow[];
    if (isTopTier) {
      docs = adminBrand
        ? await prisma.$queryRawUnsafe<DocRow[]>(
            `SELECT brand, department, "fileName", "fileUrl", "uploadedAt"
               FROM "KpiDocument" WHERE brand = $1 ORDER BY department ASC`,
            adminBrand,
          )
        : await prisma.$queryRawUnsafe<DocRow[]>(
            `SELECT brand, department, "fileName", "fileUrl", "uploadedAt"
               FROM "KpiDocument" ORDER BY brand ASC, department ASC`,
          );
    } else if (viewerBucket) {
      // Non-admin: the doc is keyed by (brand, department) so we MUST
      // include the viewer's brand to avoid showing the wrong-brand
      // doc when the department name is shared (e.g. HR Ops & TA).
      docs = await prisma.$queryRawUnsafe<DocRow[]>(
        `SELECT brand, department, "fileName", "fileUrl", "uploadedAt"
           FROM "KpiDocument" WHERE brand = $1 AND department = $2`,
        myBrand, viewerBucket,
      );
    } else {
      docs = [];
    }

    type MemberRow = Member & {
      department:   string | null;
      orgLevel:     string | null;
      role:         string | null;
      businessUnit: string | null;
    };
    // Exclude CEO-tier users from the KPI listing — they don't have a
    // KPI document tracked against them, so without this filter their
    // department string ("CEO & FOUNDER") rendered as a one-member
    // empty card. Other tiers (special_access / hr_manager / etc.)
    // are still included so HR's own KPIs show up.
    //
    // Non-admin viewers fetch the same row set; we filter to their
    // bucket in JS below. Cheap given the company-sized dataset and
    // keeps bucket logic in one place.
    const members = await prisma.$queryRawUnsafe<MemberRow[]>(
      `SELECT u.id, u.name, u."profilePictureUrl",
              u."orgLevel", u."role",
              ep.designation, ep.department, ep."businessUnit"
         FROM "User" u
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE u."isActive" = true AND u."orgLevel" <> 'ceo'
        ORDER BY ep.department ASC NULLS LAST, u.name ASC`,
    );

    // Pre-compute each member's bucket + brand once. Bucket = the
    // department key the KPI doc is filed under; brand = which doc
    // version (NB Media vs YT Labs) they should see for that bucket.
    const memberBucket = new Map<number, string | null>();
    const memberBrand  = new Map<number, "NB Media" | "YT Labs">();
    for (const m of members) {
      memberBucket.set(m.id, bucketFor(m));
      memberBrand.set(m.id, (m.businessUnit === "YT Labs" ? "YT Labs" : "NB Media"));
    }

    const visibleMembers = isTopTier
      ? (adminBrand
          ? members.filter((m) => memberBrand.get(m.id) === adminBrand)
          : members)
      : viewerBucket
        ? members.filter((m) => memberBucket.get(m.id) === viewerBucket && memberBrand.get(m.id) === myBrand)
        : [];

    // Build per-(brand, dept) entries — same dept name can produce
    // two cards, one per brand, when both brands populate it (e.g.
    // shared "HR Operations & TA").
    //
    // Admin tier sees every CANONICAL (brand, department) pair plus
    // any (brand, department) that has live members or an existing
    // doc — same orphan-with-people surfacing as before, just keyed
    // by brand too.
    type Key = `${string}::${string}`; // brand::department
    const keyOf = (brand: string, dept: string): Key => `${brand}::${dept}` as Key;

    const entryKeys = new Set<Key>();
    if (isTopTier) {
      if (!adminBrand || adminBrand === "NB Media") {
        for (const d of DEPARTMENTS) entryKeys.add(keyOf("NB Media", d));
      }
      if (!adminBrand || adminBrand === "YT Labs") {
        for (const d of DEPARTMENTS_YT_LABS) entryKeys.add(keyOf("YT Labs", d));
      }
      for (const m of visibleMembers) {
        const b = memberBucket.get(m.id);
        const br = memberBrand.get(m.id)!;
        if (b) entryKeys.add(keyOf(br, b));
      }
      // Surface any orphan docs (no live members yet) so admins can
      // see what's uploaded.
      for (const d of docs) entryKeys.add(keyOf(d.brand, d.department));
    } else if (viewerBucket) {
      entryKeys.add(keyOf(myBrand, viewerBucket));
    }

    const docByKey     = new Map<Key, typeof docs[number]>();
    for (const d of docs) docByKey.set(keyOf(d.brand, d.department), d);
    const membersByKey = new Map<Key, Member[]>();
    for (const m of visibleMembers) {
      const b = memberBucket.get(m.id);
      const br = memberBrand.get(m.id)!;
      if (!b) continue;
      const k = keyOf(br, b);
      if (!membersByKey.has(k)) membersByKey.set(k, []);
      membersByKey.get(k)!.push({
        id: m.id, name: m.name,
        profilePictureUrl: m.profilePictureUrl,
        designation: m.designation,
      });
    }

    // Sort: NB Media canonical order → YT Labs canonical order →
    // anything legacy alphabetically. Matches the upload-form
    // dropdown layout in /dashboard/kpis/manage.
    const nbIndex = new Map(DEPARTMENTS.map((d, i) => [d, i]));
    const ytIndex = new Map(DEPARTMENTS_YT_LABS.map((d, i) => [d, i]));
    const brandOrder = (b: string) => b === "NB Media" ? 0 : b === "YT Labs" ? 1 : 2;
    const sortedKeys = Array.from(entryKeys).sort((aKey, bKey) => {
      const [aBrand, aDept] = aKey.split("::");
      const [bBrand, bDept] = bKey.split("::");
      const bo = brandOrder(aBrand) - brandOrder(bBrand);
      if (bo !== 0) return bo;
      const ai = aBrand === "NB Media" ? nbIndex.get(aDept) : ytIndex.get(aDept);
      const bi = bBrand === "NB Media" ? nbIndex.get(bDept) : ytIndex.get(bDept);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return aDept.localeCompare(bDept);
    });

    const departments: DepartmentEntry[] = sortedKeys.map((k) => {
      const [brand, dept] = k.split("::");
      const doc = docByKey.get(k) || null;
      return {
        brand,
        department: dept,
        fileName:   doc?.fileName  ?? null,
        fileUrl:    doc?.fileUrl   ?? null,
        uploadedAt: doc?.uploadedAt ? new Date(doc.uploadedAt).toISOString() : null,
        members:    membersByKey.get(k) ?? [],
      };
    });

    return NextResponse.json({
      scope: isTopTier ? "all" : "self",
      myDepartment: viewerBucket,
      myBrand,
      departments,
    });
  } catch (e) {
    return serverError(e, "GET /api/kpis");
  }
}
