// Referral fanout — sends an email + in-app notification to
// every active employee announcing that HR has opened a new role
// for employee referrals. Fired from the job-publish endpoint
// when the "referral" channel is enabled on first publish.
//
// Volume guard: we batch emails 25 at a time with a small pause
// so the SMTP queue doesn't spike. Notifications go straight into
// the DB (single bulk insert).

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";

export type ReferralAnnouncement = {
  jobId:        number;
  jobTitle:     string;
  department:   string | null;
  businessUnit: string | null;
  publicSlug:   string | null;
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://studio.nbmedia.co.in";

export async function fanoutReferralAnnouncement(j: ReferralAnnouncement): Promise<void> {
  // Active employees only — pull everyone on the platform with a
  // valid work email. Skip developers and the system bot account
  // (no point pinging them about a hiring referral).
  const employees = await prisma.$queryRawUnsafe<Array<{ id: number; name: string; email: string }>>(
    `SELECT id, name, email FROM "User"
      WHERE "isActive" = true
        AND email IS NOT NULL AND email <> ''
        AND COALESCE("isDeveloper", false) = false
      ORDER BY id ASC`,
  );

  if (employees.length === 0) return;

  const jdUrl       = j.publicSlug ? `${APP_URL}/jobs/${j.publicSlug}` : `${APP_URL}/dashboard/hr/referrals`;
  const referralUrl = `${APP_URL}/dashboard/hr/referrals?job=${j.jobId}`;
  const brandLabel  = j.businessUnit ? ` at ${j.businessUnit}` : "";

  // ── In-app notifications — single bulk insert ──────────────
  // Type = "referral_open" so future filters (preferences,
  // mute, etc.) can group these. entityId = jobId so clicking
  // the notification deep-links to the right job.
  try {
    const values = employees
      .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, NOW())`)
      .join(",\n");
    const params: any[] = [];
    for (const e of employees) {
      params.push(
        e.id,
        "referral_open",
        j.jobId,
        `New referral opening — ${j.jobTitle}`,
        `We're hiring a ${j.jobTitle}${brandLabel}. Know someone who'd be a great fit? Refer them and earn a referral bonus.`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Notification"
         ("userId", "type", "entityId", "title", "body", "createdAt")
       VALUES ${values}`,
      ...params,
    );
  } catch (e: any) {
    console.error("[referral-fanout] notification insert failed:", e?.message ?? e);
  }

  // ── Emails — batch 25/wave with a 250 ms gap ────────────────
  const BATCH_SIZE = 25;
  const PAUSE_MS   = 250;
  const subject = `🎯 We're hiring — refer someone for ${j.jobTitle}${brandLabel}`;
  const html    = buildEmailHtml(j, jdUrl, referralUrl);

  for (let i = 0; i < employees.length; i += BATCH_SIZE) {
    const wave = employees.slice(i, i + BATCH_SIZE);
    await Promise.all(wave.map(async (emp) => {
      try {
        await sendEmail({
          to: emp.email,
          content: {
            subject,
            html: html.replace(/\{\{FirstName\}\}/g, firstNameOf(emp.name)),
            text: stripHtml(html.replace(/\{\{FirstName\}\}/g, firstNameOf(emp.name))),
          } as any,
        });
      } catch (e: any) {
        console.warn(`[referral-fanout] email to ${emp.email} failed:`, e?.message ?? e);
      }
    }));
    if (i + BATCH_SIZE < employees.length) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }
}

function firstNameOf(fullName: string): string {
  return fullName.split(/\s+/)[0] || "there";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function buildEmailHtml(
  j: ReferralAnnouncement,
  jdUrl: string,
  referralUrl: string,
): string {
  const dept     = j.department    ? `<span style="color:#64748b;"> · ${escapeHtml(j.department)}</span>` : "";
  const brandTag = j.businessUnit  ? `<span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; margin-left:6px;">${escapeHtml(j.businessUnit)}</span>` : "";
  return `<!doctype html>
<html><body style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color:#1f2937; background:#f8fafc; margin:0; padding:20px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
    <div style="padding:24px 28px;">
      <p style="font-size:14px; margin:0 0 12px 0;">Hi {{FirstName}},</p>

      <p style="font-size:14px; line-height:1.6; margin:0 0 16px 0;">
        We just opened a new role and we'd love your network's help.
      </p>

      <div style="background:#f1f5f9; border-radius:10px; padding:14px 18px; margin:18px 0;">
        <p style="font-size:15px; font-weight:600; color:#0f172a; margin:0;">${escapeHtml(j.jobTitle)}${brandTag}</p>
        <p style="font-size:12.5px; color:#64748b; margin:6px 0 0 0;">${dept ? dept.replace(/<[^>]+>/g, "") : ""}</p>
      </div>

      <p style="font-size:14px; line-height:1.6; margin:0 0 20px 0;">
        Know someone who'd be a great fit? Refer them through your dashboard and you'll earn a <strong>referral bonus</strong> once they're hired and clear probation.
      </p>

      <div style="text-align:center; margin:24px 0;">
        <a href="${escapeHtml(referralUrl)}" style="display:inline-block; background:#008CFF; color:#ffffff; text-decoration:none; padding:11px 22px; border-radius:8px; font-size:13.5px; font-weight:600;">
          Refer a candidate →
        </a>
      </div>

      <p style="font-size:13px; color:#475569; line-height:1.6; margin:0 0 6px 0;">Or, see the full job description:</p>
      <p style="font-size:13px; margin:0 0 24px 0;">
        <a href="${escapeHtml(jdUrl)}" style="color:#0369a1; text-decoration:underline;">${escapeHtml(jdUrl)}</a>
      </p>

      <div style="border-top:1px solid #e2e8f0; padding-top:16px; margin-top:8px;">
        <p style="font-size:12px; color:#64748b; line-height:1.55; margin:0 0 6px 0;">Why we open referrals first:</p>
        <ul style="font-size:12px; color:#64748b; line-height:1.55; margin:0 0 0 18px; padding:0;">
          <li>Our best hires come from team referrals</li>
          <li>Faster + higher signal than open postings</li>
          <li>You get a meaningful thank-you (paid after probation)</li>
        </ul>
      </div>
    </div>

    <div style="background:#f8fafc; border-top:1px solid #e2e8f0; padding:14px 28px;">
      <p style="font-size:11.5px; color:#94a3b8; margin:0;">
        Sent automatically because the role is open for employee referrals. Reply to this email for questions, or ping HR directly on Slack.
      </p>
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
