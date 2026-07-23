// Resume auto-backfill logic, shared between:
//   • /api/hr/hiring/candidates/[id] — runs synchronously when HR
//     opens the drawer for the first time, so the response carries
//     the populated fields (lazy / on-demand path)
//   • /api/jobs/apply              — fired in the background right
//     after the candidate submits, so HR's first drawer load is
//     instant (eager / proactive path)
//
// The two callers want the same patch semantics (merge skills,
// stale-heal education, fill nulls), so the rules live here once.
// If the eager path fails for any reason, the lazy path picks it
// up the next time the drawer opens — a single failure never
// leaves the row permanently un-extracted.

import prisma from "./prisma";
import { extractResumeData } from "./resume-auto-extract";

const KNOWN_LANGS = new Set([
  "english","hindi","punjabi","tamil","telugu","kannada","malayalam","marathi",
  "gujarati","bengali","odia","assamese","sanskrit","urdu",
]);

interface AppRow {
  id:                number;
  resumeBlob:        Buffer | null;
  resumeFileName:    string | null;
  linkedinUrl:       string | null;
  portfolioUrl:      string | null;
  skills:            string | null;
  educationDetails:  string | null;
}

/** Returns true when at least one parseable column is missing /
 *  could be improved — i.e. the row is worth running the extractor
 *  on. Cheap gate that lets us skip rows that already have
 *  everything HR cares about. */
export function needsBackfill(row: Pick<AppRow,
  "linkedinUrl" | "portfolioUrl" | "skills" | "educationDetails"
>): boolean {
  return !row.linkedinUrl || !row.portfolioUrl || !row.skills || !row.educationDetails;
}

/** Run the extractor against the row identified by `id`, compute
 *  the patch (skills merge, education stale-heal, URL fill), and
 *  write it. Soft-fails on any error so callers don't have to
 *  wrap.  Returns the patch that was written (empty object if
 *  nothing changed). */
export async function runResumeBackfill(id: number): Promise<Record<string, unknown>> {
  try {
    const row = (await prisma.$queryRawUnsafe<AppRow[]>(
      `SELECT id, "resumeBlob", "resumeFileName", "linkedinUrl", "portfolioUrl",
              skills, "educationDetails"
         FROM "JobApplication" WHERE id = $1`,
      id,
    ))[0];
    if (!row) return {};
    if (!row.resumeBlob) return {};
    if (!needsBackfill(row)) return {};

    const buf = Buffer.from(row.resumeBlob);
    const fileName = String(row.resumeFileName ?? "resume.pdf");
    const ext = await extractResumeData(buf, fileName);

    const existingSkillsHasLangs = typeof row.skills === "string" &&
      row.skills.split(/[,|;/]/).map((s) => s.trim().toLowerCase()).some((s) => KNOWN_LANGS.has(s));

    const patch: Record<string, unknown> = {};
    if (!row.linkedinUrl  && ext.linkedinUrl)  patch.linkedinUrl  = ext.linkedinUrl;
    if (!row.portfolioUrl && ext.portfolioUrl) patch.portfolioUrl = ext.portfolioUrl;

    // Skills: fill / overwrite stale / merge with manual entries.
    if (ext.skills.length > 0) {
      if (!row.skills) {
        patch.skills = ext.skills.join(", ");
      } else if (existingSkillsHasLangs) {
        patch.skills = ext.skills.join(", ");
      } else {
        const current = String(row.skills).split(/,\s*/).map((s) => s.trim()).filter(Boolean);
        const seen = new Set(current.map((s) => s.toLowerCase()));
        const merged = [...current];
        for (const s of ext.skills) {
          if (!seen.has(s.toLowerCase())) { merged.push(s); seen.add(s.toLowerCase()); }
        }
        if (merged.length > current.length) patch.skills = merged.join(", ");
      }
    }

    // Education: fill if empty, self-heal if all existing rows have empty course.
    if (ext.educations.length > 0) {
      let shouldWriteEdu = false;
      if (!row.educationDetails) {
        shouldWriteEdu = true;
      } else {
        try {
          const cur = JSON.parse(row.educationDetails);
          if (Array.isArray(cur) && cur.length > 0) {
            const allCourseless = cur.every((e: { course?: string }) =>
              !e?.course || String(e.course).trim() === "",
            );
            const newHasCourse = ext.educations.some((e) => e.course && e.course.trim() !== "");
            if (allCourseless && newHasCourse) shouldWriteEdu = true;
          }
        } catch { /* leave alone on parse error */ }
      }
      if (shouldWriteEdu) patch.educationDetails = JSON.stringify(ext.educations);
    }

    if (Object.keys(patch).length === 0) return {};

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      setClauses.push(`"${k}" = $${i}`);
      params.push(v);
      i++;
    }
    params.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE "JobApplication" SET ${setClauses.join(", ")} WHERE id = $${i}`,
      ...params,
    );
    return patch;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[resume-backfill] id=${id} failed:`, msg);
    return {};
  }
}

/** Fire-and-forget version. Schedules runResumeBackfill on the
 *  next tick so the HTTP response can be sent immediately.
 *  Survives in-process under PM2 (the worker stays alive after
 *  the response is flushed). Errors are swallowed + logged.
 *
 *  Use this from the apply route so candidates don't pay the
 *  1-2 second OCR cost on submit. The lazy on-drawer-open path
 *  in /api/hr/hiring/candidates/[id] remains as a fallback — if
 *  the background job dies before completing, HR opening the
 *  drawer still triggers the same logic. */
export function enqueueResumeBackfill(id: number): void {
  setImmediate(() => {
    runResumeBackfill(id).catch((e) => {
      console.error(`[resume-backfill] enqueued id=${id} crashed:`, e?.message ?? e);
    });
  });
}
