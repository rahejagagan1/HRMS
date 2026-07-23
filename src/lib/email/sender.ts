// High-level email sender. Always fire-and-forget — never throws, never
// blocks the API response. In dev / when SMTP isn't configured, logs to
// the console instead of sending so local testing doesn't spam real
// inboxes.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getMailer, emailSenderName, isDryRun } from "./transport";
import type { EmailContent } from "./templates";
import prisma from "@/lib/prisma";

// Read the logo once on first send; cached for the life of the process.
// Templates reference it via <img src="cid:logo">, so it ships as an
// inline attachment with every HTML email — no public URL fetch needed.
let cachedLogo: Buffer | null | undefined;
function getLogoAttachment() {
  if (cachedLogo === undefined) {
    try {
      const p = resolve(process.cwd(), "public", "logo.png");
      cachedLogo = existsSync(p) ? readFileSync(p) : null;
    } catch { cachedLogo = null; }
  }
  if (!cachedLogo) return undefined;
  return [{
    filename:    "logo.png",
    content:     cachedLogo,
    cid:         "logo",
    contentType: "image/png",
  }];
}

// Attachments uploaded by HR via the EmailComposer arrive here as base64
// strings. nodemailer accepts { filename, content (Buffer|base64 string),
// contentType, encoding } — we decode to Buffer to keep memory predictable.
export type UserAttachment = {
  filename: string;
  contentType?: string;
  contentBase64: string;
  // When set, the attachment is embedded inline and can be referenced
  // from the HTML body via <img src="cid:THIS_VALUE">. Same mechanism the
  // logo uses (cid:logo). Omit for a normal downloadable attachment.
  cid?: string;
};

export async function sendEmail(args: {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  content: EmailContent;
  attachments?: UserAttachment[];
}): Promise<void> {
  const recipients = Array.isArray(args.to) ? args.to : [args.to];
  const valid = recipients.filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (valid.length === 0) return;

  const transport = getMailer();
  if (isDryRun() || !transport) {
    console.log(`[email][dry-run] → ${valid.join(", ")}`);
    console.log(`              subject: ${args.content.subject}`);
    if (args.attachments?.length) {
      console.log(`              attachments: ${args.attachments.map((a) => a.filename).join(", ")}`);
    }
    return;
  }

  // Logo (inline CID) + any HR-provided attachments. Logo first so it
  // keeps its predictable cid:logo reference; user attachments follow.
  const logo = getLogoAttachment() ?? [];
  const userAttachments = (args.attachments ?? []).map((a) => ({
    filename:    a.filename,
    content:     Buffer.from(a.contentBase64, "base64"),
    contentType: a.contentType,
    ...(a.cid ? { cid: a.cid } : {}),   // inline image when a cid is given
  }));

  try {
    const info = await transport.sendMail({
      from:        emailSenderName(),
      to:          valid.join(", "),
      cc:          args.cc?.length  ? args.cc.join(", ")  : undefined,
      bcc:         args.bcc?.length ? args.bcc.join(", ") : undefined,
      subject:     args.content.subject,
      text:        args.content.text,
      html:        args.content.html,
      attachments: [...logo, ...userAttachments],
    });
    console.log(`[email] sent to ${valid.length} (${info.messageId})`);
  } catch (e) {
    console.error("[email] send failed:", e);
  }
}

/**
 * Resolve email addresses for a list of user ids — drops anyone without
 * an email or who's been deactivated. Single round-trip to the DB.
 */
export async function emailsForUserIds(userIds: number[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: { email: true },
  });
  return rows.map((r) => r.email).filter(Boolean);
}

/**
 * Resolve email addresses for a list of user ids, applying the per-role
 * email-toggle filter (Admin → Emails Automation → "Recipients by role").
 *
 * Each recipient is mapped to the set of email-routing roles they carry
 * (CEO / HR Manager / Special Access / Admin), then dropped if NONE of
 * their roles has the per-role toggle ON for `kind`. Users who don't
 * match any tracked role bypass the per-role filter entirely — they're
 * always allowed through (the per-role gate is opt-in for HR-leadership
 * accounts only).
 *
 * `exemptUserIds` is the direct-manager escape hatch: even when the
 * per-role toggle for a recipient's role is OFF, recipients in this
 * list always pass through. Used to keep an employee's direct manager
 * on emails about that employee — regardless of the manager's role
 * (CEO, admin, HR Manager, Special Access) — while still allowing the
 * per-role toggle to silence the org-wide blanket fan-out.
 *
 * Single round-trip to the DB; the toggle state is also a single fetch
 * (and cached by Prisma within a request). The filter is layered on top
 * of the GLOBAL toggle which dispatchEmails already checks upstream.
 */
export async function emailsForUserIdsFiltered(
  userIds: number[],
  kind: import("./toggles").EmailKey,
  opts?: { exemptUserIds?: number[] },
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const exempt = new Set<number>(opts?.exemptUserIds ?? []);
  const { getEmailToggleState, shouldIncludeRecipient } = await import("./toggles");
  const [rows, state] = await Promise.all([
    prisma.user.findMany({
      where:  { id: { in: userIds }, isActive: true },
      select: { id: true, email: true, orgLevel: true, role: true },
    }),
    getEmailToggleState(),
  ]);
  const allowed: string[] = [];
  for (const r of rows) {
    if (!r.email) continue;
    if (shouldIncludeRecipient(r, kind, state, exempt)) allowed.push(r.email);
  }
  return allowed;
}

/**
 * All active users — for org-wide blasts (announcements). Returns just
 * the email addresses.
 */
export async function emailsForAllActiveUsers(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { isActive: true },
    select: { email: true },
  });
  return rows.map((r) => r.email).filter(Boolean);
}
