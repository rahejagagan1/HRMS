// Weekly Pulse fanout — fires every Friday 10:30 IST from the cron
// endpoint at /api/cron/pulse/send-weekly. Sends an email + creates
// an in-app Notification for every active employee, with a clear
// note that clock-out is blocked until they submit.

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { getActiveWeekNumber, getWeekKey } from "@/lib/hr/pulse-week";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://studio.nbmedia.co.in";

const WEEK_THEMES: Record<number, string> = {
  1: "Mood & Wellbeing",
  2: "Manager & Team",
  3: "Workload & Resources",
  4: "Growth & Engagement",
};

export type PulseFanoutResult = {
  weekKey:      string;
  activeWeek:   number;
  recipients:   number;
  emailsSent:   number;
  emailsFailed: number;
  notifications: number;
  questions:    number;
};

export async function fanoutWeeklyPulse(now: Date = new Date()): Promise<PulseFanoutResult> {
  const weekKey    = getWeekKey(now);
  const activeWeek = getActiveWeekNumber(now);

  // Strict brand separation — each brand has its own independent
  // question bank. No shared layer.
  type Q = { id: number; order: number; text: string; type: string; brand: string };
  const allQuestions = await prisma.$queryRawUnsafe<Q[]>(
    `SELECT id, "order", text, type, brand
       FROM "PulseQuestion"
      WHERE "surveyType" = 'weekly' AND week = $1 AND "isActive" = true
      ORDER BY "order" ASC`,
    activeWeek,
  );
  const nbQs = allQuestions.filter((q) => q.brand === "NB Media");
  const ytQs = allQuestions.filter((q) => q.brand === "YT Labs");
  const questionsForBrand = (brand: string | null): Q[] =>
    brand === "NB Media" ? nbQs :
    brand === "YT Labs"  ? ytQs :
    [];  // no brand → no questions (dev/sandbox accounts skip)

  // Every active employee with a real email + their businessUnit.
  // Devs skipped on envs where the isDeveloper column is present —
  // fallback to "all active employees" on legacy DBs without the
  // column so the fanout still works.
  let employees: Array<{ id: number; name: string; email: string; businessUnit: string | null }>;
  try {
    employees = await prisma.$queryRawUnsafe(
      `SELECT u.id, u.name, u.email, ep."businessUnit"
         FROM "User" u
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE u."isActive" = true
          AND u.email IS NOT NULL AND u.email <> ''
          AND COALESCE(u."isDeveloper", false) = false
        ORDER BY u.id ASC`,
    );
  } catch (e: any) {
    const code = e?.meta?.code || e?.code;
    if (code === "42703" || /isDeveloper/.test(String(e?.message ?? ""))) {
      employees = await prisma.$queryRawUnsafe(
        `SELECT u.id, u.name, u.email, ep."businessUnit"
           FROM "User" u
           LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
          WHERE u."isActive" = true
            AND u.email IS NOT NULL AND u.email <> ''
          ORDER BY u.id ASC`,
      );
    } else { throw e; }
  }

  // Strict brand separation — employees without a businessUnit
  // on their profile can't be served a question set. Skip them
  // entirely so they don't get an email with no content. ALSO
  // skip employees whose brand has 0 active questions this cycle —
  // sending an empty <ol></ol> would look broken.
  employees = employees.filter((e) =>
    (e.businessUnit === "NB Media" && nbQs.length > 0) ||
    (e.businessUnit === "YT Labs"  && ytQs.length > 0)
  );

  if (employees.length === 0 || allQuestions.length === 0) {
    return {
      weekKey, activeWeek,
      recipients: employees.length, emailsSent: 0, emailsFailed: 0,
      notifications: 0, questions: allQuestions.length,
    };
  }

  // ── Idempotency guard ──────────────────────────────────────
  // If a previous fanout for this weekKey already ran (e.g. a
  // cron retry on transient network failure, or HR force-firing
  // after the scheduled cron), don't double-send. Detect by
  // looking for any pulse_weekly Notification row stamped with
  // the active week's entityId in the last 36 hours — that
  // covers same-day retries without false-positiving on a fresh
  // weekly cycle next Friday.
  try {
    const recent = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "Notification"
        WHERE type = 'pulse_weekly'
          AND "entityId" = $1
          AND "createdAt" > now() - interval '36 hours'`,
      activeWeek,
    );
    if ((recent[0]?.n ?? 0) > 0) {
      console.warn(`[pulse-fanout] skipping — found ${recent[0].n} pulse_weekly notifications for week ${activeWeek} in last 36h (idempotent skip)`);
      return {
        weekKey, activeWeek,
        recipients: employees.length, emailsSent: 0, emailsFailed: 0,
        notifications: 0, questions: allQuestions.length,
      };
    }
  } catch (e: any) {
    console.warn("[pulse-fanout] idempotency check failed, proceeding anyway:", e?.message ?? e);
  }

  const pulseUrl    = `${APP_URL}/dashboard/hr/pulse`;
  const theme       = WEEK_THEMES[activeWeek] ?? `Week ${activeWeek}`;
  const subject     = `📊 ${theme} — this week's Pulse (clock-out blocked until done)`;

  // ── In-app notifications — single bulk insert ──────────────
  let notifications = 0;
  try {
    // 6 params per employee now — linkUrl makes the in-app
    // notification clickable (opens the weekly pulse form).
    const values = employees
      .map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6}, NOW())`)
      .join(",\n");
    const params: any[] = [];
    for (const e of employees) {
      params.push(
        e.id,
        "pulse_weekly",
        activeWeek,
        `Pulse: ${theme} — Week ${activeWeek}`,
        `Take 30 seconds to share how your week is going. ⚠ You won't be able to clock out today until this is submitted.`,
        "/dashboard/hr/pulse",
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Notification"
         ("userId", "type", "entityId", "title", "body", "linkUrl", "createdAt")
       VALUES ${values}`,
      ...params,
    );
    notifications = employees.length;
  } catch (e: any) {
    console.error("[pulse-fanout] notification insert failed:", e?.message ?? e);
  }

  // ── Emails — batched 25/wave with 250 ms gap ──────────────────
  // Two precomputed HTML variants (NB Media / YT Labs) — strict
  // brand separation means no "shared" middle ground. Each
  // employee gets the variant matching their businessUnit.
  const variantBySlug = {
    "NB Media": buildEmailHtml({ activeWeek, theme, questions: questionsForBrand("NB Media"), pulseUrl }),
    "YT Labs":  buildEmailHtml({ activeWeek, theme, questions: questionsForBrand("YT Labs"),  pulseUrl }),
  };
  let emailsSent = 0, emailsFailed = 0;
  const BATCH_SIZE = 25;
  const PAUSE_MS   = 250;
  for (let i = 0; i < employees.length; i += BATCH_SIZE) {
    const wave = employees.slice(i, i + BATCH_SIZE);
    await Promise.all(wave.map(async (emp) => {
      try {
        const variant = emp.businessUnit === "YT Labs"
          ? variantBySlug["YT Labs"]
          : variantBySlug["NB Media"];
        const personalised = variant.replace(/\{\{FirstName\}\}/g, firstNameOf(emp.name));
        const text = htmlToText(personalised);
        await sendEmail({
          to: emp.email,
          content: { subject, html: personalised, text } as any,
        });
        emailsSent++;
      } catch (e: any) {
        emailsFailed++;
        console.warn(`[pulse-fanout] email to ${emp.email} failed:`, e?.message ?? e);
      }
    }));
    if (i + BATCH_SIZE < employees.length) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  return {
    weekKey, activeWeek,
    recipients: employees.length,
    emailsSent, emailsFailed, notifications,
    questions: allQuestions.length,
  };
}

function firstNameOf(fullName: string): string {
  return fullName.split(/\s+/)[0] || "there";
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function buildEmailHtml({
  activeWeek, theme, questions, pulseUrl,
}: {
  activeWeek: number;
  theme: string;
  questions: Array<{ id: number; order: number; text: string; type: string }>;
  pulseUrl: string;
}): string {
  // Render the 5 questions as a compact preview list so employees
  // know what they're walking into when they click the CTA.
  const questionList = questions
    .map((q) => `<li style="margin-bottom:6px; color:#475569; font-size:13px;">${escapeHtml(q.text)}</li>`)
    .join("");

  return `<!doctype html>
<html><body style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color:#1f2937; background:#f8fafc; margin:0; padding:20px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
    <div style="padding:24px 28px;">
      <p style="font-size:14px; margin:0 0 12px 0;">Hi {{FirstName}},</p>

      <p style="font-size:14px; line-height:1.6; margin:0 0 16px 0;">
        It's Pulse Friday. Take <strong>30 seconds</strong> to share how your week went so we can keep improving where it matters.
      </p>

      <div style="background:#f1f5f9; border-radius:10px; padding:14px 18px; margin:18px 0;">
        <p style="font-size:11px; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; color:#64748b; margin:0 0 6px 0;">This week — Week ${activeWeek}</p>
        <p style="font-size:15px; font-weight:600; color:#0f172a; margin:0 0 10px 0;">${escapeHtml(theme)}</p>
        <ol style="margin:0; padding-left:18px;">${questionList}</ol>
      </div>

      <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:12px 16px; margin:18px 0;">
        <p style="font-size:13px; font-weight:600; color:#92400e; margin:0 0 4px 0;">⚠ Clock-out is blocked until you submit</p>
        <p style="font-size:12.5px; color:#92400e; line-height:1.55; margin:0;">
          You can clock out as usual today only AFTER submitting this week's pulse. The lock turns on at 10:30 AM IST (when this email goes out) and lifts the moment your response lands.
        </p>
      </div>

      <div style="text-align:center; margin:24px 0;">
        <a href="${escapeHtml(pulseUrl)}" style="display:inline-block; background:#008CFF; color:#ffffff; text-decoration:none; padding:11px 22px; border-radius:8px; font-size:13.5px; font-weight:600;">
          Submit this week's Pulse →
        </a>
      </div>

      <p style="font-size:12px; color:#64748b; line-height:1.55; margin:0;">
        Why we do this: a quick weekly check beats a once-a-year survey. Each response feeds the team-level engagement view HR shares with leadership.
      </p>
    </div>

    <div style="background:#f8fafc; border-top:1px solid #e2e8f0; padding:14px 28px;">
      <p style="font-size:11.5px; color:#94a3b8; margin:0;">
        Sent automatically every Friday at 10:30 IST. Reply for questions, or ping HR directly on Slack.
      </p>
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
