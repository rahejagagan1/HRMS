// CEO evening digest (2026-07-31).
//
// CEOs no longer receive per-event notification emails (dispatchEmails in
// src/lib/notifications.ts filters them out) — instead, every evening at
// 19:00 IST this job sends each active CEO ONE email summarising all of
// the day's in-app notifications: approvals to act on, requests filed by
// their reports, reports submitted, feedback, probation/PIP items, etc.
//
// The morning attendance digest (missed-attendance-emails.ts) is a separate
// direct send and continues in real time.

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";

const IST = "Asia/Kolkata";

// Friendly section names per notification type; unknown types fall through
// to a generic bucket so new types never vanish from the digest.
const TYPE_LABELS: Record<string, string> = {
  leave:          "Leave requests",
  wfh:            "Work-from-home requests",
  regularization: "Regularizations",
  on_duty:        "On-duty requests",
  comp_off:       "Comp-off requests",
  report:         "Reports",
  feedback:       "Feedback",
  probation:      "Probation / PIP",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Send each active CEO one summary email of today's notifications.
 *  Returns how many digests were sent. Skips CEOs with a quiet day. */
export async function sendCeoEveningDigest(): Promise<number> {
  const ceos = await prisma.user.findMany({
    where: { isActive: true, orgLevel: "ceo" },
    select: { id: true, name: true, email: true },
  });
  if (ceos.length === 0) return 0;

  // Start of the current IST calendar day, as a UTC instant.
  const dayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const dayStartUtc = new Date(`${dayIso}T00:00:00.000+05:30`);
  const dateLabel = new Date(`${dayIso}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC",
  });

  let sent = 0;
  for (const ceo of ceos) {
    if (!ceo.email) continue;
    const rows = await prisma.notification.findMany({
      where: { userId: ceo.id, createdAt: { gte: dayStartUtc } },
      orderBy: { createdAt: "asc" },
      select: { type: true, title: true, body: true, createdAt: true },
    });
    if (rows.length === 0) continue; // quiet day → no email

    // Group by type, preserving first-seen order.
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = TYPE_LABELS[r.type] ?? "Other updates";
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }

    const fmtTime = (d: Date) =>
      d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });

    const sections = [...groups.entries()].map(([label, items]) => `
      <h3 style="margin:18px 0 6px;font-size:14px;color:#0f172a">${esc(label)} (${items.length})</h3>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
        ${items.map((i) => `
          <tr>
            <td style="padding:6px 8px;font-size:12px;color:#64748b;white-space:nowrap;vertical-align:top">${fmtTime(i.createdAt)}</td>
            <td style="padding:6px 8px;font-size:13px;color:#1f2937">
              <strong>${esc(i.title)}</strong>${i.body ? `<br/><span style="color:#475569">${esc(String(i.body).slice(0, 200))}</span>` : ""}
            </td>
          </tr>`).join("")}
      </table>`).join("");

    const html = `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0f6ecd;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Daily Summary · 7:00 PM IST</div>
      <div style="font-size:18px;font-weight:700;margin-top:2px">Your day at a glance — ${rows.length} update${rows.length === 1 ? "" : "s"}</div>
      <div style="font-size:13px;opacity:.9;margin-top:2px">${esc(dateLabel)}</div>
    </div>
    <div style="background:#fff;padding:8px 22px 20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:0">
      ${sections}
      <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">
        Individual notification emails are batched into this evening summary for you.
        Everything above is also in your dashboard inbox, where you can act on pending items.
      </p>
    </div>
  </div>
</body></html>`;

    const text = rows.map((r) => `${fmtTime(r.createdAt)} — ${r.title}${r.body ? `: ${r.body}` : ""}`).join("\n");

    try {
      await sendEmail({
        to: ceo.email,
        content: { subject: `Daily summary — ${rows.length} update${rows.length === 1 ? "" : "s"} · ${dateLabel}`, html, text },
      });
      sent++;
    } catch (e) {
      console.error(`[ceo-digest] ${ceo.email}:`, e);
    }
  }
  return sent;
}
