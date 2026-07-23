// Template-keyed raw-SQL read/write for weekly + monthly reports.
//
// Raw SQL (not the typed client) because the generated Prisma client doesn't yet
// know the `reportTemplate` column — it was added in the designation-report-
// template migration and the client can't be regenerated while the dev server
// holds the engine lock. Same "raw so it works before the client is regenerated"
// pattern already used in reports/[managerId]/route.ts.
//
// A report's identity is (managerId, reportTemplate, period). Back-compat: when
// `template` is omitted, match by period only (legacy single-row behaviour) so
// old URLs keep resolving the backfilled row.

import prisma from "@/lib/prisma";

export type ReportTable = "WeeklyReport" | "MonthlyReport";

const KEY_COLS: Record<ReportTable, string[]> = {
  WeeklyReport: ["managerId", "reportTemplate", "week", "month", "year"],
  MonthlyReport: ["managerId", "reportTemplate", "month", "year"],
};

export const WEEKLY_JSONB = new Set([
  "writerRows", "editorRows", "researcherRows", "overviewRows", "viewsRows", "shortsRows",
]);
export const MONTHLY_JSONB = new Set([
  "editorNotes", "writerNotes", "editorExtraCases", "writerExtraCases",
  "nishantResearcherRows", "nishantOverview",
  "andrewA1Rows", "andrewA2Rows", "andrewBRows", "andrewCRows", "andrewDRows", "andrewERows",
  "hrMonthlyData",
]);

type Period = { week?: number; month: number; year: number };

function periodWhere(template: string | null | undefined, period: Period): { sql: string; args: unknown[] } {
  const where = [`"managerId" = $1`];
  const args: unknown[] = [];
  // $1 is managerId, filled by the caller (prepended).
  if (template != null) { args.push(template); where.push(`"reportTemplate" = $${args.length + 1}`); }
  if (period.week != null) { args.push(period.week); where.push(`"week" = $${args.length + 1}`); }
  args.push(period.month); where.push(`"month" = $${args.length + 1}`);
  args.push(period.year); where.push(`"year" = $${args.length + 1}`);
  return { sql: where.join(" AND "), args };
}

/** Find one report row by manager + template + period (template optional →
 *  legacy match by period, newest first). Returns the raw row or null. Column
 *  names match the DB exactly (e.g. row.writerRows, row.isLocked). */
export async function findReportRow(
  table: ReportTable,
  managerId: number,
  template: string | null | undefined,
  period: Period
): Promise<Record<string, any> | null> {
  const { sql, args } = periodWhere(template, period);
  const rows = await prisma.$queryRawUnsafe<Record<string, any>[]>(
    `SELECT * FROM "${table}" WHERE ${sql} ORDER BY "id" DESC LIMIT 1`,
    managerId, ...args
  );
  return rows[0] ?? null;
}

/** Upsert keyed by (managerId, reportTemplate, period). `values` = the non-key
 *  columns to set; OMIT a column to leave it at its DB default on insert /
 *  unchanged on update (used for submittedAt on drafts). jsonbCols get
 *  JSON.stringify + ::jsonb. Always sets updatedAt. Returns the row id. */
export async function upsertReportRow(
  table: ReportTable,
  key: { managerId: number; reportTemplate: string; week?: number; month: number; year: number },
  values: Record<string, unknown>,
  jsonbCols: Set<string>
): Promise<number> {
  const keyCols = KEY_COLS[table];
  const keyObj: Record<string, unknown> = {
    managerId: key.managerId, reportTemplate: key.reportTemplate, month: key.month, year: key.year,
  };
  if (table === "WeeklyReport") keyObj.week = key.week;

  const cols = [...keyCols, ...Object.keys(values)];
  const params: unknown[] = [];
  const placeholders = cols.map((c) => {
    const v = c in keyObj ? keyObj[c] : values[c];
    if (jsonbCols.has(c)) { params.push(v == null ? null : JSON.stringify(v)); return `$${params.length}::jsonb`; }
    params.push(v ?? null); return `$${params.length}`;
  });
  const setClause = Object.keys(values)
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .concat(`"updatedAt" = NOW()`)
    .join(", ");
  const sql =
    `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}, "updatedAt") ` +
    `VALUES (${placeholders.join(", ")}, NOW()) ` +
    `ON CONFLICT (${keyCols.map((c) => `"${c}"`).join(", ")}) DO UPDATE SET ${setClause} ` +
    `RETURNING "id"`;
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(sql, ...params);
  return Number(rows[0].id);
}

/** Delete a report row by manager + template + period. Returns rows deleted. */
export async function deleteReportRow(
  table: ReportTable,
  managerId: number,
  template: string | null | undefined,
  period: Period
): Promise<number> {
  const { sql, args } = periodWhere(template, period);
  const n = await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE ${sql}`, managerId, ...args);
  return Number(n);
}
