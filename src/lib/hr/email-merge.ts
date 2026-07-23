// Resolves merge tags in an EmailTemplate at send time. The resolver
// is the single source of truth for which tags exist and how they map
// to real DB rows — every send path (manual click, auto-send on stage
// change, scheduled cron) funnels through here so the rendered output
// is always consistent.
//
// Usage:
//   import { resolveTemplate } from "@/lib/hr/email-merge";
//   const { subject, bodyHtml, to } = await resolveTemplate({
//     templateId,
//     applicationId,
//     interviewId,          // optional, for interview emails
//     offerLetterId,        // optional, for offer emails
//     referrerUserId,       // optional, for referral emails
//     overrides,            // optional, HR-edited values from the UI
//   });
//
// All values are HTML-encoded except for URLs which are inserted into
// href attributes (the template already provides the href).

import prisma from "@/lib/prisma";

type Context = {
  templateId: number;
  applicationId?: number;
  interviewId?: number;
  offerLetterId?: number;
  /** When sending the referral template — the new hire's userId. */
  newHireUserId?: number;
  /** Last-minute HR edits from the preview pane. */
  overrides?: Partial<Record<string, string>>;
};

type Resolved = {
  subject: string;
  bodyHtml: string;
  to: string | null;
  templateKey: string;
};

const BRAND_NAME: Record<string, string> = {
  nb_media: "NB Media",
  yt_labs:  "YT Labs",
};

/** Escape a value before substituting into HTML text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format a Date into "DD Mon YYYY" (en-IN). */
function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Format a Date into "HH:MM AM/PM". */
function fmtTime(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

/** Apply `{{tag}}` substitution across subject + body. */
function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const v = vars[name];
    return v == null ? "" : v;
  });
}

/** Pre-migration soft-fail — same pattern used across the hiring API
 *  surfaces. Returns the fallback when Postgres reports the table /
 *  column doesn't exist (42P01 / 42703) instead of bubbling up a 500. */
async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    const code = e?.meta?.code || e?.code;
    const msg = String(e?.meta?.message || e?.message || "");
    if (code === "42P01" || code === "42703" || /does not exist/i.test(msg)) return fallback;
    throw e;
  }
}

