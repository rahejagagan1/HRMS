// Monthly Survey fanout. Sends a deeper engagement survey (eNPS +
// Likert + open text) to every active employee. Triggered from the
// HR Dashboard's "Send Monthly Survey now" button — no cron, since
// HR usually wants to control exactly when this goes out (e.g. last
// working day of the month, after the all-hands meeting).
//
// Unlike the Weekly Pulse, the Monthly Survey does NOT block clock-
// out. It's a bigger ask (3-5 minutes); blocking it would create
// resentment. The fanout email + notification both say so clearly.

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { getMonthKey, prettyMonth } from "@/lib/hr/pulse-week";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://studio.nbmedia.co.in";

export type MonthlyFanoutResult = {
  monthKey:      string;
  monthLabel:    string;
  recipients:    number;
  emailsSent:    number;
  emailsFailed:  number;
  notifications: number;
  questions:     number;
};

export async function fanoutMonthlySurvey(now: Date = new Date()): Promise<MonthlyFanoutResult> {
  const monthKey   = getMonthKey(now);
  const monthLabel = prettyMonth(monthKey);

  // Strict brand separation — split questions by brand. Each
  // employee receives ONLY their brand's questions.
  type Q = { id: number; order: number; text: string; type: string; brand: string };
  const allQuestions = await prisma.$queryRawUnsafe<Q[]>(
    `SELECT id, "order", text, type, brand
       FROM "PulseQuestion"
      WHERE "surveyType" = 'monthly' AND "isActive" = true
      ORDER BY "order" ASC`,
  );
  const nbQs = allQuestions.filter((q) => q.brand === "NB Media");
  const ytQs = allQuestions.filter((q) => q.brand === "YT Labs");
  const questionsForBrand = (brand: string | null): Q[] =>
    brand === "NB Media" ? nbQs :
    brand === "YT Labs"  ? ytQs :
    [];

  // Active employees with real emails + their businessUnit.
  let employees: Array<{ id: number; name: string; email: string; businessUnit: string | null }>;
  try {
    employees = await prisma.$queryRawUnsafe(
      `SELECT u.id, u.name, u.email, ep."businessUnit"
         FROM "User" u
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE u."isActive" = true AND u.email IS NOT NULL AND u.email <> ''
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
          WHERE u."isActive" = true AND u.email IS NOT NULL AND u.email <> ''
          ORDER BY u.id ASC`,
      );
    } else { throw e; }
  }

  // Strict brand separation — skip users with no businessUnit
  // AND skip users whose brand has 0 active questions this cycle.
  employees = employees.filter((e) =>
    (e.businessUnit === "NB Media" && nbQs.length > 0) ||
    (e.businessUnit === "YT Labs"  && ytQs.length > 0)
  );

  if (employees.length === 0 || allQuestions.length === 0) {
    return {
      monthKey, monthLabel,
      recipients: employees.length,
      emailsSent: 0, emailsFailed: 0, notifications: 0,
      questions: allQuestions.length,
    };
  }

  // ── Idempotency guard ──────────────────────────────────────
  // The cron line `0 5 1-7 * 1` (Vixie OR semantics) fires ~10
  // times in the first week of every month. isFirstMondayOfMonth
  // in the route handler catches 9 of those. But cron retries or
  // a force-fire after the scheduled one could still trigger
  // a double fanout. Cheap defence: look for any pulse_monthly
  // notification stamped in the last 48 hours — if any exists
  // for this entityId=0 (monthly entityId), skip.
  try {
    const recent = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "Notification"
        WHERE type = 'pulse_monthly'
          AND "createdAt" > now() - interval '48 hours'`,
    );
    if ((recent[0]?.n ?? 0) > 0) {
      console.warn(`[monthly-pulse-fanout] skipping — found ${recent[0].n} pulse_monthly notifications in last 48h (idempotent skip)`);
      return {
        monthKey, monthLabel,
        recipients: employees.length,
        emailsSent: 0, emailsFailed: 0, notifications: 0,
        questions: allQuestions.length,
      };
    }
  } catch (e: any) {
    console.warn("[monthly-pulse-fanout] idempotency check failed, proceeding anyway:", e?.message ?? e);
  }

  const surveyUrl = `${APP_URL}/dashboard/hr/pulse/monthly`;
  const subject   = `📋 ${monthLabel} engagement survey — your voice helps shape the team`;

  // ── In-app notifications ──────────────────────────────────────
  let notifications = 0;
  try {
    // 6 params per employee now — linkUrl makes the in-app
    // notification clickable (opens the monthly survey form).
    const values = employees
      .map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6}, NOW())`)
      .join(",\n");
    const params: any[] = [];
    for (const e of employees) {
      params.push(
        e.id,
        "pulse_monthly",
        0,
        `${monthLabel} Engagement Survey`,
        `Help us improve — 6 quick questions, fully anonymous, ~3 minutes. (Clock-out is NOT blocked for this one.)`,
        "/dashboard/hr/pulse/monthly",
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
    console.error("[monthly-pulse-fanout] notification insert failed:", e?.message ?? e);
  }

  // ── Emails ─────────────────────────────────────────────────────
  // Two precomputed HTML variants — strict brand separation.
  const variantBySlug = {
    "NB Media": buildEmailHtml({ monthLabel, questions: questionsForBrand("NB Media"), surveyUrl }),
    "YT Labs":  buildEmailHtml({ monthLabel, questions: questionsForBrand("YT Labs"),  surveyUrl }),
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
        const personalText = personalised.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        await sendEmail({
          to: emp.email,
          content: { subject, html: personalised, text: personalText } as any,
        });
        emailsSent++;
      } catch (e: any) {
        emailsFailed++;
        console.warn(`[monthly-pulse-fanout] email to ${emp.email} failed:`, e?.message ?? e);
      }
    }));
    if (i + BATCH_SIZE < employees.length) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  return {
    monthKey, monthLabel,
    recipients: employees.length,
    emailsSent, emailsFailed, notifications,
    questions: allQuestions.length,
  };
}

