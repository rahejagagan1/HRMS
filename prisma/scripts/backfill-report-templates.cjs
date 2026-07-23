// One-time, idempotent backfill: stamp every existing WeeklyReport /
// MonthlyReport with its report template, so historical reports are preserved
// AND categorized even as people change roles. Never deletes. Re-runnable
// (only touches rows where "reportTemplate" IS NULL).
//
// Usage (the caller picks the DB):
//   DATABASE_URL="postgresql://.../nb_dashboard" node prisma/scripts/backfill-report-templates.cjs
//
// The template logic below MIRRORS getManagerReportFormat in
// src/lib/reports/manager-report-format.ts — keep them in sync. (No tsx/ts-node
// in this repo, so the pure logic is inlined for this standalone script.)

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PRODUCTION_NAME_PARTS = ["bhoomika", "manpreet", "tanya", "sreyasi"];

function getManagerReportFormat(u) {
  const role = String(u.role ?? "").toLowerCase();
  const org = String(u.orgLevel ?? "").toLowerCase();
  const name = String(u.name ?? "").toLowerCase();
  if (role === "hr_manager" || org === "hr_manager") return "hr";
  if (role === "researcher_manager") return "researcher";
  if (role === "production_manager") return "production";
  if (role === "qa" && ["manager", "hod", "special_access"].includes(org)) return "qa";
  if (name.includes("tanvi")) return "hr";
  if (name.includes("nishant")) return "researcher";
  if (PRODUCTION_NAME_PARTS.some((p) => name.includes(p))) return "production";
  if (name.includes("andrew")) return "qa";
  return "production";
}

(async () => {
  const summary = { production: 0, researcher: 0, qa: 0, hr: 0 };
  let managersDone = 0;
  let failures = 0;
  try {
    const ids = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "managerId" FROM (
         SELECT "managerId" FROM "WeeklyReport"  WHERE "reportTemplate" IS NULL
         UNION
         SELECT "managerId" FROM "MonthlyReport" WHERE "reportTemplate" IS NULL
       ) m ORDER BY "managerId"`
    );
    console.log(`Managers needing backfill: ${ids.length}`);

    for (const { managerId } of ids) {
      const mid = Number(managerId);
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT "name","role","orgLevel" FROM "User" WHERE "id" = $1 LIMIT 1`, mid
        );
        const tmpl = getManagerReportFormat(rows[0] ?? {});
        const w = await prisma.$executeRawUnsafe(
          `UPDATE "WeeklyReport"  SET "reportTemplate" = $1 WHERE "managerId" = $2 AND "reportTemplate" IS NULL`, tmpl, mid
        );
        const m = await prisma.$executeRawUnsafe(
          `UPDATE "MonthlyReport" SET "reportTemplate" = $1 WHERE "managerId" = $2 AND "reportTemplate" IS NULL`, tmpl, mid
        );
        summary[tmpl] = (summary[tmpl] ?? 0) + Number(w) + Number(m);
        managersDone++;
        console.log(`  manager #${mid} (${rows[0]?.name ?? "?"}) -> ${tmpl}  [weekly:${w} monthly:${m}]`);
      } catch (e) {
        failures++;
        console.error(`  manager #${mid} FAILED: ${e.message.split("\n")[0]}`);
      }
    }

    const remaining = await prisma.$queryRawUnsafe(
      `SELECT (SELECT count(*)::int FROM "WeeklyReport" WHERE "reportTemplate" IS NULL) AS w,
              (SELECT count(*)::int FROM "MonthlyReport" WHERE "reportTemplate" IS NULL) AS m`
    );
    console.log("---");
    console.log("Rows stamped by template:", JSON.stringify(summary));
    console.log(`Managers done: ${managersDone}, failures: ${failures}`);
    console.log(`Remaining NULL -> weekly: ${remaining[0].w}, monthly: ${remaining[0].m}`);
  } catch (e) {
    console.error("FATAL:", e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