/** Public — fetch + resolve a template against real DB rows. */
export async function resolveTemplate(ctx: Context): Promise<Resolved> {
  // 1. Load the template row. Soft-fail returns null on missing
  // table — we treat that as "template not found" with a clear error.
  const tRows = await safeQuery(
    () => prisma.$queryRawUnsafe<any[]>(
      `SELECT id, key, name, "subject", "bodyHtml", "links", "deadlineHours"
         FROM "EmailTemplate" WHERE "id" = $1`,
      ctx.templateId,
    ),
    [] as any[],
  );
  const t = tRows[0];
  if (!t) throw new Error(`Template ${ctx.templateId} not found (or EmailTemplate table not migrated yet)`);

  // 2. Build the substitution bag. Order matters — later writes win,
  // so default → DB → overrides.
  const vars: Record<string, string> = {};

  // 2a. Static defaults
  vars.company = "NB Media";
  vars.hr_email = "hr@nbmediaproductions.com";

  // 2b. Template-stored links (assignment_link, drive_folder, etc.)
  if (t.links && typeof t.links === "object") {
    for (const [k, v] of Object.entries(t.links)) {
      vars[k] = String(v ?? "");
    }
  }

  // 2c. Default time-sensitive deadline (now + deadlineHours).
  if (t.deadlineHours) {
    const deadline = new Date(Date.now() + Number(t.deadlineHours) * 3600_000);
    vars.submission_deadline = fmtDate(deadline);
    vars.response_deadline   = fmtDate(deadline);
    vars.deadline            = fmtDate(deadline);
  }

  // 2d. Candidate / job context. Soft-fail returns [] when the
  // hiringManagerId / brand columns aren't migrated yet — we then
  // retry with the legacy shape so candidate_name / job_title still
  // resolve.
  let candidateEmail: string | null = null;
  if (ctx.applicationId) {
    let aRows = await safeQuery(
      () => prisma.$queryRawUnsafe<any[]>(
        `SELECT a."fullName", a."email", a."phone",
                o."title" AS "jobTitle", o."brand" AS "brand", o."location" AS "jobLocation",
                o."department", o."employmentType",
                hm."name" AS "hiringManagerName"
           FROM "JobApplication" a
           JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
           LEFT JOIN "User" hm ON hm."id" = o."hiringManagerId"
          WHERE a."id" = $1`,
        ctx.applicationId,
      ),
      null as any,
    );
    if (aRows === null) {
      aRows = await safeQuery(
        () => prisma.$queryRawUnsafe<any[]>(
          `SELECT a."fullName", a."email", a."phone",
                  o."title" AS "jobTitle", NULL AS "brand", o."location" AS "jobLocation",
                  o."department", NULL AS "employmentType",
                  NULL AS "hiringManagerName"
             FROM "JobApplication" a
             JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
            WHERE a."id" = $1`,
          ctx.applicationId,
        ),
        [],
      );
    }
    const a = aRows[0];
    if (a) {
      vars.candidate_name = String(a.fullName ?? "");
      vars.candidate_email = String(a.email ?? "");
      vars.candidate_phone = String(a.phone ?? "");
      vars.job_title      = String(a.jobTitle ?? "");
      vars.department     = String(a.department ?? "");
      vars.employment_type = String(a.employmentType ?? "");
      vars.job_location   = String(a.jobLocation ?? "");
      vars.hiring_manager = String(a.hiringManagerName ?? "");
      vars.company = BRAND_NAME[String(a.brand ?? "nb_media")] || "NB Media";
      candidateEmail = a.email ?? null;
    }
  }

  // 2e. Interview context.
  if (ctx.interviewId) {
    const iRows = await safeQuery(
      () => prisma.$queryRawUnsafe<any[]>(
        `SELECT i."title", i."scheduledAt", i."durationMinutes", i."location",
                COALESCE(string_agg(u."name", ', '), '') AS "panelNames"
           FROM "Interview" i
           LEFT JOIN "InterviewPanelist" ip ON ip."interviewId" = i."id"
           LEFT JOIN "User" u ON u."id" = ip."userId"
          WHERE i."id" = $1
          GROUP BY i."id"`,
        ctx.interviewId,
      ),
      [] as any[],
    );
    const iv = iRows[0];
    if (iv) {
      const when = iv.scheduledAt ? new Date(iv.scheduledAt) : null;
      vars.interview_title    = String(iv.title ?? "");
      vars.interview_date     = fmtDate(when);
      vars.interview_time     = fmtTime(when);
      vars.interview_duration = String(iv.durationMinutes ?? 45);
      vars.interview_location = String(iv.location ?? "Google Meet");
      vars.meeting_link       = String(iv.location ?? "");
      vars.interviewer_names  = String(iv.panelNames ?? "");
    }
  }

  // 2f. Offer letter context.
  if (ctx.offerLetterId) {
    const oRows = await safeQuery(
      () => prisma.$queryRawUnsafe<any[]>(
        `SELECT "ctcAnnual", "joiningDate", "expiresAt"
           FROM "OfferLetter" WHERE "id" = $1`,
        ctx.offerLetterId,
      ),
      [] as any[],
    );
    const o = oRows[0];
    if (o) {
      if (o.ctcAnnual != null) {
        vars.ctc = `₹${Number(o.ctcAnnual).toLocaleString("en-IN")}`;
      }
      vars.joining_date      = fmtDate(o.joiningDate);
      vars.response_deadline = fmtDate(o.expiresAt) || vars.response_deadline || "";
    }
  }

  // 2g. Referral context (new hire join → notify referrer). The
  // referredById column may not exist pre-migration; fall back to
  // just the new-hire's name/email if that's the case.
  if (ctx.newHireUserId) {
    let uRows = await safeQuery(
      () => prisma.$queryRawUnsafe<any[]>(
        `SELECT u."id", u."name", u."email",
                ref."id" AS "refId", ref."name" AS "refName", ref."email" AS "refEmail"
           FROM "User" u
           LEFT JOIN "User" ref ON ref."id" = (
             SELECT a."referredById" FROM "JobApplication" a
              WHERE a."email" = u."email" AND a."referredById" IS NOT NULL
              ORDER BY a."createdAt" DESC LIMIT 1
           )
          WHERE u."id" = $1`,
        ctx.newHireUserId,
      ),
      null as any,
    );
    if (uRows === null) {
      uRows = await safeQuery(
        () => prisma.$queryRawUnsafe<any[]>(
          `SELECT u."id", u."name", u."email",
                  NULL AS "refId", NULL AS "refName", NULL AS "refEmail"
             FROM "User" u WHERE u."id" = $1`,
          ctx.newHireUserId,
        ),
        [],
      );
    }
    const u = uRows[0];
    if (u) {
      vars.employee_name      = String(u.name ?? "");
      vars.employee_email     = String(u.email ?? "");
      vars.referred_candidate = String(u.name ?? "");
      vars.referrer_name      = String(u.refName ?? "");
      candidateEmail          = candidateEmail || u.refEmail || null;
    }
  }

  // 2h. HR overrides from the Send preview UI — last writers win.
  if (ctx.overrides) {
    for (const [k, v] of Object.entries(ctx.overrides)) {
      if (v != null) vars[k] = String(v);
    }
  }

  // 3. Encode + substitute.
  //
  // SECURITY: Every value goes through escapeHtml() regardless of
  // whether it "looks like" a URL. The earlier implementation
  // short-circuited http(s)-prefixed values to pass through raw — but
  // a stored value of the form
  //     `https://evil.com" onerror="alert(1)`
  // would also start with `https://` and therefore bypass escaping,
  // injecting into the href attribute. Always escaping is the safe
  // default; `&amp;` inside an href is valid HTML and browsers
  // un-encode it when resolving the URL, so legitimate URLs still
  // work correctly (no broken links from escaping).
  //
  // For URL-typed merge tags we additionally call validateUrl() to
  // reject anything that isn't a well-formed http(s) URL (blocks
  // javascript:, data:, vbscript:, etc.).
  const validated = validateUrlBag(vars);
  const escaped = escapedBag(validated);
  const subject  = substitute(t.subject, escaped);
  const bodyHtml = substitute(t.bodyHtml, escaped);

  return {
    subject,
    bodyHtml,
    to:       candidateEmail,
    templateKey: String(t.key),
  };
}

/** Escape every value for HTML-text + attribute context. */
function escapedBag(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = escapeHtml(v ?? "");
  return out;
}

/** URL-shaped merge tags (`*_link`, `*_folder`, `reference_*`,
 *  `meeting_link`) must round-trip through the WHATWG URL parser. If
 *  the value isn't a well-formed http(s) URL, blank it out — better a
 *  missing link than an injection vector. Non-URL values pass through
 *  untouched (still HTML-escaped by escapedBag downstream). */
function validateUrlBag(vars: Record<string, string>): Record<string, string> {
  const URL_KEY_RE = /(_link|_folder|reference_\d+|meeting_link)$/i;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (!URL_KEY_RE.test(k)) { out[k] = v; continue; }
    const raw = (v ?? "").trim();
    if (!raw) { out[k] = ""; continue; }
    try {
      const u = new URL(raw);
      // Only allow http(s) — blocks javascript:, data:, file:, vbscript:.
      if (u.protocol === "http:" || u.protocol === "https:") {
        out[k] = u.toString();
      } else {
        out[k] = "";
      }
    } catch {
      out[k] = "";
    }
  }
  return out;
}