function firstNameOf(fullName: string): string {
  return fullName.split(/\s+/)[0] || "there";
}

function buildEmailHtml({
  monthLabel, questions, surveyUrl,
}: {
  monthLabel: string;
  questions: Array<{ id: number; order: number; text: string; type: string }>;
  surveyUrl: string;
}): string {
  const questionList = questions
    .map((q) => `<li style="margin-bottom:6px; color:#475569; font-size:13px;">${escapeHtml(q.text)}</li>`)
    .join("");

  return `<!doctype html>
<html><body style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color:#1f2937; background:#f8fafc; margin:0; padding:20px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
    <div style="padding:24px 28px;">
      <p style="font-size:14px; margin:0 0 12px 0;">Hi {{FirstName}},</p>

      <p style="font-size:14px; line-height:1.6; margin:0 0 16px 0;">
        It's that time of the month — your <strong>${escapeHtml(monthLabel)}</strong> engagement check. About 3 minutes of your time, and your answers shape how we run the team.
      </p>

      <div style="background:#f1f5f9; border-radius:10px; padding:14px 18px; margin:18px 0;">
        <p style="font-size:11px; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; color:#64748b; margin:0 0 8px 0;">What we'll ask</p>
        <ol style="margin:0; padding-left:18px;">${questionList}</ol>
      </div>

      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:12px 16px; margin:18px 0;">
        <p style="font-size:13px; font-weight:600; color:#1e3a8a; margin:0 0 4px 0;">🔒 Your responses are anonymous</p>
        <p style="font-size:12.5px; color:#1e3a8a; line-height:1.55; margin:0;">
          HR sees aggregated scores and anonymous comments only — never who said what. Be honest; this is how we get better.
        </p>
      </div>

      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:12px 16px; margin:18px 0;">
        <p style="font-size:13px; font-weight:600; color:#166534; margin:0 0 4px 0;">✅ No clock-out lock</p>
        <p style="font-size:12.5px; color:#166534; line-height:1.55; margin:0;">
          Unlike the weekly pulse, this one doesn't block your end-of-day. Take it whenever this week works for you.
        </p>
      </div>

      <div style="text-align:center; margin:24px 0;">
        <a href="${escapeHtml(surveyUrl)}" style="display:inline-block; background:#008CFF; color:#ffffff; text-decoration:none; padding:11px 22px; border-radius:8px; font-size:13.5px; font-weight:600;">
          Take the ${escapeHtml(monthLabel)} survey →
        </a>
      </div>
    </div>

    <div style="background:#f8fafc; border-top:1px solid #e2e8f0; padding:14px 28px;">
      <p style="font-size:11.5px; color:#94a3b8; margin:0;">
        Sent on demand by HR. Reply for questions, or ping HR directly on Slack.
      </p>
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
