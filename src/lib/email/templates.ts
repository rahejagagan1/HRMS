// Email templates for HR notifications. Every template returns
// { subject, html, text } so the sender doesn't care which type it is.
//
// Plain-text alternatives are mandatory — many corporate mail clients
// (and some Gmail filters) downrank emails that lack a text fallback.

import { appUrl } from "./transport";

export type EmailContent = { subject: string; html: string; text: string };

// ── Shared chrome ──────────────────────────────────────────────────────
// Logo is delivered as an inline CID attachment (cid:logo) by sender.ts —
// works reliably in dev (no public APP_URL fetch needed) and in prod.
const SHELL = (title: string, body: string) => `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0f6ecd;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
        <tr>
          <td style="vertical-align:middle">
            <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85">NB Media HR</p>
            <h1 style="margin:4px 0 0;font-size:18px;font-weight:600;color:#ffffff;line-height:1.3">${title}</h1>
          </td>
          <td style="vertical-align:middle;text-align:right;width:52px">
            <img src="cid:logo" alt="NB" width="40" height="40"
                 style="display:inline-block;border-radius:8px;background:#ffffff;padding:4px;object-fit:contain" />
          </td>
        </tr>
      </table>
    </div>
    <div style="background:#ffffff;padding:22px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px">
      ${body}
    </div>
    <p style="margin:18px 0 0;font-size:11px;color:#94a3b8;text-align:center">
      You're receiving this because of your role on the NB Media dashboard.
    </p>
  </div>
</body></html>`;

const detailRow = (label: string, value: string) => `
  <tr>
    <td style="padding:6px 12px 6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;width:140px;vertical-align:top">${label}</td>
    <td style="padding:6px 0;font-size:14px;color:#1f2937;vertical-align:top">${value}</td>
  </tr>`;

const ctaButton = (label: string, href: string) => `
  <a href="${href}" style="display:inline-block;background:#0f6ecd;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;margin-top:14px">${label}</a>`;

const escape = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]
  );

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", weekday: "short",
  });
// Month-only formatter — used for category=attendance violations, where
// the value tracked is the calendar month ("May 2026") rather than a
// specific day. Stays consistent with the in-app violation detail
// row's display in /dashboard/violations.
const fmtMonthYear = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", {
    month: "long", year: "numeric",
  });

// ── Helper: build subject + html + text from a request payload ─────────
type RequestArgs = {
  applicantName: string;
  details: Array<[string, string]>;  // ordered key→value pairs
  reason?: string;
  inboxPath?: string;                // defaults to /dashboard/hr/inbox
};

function requestEmail(opts: { typeLabel: string; verb: "submitted" | "approved" | "rejected" } & RequestArgs): EmailContent {
  const verbWord = opts.verb === "submitted" ? "submitted" : opts.verb === "approved" ? "was approved" : "was rejected";
  const link = `${appUrl()}${opts.inboxPath ?? "/dashboard/hr/inbox"}`;

  // a / an based on the first letter of the type label so we don't say
  // "submitted a On-Duty request". Vowel-sound check covers most cases.
  const article = /^[aeiouAEIOU]/.test(opts.typeLabel) ? "an" : "a";
  const subject = `${opts.applicantName} ${verbWord} ${article} ${opts.typeLabel} request`;

  const detailsTable = opts.details
    .map(([k, v]) => detailRow(escape(k), escape(v)))
    .join("");

  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
      <strong>${escape(opts.applicantName)}</strong> ${verbWord} ${article}
      ${escape(opts.typeLabel)} request.
    </p>
    ${opts.reason ? `
      <div style="margin:0 0 14px;padding:12px;background:#f8fafc;border-left:3px solid #0f6ecd;border-radius:4px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Reason</p>
        <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(opts.reason)}</p>
      </div>
    ` : ""}
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${detailsTable}</table>
    ${ctaButton(opts.verb === "submitted" ? "Open in inbox" : "View in dashboard", link)}
  `;

  const textLines = [
    `${opts.applicantName} ${verbWord} a ${opts.typeLabel} request.`,
    "",
    ...(opts.reason ? [`Reason: ${opts.reason}`, ""] : []),
    ...opts.details.map(([k, v]) => `${k}: ${v}`),
    "",
    `Open: ${link}`,
  ];

  return { subject, html: SHELL(subject, body), text: textLines.join("\n") };
}

// ── Public template builders ───────────────────────────────────────────

export function leaveRequestEmail(args: {
  applicantName: string;
  leaveType: string;
  fromDate: string | Date;
  toDate: string | Date;
  totalDays: number | string;
  reason?: string;
  /** Optional: who acted (L1 manager or L2 finaliser) and what stage. */
  approverName?: string;
  stageLabel?:   string;
  approvalNote?: string;
  /** L1 approver name + their note. Surfaced as separate rows on the
   *  L2 / final-approval email so recipients see the full chain
   *  (manager + finaliser) without losing context. */
  l1ApproverName?: string;
  l1ApprovalNote?: string;
  /** Pre-formatted day label so callers can flag half-day requests. */
  dayLabel?: string;
}): EmailContent {
  const dayText = args.dayLabel
    ?? `${args.totalDays} day${Number(args.totalDays) === 1 ? "" : "s"}`;
  const details: Array<[string, string]> = [
    ["Leave Type", args.leaveType],
    ["From",       fmtDate(args.fromDate)],
    ["To",         fmtDate(args.toDate)],
    ["Total Days", dayText],
  ];
  if (args.l1ApproverName) {
    details.push(["Manager Approved By", args.l1ApproverName]);
  }
  if (args.l1ApprovalNote) {
    details.push(["Manager Note", args.l1ApprovalNote]);
  }
  if (args.approverName) {
    details.push([args.stageLabel || "Approved by", args.approverName]);
  }
  if (args.approvalNote) {
    details.push(["Approver Note", args.approvalNote]);
  }
  return requestEmail({
    typeLabel: "leave",
    verb: "submitted",
    applicantName: args.applicantName,
    details,
    reason: args.reason,
  });
}

export function wfhRequestEmail(args: {
  applicantName: string;
  date: string | Date;
  toDate?: string | Date;
  reason?: string;
  /** Optional approver context — same shape as the leave email. */
  approverName?: string;
  stageLabel?:   string;
  approvalNote?: string;
  l1ApproverName?: string;
  l1ApprovalNote?: string;
}): EmailContent {
  const details: Array<[string, string]> = [];
  if (args.toDate && fmtDate(args.toDate) !== fmtDate(args.date)) {
    details.push(["From", fmtDate(args.date)]);
    details.push(["To",   fmtDate(args.toDate)]);
  } else {
    details.push(["Date", fmtDate(args.date)]);
  }
  if (args.l1ApproverName) {
    details.push(["Manager Approved By", args.l1ApproverName]);
  }
  if (args.l1ApprovalNote) {
    details.push(["Manager Note", args.l1ApprovalNote]);
  }
  if (args.approverName) {
    details.push([args.stageLabel || "Approved by", args.approverName]);
  }
  if (args.approvalNote) {
    details.push(["Approver Note", args.approvalNote]);
  }
  return requestEmail({
    typeLabel: "WFH",
    verb: "submitted",
    applicantName: args.applicantName,
    details,
    reason: args.reason,
  });
}

export function onDutyRequestEmail(args: {
  applicantName: string;
  /** Single-day date; for ranges, pass `fromDate` + `toDate` + `totalDays`. */
  date: string | Date;
  /** Optional range end. When set + different from `date`, the email
   *  renders FROM / TO / TOTAL DAYS instead of a single DATE row —
   *  mirrors the leave email's structure so HR sees the same fields
   *  in the same order across every request type. */
  toDate?: string | Date;
  totalDays?: number | string;
  /** Optional time window — surfaced as a TIME row when both ends are
   *  present (e.g. "10:00 – 14:00"). Skipped otherwise. */
  fromTime?: string;
  toTime?: string;
  location?: string;
  reason?: string;
  /** Optional approver context — same shape as the leave / WFH emails so
   *  L1 / L2 stages surface the manager + finaliser rows. */
  approverName?: string;
  stageLabel?:   string;
  approvalNote?: string;
  l1ApproverName?: string;
  l1ApprovalNote?: string;
}): EmailContent {
  // Lead with the request "type" row so OD emails read the same shape
  // as a leave email's "Leave Type: Casual Leave" header line.
  const details: Array<[string, string]> = [["Request Type", "On-Duty"]];

  // Date / range. For a range (toDate set and different from date)
  // show FROM + TO + TOTAL DAYS, mirroring leaveRequestEmail. Single-
  // day requests keep a clean single DATE row.
  const isRange = args.toDate && fmtDate(args.toDate) !== fmtDate(args.date);
  if (isRange) {
    details.push(["From", fmtDate(args.date)]);
    details.push(["To",   fmtDate(args.toDate!)]);
    const days = args.totalDays;
    if (days != null) {
      details.push(["Total Days", `${days} day${Number(days) === 1 ? "" : "s"}`]);
    }
  } else {
    details.push(["Date", fmtDate(args.date)]);
  }

  if (args.fromTime && args.toTime) {
    details.push(["Time", `${args.fromTime} – ${args.toTime}`]);
  }
  if (args.location) details.push(["Location", args.location]);
  if (args.l1ApproverName) details.push(["Manager Approved By", args.l1ApproverName]);
  if (args.l1ApprovalNote) details.push(["Manager Note",        args.l1ApprovalNote]);
  if (args.approverName)   details.push([args.stageLabel || "Approved by", args.approverName]);
  if (args.approvalNote)   details.push(["Approver Note",       args.approvalNote]);
  return requestEmail({
    typeLabel: "On-Duty",
    verb: "submitted",
    applicantName: args.applicantName,
    details,
    reason: args.reason,
  });
}

export function regularizationRequestEmail(args: {
  applicantName: string;
  date: string | Date;
  reason?: string;
  /** Optional approver context — same shape as the leave / WFH / on-duty
   *  emails so L1 / L2 stages surface the manager + finaliser rows. */
  approverName?: string;
  stageLabel?:   string;
  approvalNote?: string;
  l1ApproverName?: string;
  l1ApprovalNote?: string;
}): EmailContent {
  const details: Array<[string, string]> = [["Date", fmtDate(args.date)]];
  if (args.l1ApproverName) details.push(["Manager Approved By", args.l1ApproverName]);
  if (args.l1ApprovalNote) details.push(["Manager Note",        args.l1ApprovalNote]);
  if (args.approverName)   details.push([args.stageLabel || "Approved by", args.approverName]);
  if (args.approvalNote)   details.push(["Approver Note",       args.approvalNote]);
  return requestEmail({
    typeLabel: "attendance regularization",
    verb: "submitted",
    applicantName: args.applicantName,
    details,
    reason: args.reason,
  });
}

export function compOffRequestEmail(args: {
  applicantName: string;
  workedDate: string | Date;
  creditDays: number | string;
  reason?: string;
  /** Approver chain — same shape as leave / WFH / on-duty / regularize so
   *  the L1 / L2 stages surface manager + finaliser rows. */
  approverName?: string;
  stageLabel?:   string;
  approvalNote?: string;
  l1ApproverName?: string;
  l1ApprovalNote?: string;
}): EmailContent {
  const details: Array<[string, string]> = [
    ["Worked Date", fmtDate(args.workedDate)],
    ["Credit",      `${args.creditDays} day${Number(args.creditDays) === 1 ? "" : "s"}`],
  ];
  if (args.l1ApproverName) details.push(["Manager Approved By", args.l1ApproverName]);
  if (args.l1ApprovalNote) details.push(["Manager Note",        args.l1ApprovalNote]);
  if (args.approverName)   details.push([args.stageLabel || "Approved by", args.approverName]);
  if (args.approvalNote)   details.push(["Approver Note",       args.approvalNote]);
  return requestEmail({
    typeLabel: "comp-off credit",
    verb: "submitted",
    applicantName: args.applicantName,
    details,
    reason: args.reason,
  });
}

export function decisionEmail(args: {
  applicantName: string;
  typeLabel: string;
  outcome: "approved" | "rejected";
  approverName?: string;
  note?: string;
}): EmailContent {
  const subject = `Your ${args.typeLabel} request was ${args.outcome}`;
  const link = `${appUrl()}/dashboard/hr/inbox`;
  const accent = args.outcome === "approved" ? "#10b981" : "#ef4444";
  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
      Hi ${escape(args.applicantName)}, your <strong>${escape(args.typeLabel)}</strong> request
      <span style="color:${accent};font-weight:600">${args.outcome}</span>${args.approverName ? ` by ${escape(args.approverName)}` : ""}.
    </p>
    ${args.note ? `
      <div style="margin-top:14px;padding:12px;background:#f8fafc;border-left:3px solid ${accent};border-radius:4px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Note</p>
        <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(args.note)}</p>
      </div>
    ` : ""}
    ${ctaButton("View details", link)}
  `;
  const text = [
    `Hi ${args.applicantName},`,
    `Your ${args.typeLabel} request was ${args.outcome}${args.approverName ? ` by ${args.approverName}` : ""}.`,
    ...(args.note ? ["", `Note: ${args.note}`] : []),
    "",
    `Open: ${link}`,
  ].join("\n");
  return { subject, html: SHELL(subject, body), text };
}

export function attendanceReminderEmail(args: {
  userName: string;
  kind: "clock-in" | "clock-out";
}): EmailContent {
  const isIn  = args.kind === "clock-in";
  const action = isIn ? "clock in" : "clock out";
  const subject = isIn
    ? "Reminder: please clock in for today"
    : "Reminder: please clock out before you leave";
  const link = `${appUrl()}/dashboard/hr/attendance`;
  const accent = isIn ? "#f59e0b" : "#0f6ecd";
  const body = `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
      Hi ${escape(args.userName)},
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
      Friendly reminder — you haven't done <strong style="color:${accent}">${action}</strong> today.
    </p>
    ${isIn ? `
      <div style="margin:14px 0;padding:12px;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:4px">
        <p style="margin:0;font-size:13px;color:#7c2d12;line-height:1.55">
          If you're on <strong>leave</strong>, working from home, or out for a meeting,
          please file the matching request from the dashboard so your attendance
          record stays accurate. Otherwise please clock in now — past 10:00 AM IST
          counts as a half day.
        </p>
      </div>
    ` : `
      <div style="margin:14px 0;padding:12px;background:#eff6ff;border-left:3px solid #0f6ecd;border-radius:4px">
        <p style="margin:0;font-size:13px;color:#1e3a8a;line-height:1.55">
          Without a clock-out the day is logged as <strong>missed clock-out</strong>
          and your hours don't count toward effective time. Take a moment to
          clock out — or file a regularization if you've already left.
        </p>
      </div>
    `}
    ${ctaButton(isIn ? "Clock in now" : "Clock out now", link)}
  `;
  const text = [
    `Hi ${args.userName},`,
    ``,
    `Reminder: you haven't done ${action} on the NB Media dashboard today.`,
    ``,
    isIn
      ? `If you're on leave, WFH, or out for a meeting, please file the matching request from the dashboard. Otherwise please clock in now — past 10:00 AM IST counts as a half day.`
      : `Without a clock-out the day is logged as missed-clock-out and your hours don't count toward effective time. Please clock out, or file a regularization if you've already left.`,
    ``,
    `Open: ${link}`,
  ].join("\n");
  return { subject, html: SHELL(subject, body), text };
}

// ── HR daily "who's late / absent" summary (10:05 IST) ─────────────────
// Recipients: CEO + HR Manager + Developers. Minimalist redesign with
// mobile-first markup:
//   • Single-column-friendly: a 4-up summary is hard to read on a 360px
//     phone, so we use a single quiet stats line + two lean section
//     tables. No card-in-card nesting.
//   • Quiet palette: one accent (slate-blue). Status uses tiny coloured
//     dots so the email reads as a document, not a dashboard.
//   • Pure-table layout, no flexbox. Renders identically on Gmail web,
//     Gmail iOS, Gmail Android, Outlook, Apple Mail.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
export function hrLateSummaryEmail(args: {
  today: Date;
  absent: Array<{ name: string; department: string | null }>;
  late:   Array<{ name: string; department: string | null; clockIn: Date | null }>;
  totals: { absent: number; late: number; onTime: number; onLeave: number };
  /** Optional label shown in the header ("Daily Attendance · <fireTimeLabel>")
   *  and the text-version preamble. Defaults to "10:05 AM IST" to preserve
   *  the legacy NB-Media-only behavior. The split-brand scheduler passes
   *  the actual fire time so each brand's email reflects its own send slot. */
  fireTimeLabel?: string;
  /** Optional label shown in the "Late · clocked in after X" heading and
   *  the text-version equivalent. Defaults to "10:00 IST". */
  cutoffLabel?: string;
}): EmailContent {
  const fireTimeLabel = args.fireTimeLabel ?? "10:05 AM IST";
  const cutoffLabel   = args.cutoffLabel   ?? "10:00 IST";
  const subject = `Attendance — ${fmtDate(args.today)} · ${args.totals.absent} absent · ${args.totals.late} late`;
  const fmtTime = (d: Date | null) =>
    d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "—";
  const weekday = args.today.toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
  const dateStr = args.today.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
  const headcount = args.totals.absent + args.totals.late + args.totals.onTime + args.totals.onLeave;

  // Tiny coloured-dot helper.
  const dot = (color: string) =>
    `<span style="display:inline-block;width:7px;height:7px;background:${color};border-radius:50%;vertical-align:middle;margin-right:6px"></span>`;

  // Single-line stats summary — replaces the 4-card row that wrapped
  // awkwardly on phones. One line of plain text with coloured dots,
  // separated by middle-dots. Reads on any width.
  const statsLine = `
    <div style="font-family:${FONT};font-size:13px;color:#475569;line-height:1.7">
      ${dot("#dc2626")}<strong style="color:#0f172a">${args.totals.absent}</strong>&nbsp;Absent
      &nbsp;&nbsp;·&nbsp;&nbsp;
      ${dot("#ea580c")}<strong style="color:#0f172a">${args.totals.late}</strong>&nbsp;Late
      &nbsp;&nbsp;·&nbsp;&nbsp;
      ${dot("#16a34a")}<strong style="color:#0f172a">${args.totals.onTime}</strong>&nbsp;On time
      &nbsp;&nbsp;·&nbsp;&nbsp;
      ${dot("#7c3aed")}<strong style="color:#0f172a">${args.totals.onLeave}</strong>&nbsp;On leave
    </div>
    <div style="font-family:${FONT};font-size:11px;color:#94a3b8;margin-top:4px">${headcount} employees in scope</div>`;

  // Row builder — name + department on the left, status text on the right.
  // No avatars (broke on Gmail mobile), no alternating stripes (looked
  // busy with the toned-down palette). Just clean rows with a hairline
  // divider between them.
  const renderRow = (name: string, department: string | null, right: string) => `
    <tr>
      <td valign="middle" style="padding:11px 0;border-bottom:1px solid #eef2f7;font-family:${FONT}">
        <div style="font-size:13.5px;color:#0f172a;font-weight:600;line-height:1.3">${escape(name)}</div>
        ${department ? `<div style="margin-top:2px;font-size:11.5px;color:#94a3b8">${escape(department)}</div>` : ""}
      </td>
      <td valign="middle" align="right" style="padding:11px 0;border-bottom:1px solid #eef2f7;white-space:nowrap;font-family:${FONT};font-size:12px;color:#475569;font-weight:600">${right}</td>
    </tr>`;

  // Section: a small-caps heading with a count, then a borderless table.
  const renderSection = (heading: string, accent: string, count: number, rows: string, emptyMsg: string) => `
    <div style="margin-top:24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
        <tr>
          <td valign="middle" style="font-family:${FONT};font-size:11px;color:#0f172a;text-transform:uppercase;letter-spacing:0.12em;font-weight:700">
            ${dot(accent)}${heading}
          </td>
          <td valign="middle" align="right" style="font-family:${FONT};font-size:11px;color:#94a3b8;font-weight:600">${count}</td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:6px;border-top:1px solid #eef2f7">
        ${rows || `<tr><td align="center" style="padding:18px 0;font-family:${FONT};font-size:12.5px;color:#cbd5e1;font-style:italic;border-bottom:1px solid #eef2f7">${emptyMsg}</td></tr>`}
      </table>
    </div>`;

  const absentRows = args.absent.map((r) => renderRow(r.name, r.department,
    `<span style="color:#dc2626">Absent</span>`,
  )).join("");
  const lateRows = args.late.map((r) => renderRow(r.name, r.department,
    `<span style="color:#ea580c">${fmtTime(r.clockIn)}</span>`,
  )).join("");

  const link = `${appUrl()}/dashboard/hr/admin?tab=attendance-dashboard`;
  const body = `
    <!-- Header: just the date, lightly styled. No coloured banner. -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 4px">
      <tr>
        <td style="font-family:${FONT};font-size:11px;color:#64748b;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">Daily Attendance · ${fireTimeLabel}</td>
      </tr>
      <tr>
        <td style="font-family:${FONT};font-size:20px;font-weight:700;color:#0f172a;line-height:1.3;padding-top:4px">${weekday}, ${dateStr}</td>
      </tr>
    </table>

    <!-- Subtle divider, then the stats line. -->
    <div style="border-top:1px solid #e2e8f0;margin:14px 0 12px"></div>
    ${statsLine}

    ${renderSection("Absent · no clock-in, no leave", "#dc2626", args.absent.length, absentRows, "Nobody absent today.")}
    ${renderSection(`Late · clocked in after ${cutoffLabel}`, "#ea580c", args.late.length, lateRows, "Everyone clocked in on time.")}

    <!-- CTA: simple inline link button. -->
    <div style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:18px">
      <a href="${link}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-family:${FONT};font-size:12.5px;font-weight:600;padding:9px 18px;border-radius:6px">Open attendance dashboard →</a>
    </div>

    <!-- Quiet footer note. -->
    <p style="font-family:${FONT};margin:18px 0 0;font-size:11px;color:#94a3b8;line-height:1.55">
      WFH and On-Duty employees are expected to clock in — they appear in Absent if they haven't.
      Anyone with an active leave application (any non-rejected status) is excluded.
      Weekends and holidays don't generate this email.
    </p>`;

  const textRows = [
    `Daily Attendance — ${weekday}, ${dateStr} (${fireTimeLabel})`,
    `${args.totals.absent} absent · ${args.totals.late} late · ${args.totals.onTime} on time · ${args.totals.onLeave} on leave (${headcount} in scope)`,
    ``,
    `ABSENT (${args.totals.absent})`,
    ...(args.absent.length ? args.absent.map((r) => `  • ${r.name}${r.department ? ` — ${r.department}` : ""}`) : ["  (none)"]),
    ``,
    `LATE (${args.totals.late}) — clocked in after ${cutoffLabel}`,
    ...(args.late.length ? args.late.map((r) => `  • ${r.name}${r.department ? ` — ${r.department}` : ""} · ${fmtTime(r.clockIn)}`) : ["  (none)"]),
    ``,
    `Open: ${link}`,
  ];
  return { subject, html: SHELL(`Attendance — ${fmtDate(args.today)}`, body), text: textRows.join("\n") };
}

export function reportSubmittedEmail(args: {
  kind: "weekly" | "monthly";
  periodLabel: string;
  managerName: string;
  link: string;
}): EmailContent {
  const subject = `${args.managerName} submitted ${args.kind} report — ${args.periodLabel}`;
  const html = SHELL(subject, `
    <p style="margin:0 0 8px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">
      ${args.kind === "weekly" ? "Weekly" : "Monthly"} Report
    </p>
    <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.6">
      <strong>${escape(args.managerName)}</strong> just locked their ${args.kind} report for <strong>${escape(args.periodLabel)}</strong>.
    </p>
    <p style="margin:12px 0 0;font-size:13px;color:#475569;line-height:1.55">
      Open it from the dashboard to review the writer / editor / researcher metrics, key learnings, and risks.
    </p>
    ${ctaButton("Open report", args.link)}
  `);
  const text = [
    subject,
    "",
    `${args.managerName} just locked their ${args.kind} report for ${args.periodLabel}.`,
    "",
    `Open: ${args.link}`,
  ].join("\n");
  return { subject, html, text };
}

export function feedbackEmail(args: {
  category: string;
  message: string;
}): EmailContent {
  const prettyCategory = args.category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const subject = `New anonymous feedback — ${prettyCategory}`;
  const link = `${appUrl()}/dashboard/feedback_inbox`;
  const html = SHELL(subject, `
    <p style="margin:0 0 8px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">
      ${escape(prettyCategory)} · Anonymous
    </p>
    <div style="font-size:14px;color:#1f2937;line-height:1.65;white-space:pre-wrap">${escape(args.message)}</div>
    <p style="margin:16px 0 0;font-size:11.5px;color:#64748b">
      The submitter is anonymous — feedback is not attributed to a user account.
    </p>
    ${ctaButton("Open inbox", link)}
  `);
  const text = [
    `${subject}`,
    "",
    args.message,
    "",
    `(Anonymous — submitter not disclosed.)`,
    "",
    `Open: ${link}`,
  ].join("\n");
  return { subject, html, text };
}

// ── Offboarding ─────────────────────────────────────────────────────────
// Two flavours from the same data:
//   employeeFarewellEmail: warm goodbye sent to the leaver themselves.
//   exitNotificationEmail: heads-up sent to CEO / HR / manager / admins.
export function employeeFarewellEmail(args: {
  name: string;
  lastWorkingDay: string | Date;
}): EmailContent {
  const subject = `Wishing you the best — your last day at NB Media`;
  const html = SHELL("Wishing you the best", `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937">Hi ${escape(args.name)},</p>
    <p style="margin:0 0 12px;font-size:13.5px;color:#1f2937;line-height:1.6">
      Thanks for everything you've contributed at NB Media. Your last working
      day on record is <strong>${fmtDate(args.lastWorkingDay)}</strong>.
    </p>
    <p style="margin:0 0 12px;font-size:13.5px;color:#1f2937;line-height:1.6">
      HR will be in touch shortly to coordinate handover, asset return, and
      final settlement. If anything's unclear, just reply to this email.
    </p>
    <p style="margin:18px 0 0;font-size:13.5px;color:#1f2937">— The NB Media team</p>
  `);
  const text = [
    `Hi ${args.name},`,
    "",
    `Thanks for everything you've contributed at NB Media. Your last working day on record is ${fmtDate(args.lastWorkingDay)}.`,
    "",
    `HR will be in touch shortly to coordinate handover, asset return, and final settlement.`,
    "",
    `— The NB Media team`,
  ].join("\n");
  return { subject, html, text };
}

export function exitNotificationEmail(args: {
  name: string;
  email: string;
  exitType: string;
  lastWorkingDay: string | Date;
  reason?: string | null;
}): EmailContent {
  const subject = `Exit recorded — ${args.name}`;
  const link = `${appUrl()}/dashboard/hr/offboard`;
  const html = SHELL(subject, `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937">
      An employee exit has been recorded.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">
      ${detailRow("Name",            escape(args.name))}
      ${detailRow("Email",           escape(args.email))}
      ${detailRow("Type",            escape(args.exitType.replace(/_/g, " ")))}
      ${detailRow("Last Working Day", fmtDate(args.lastWorkingDay))}
      ${args.reason ? detailRow("Reason", escape(args.reason)) : ""}
    </table>
    ${ctaButton("Open Offboarding", link)}
  `);
  const text = [
    `Exit recorded for ${args.name} (${args.email})`,
    "",
    `Type: ${args.exitType.replace(/_/g, " ")}`,
    `Last working day: ${fmtDate(args.lastWorkingDay)}`,
    args.reason ? `Reason: ${args.reason}` : "",
    "",
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}

// Daily reminder sent to the offboarding stakeholders when an employee's
// last working day is TODAY. Not frozen — distinct from the leave templates.
export function lastWorkingDayReminderEmail(args: {
  name: string;
  employeeId?: string | null;
  designation?: string | null;
  exitType: string;
  lastWorkingDay: string | Date;
  reason?: string | null;
}): EmailContent {
  const subject = `Reminder: today is ${args.name}'s last working day`;
  const link = `${appUrl()}/dashboard/hr/offboard`;
  const html = SHELL("Last working day — today", `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937;line-height:1.6">
      Reminder: <strong>${escape(args.name)}</strong>'s last working day with us
      is <strong>today</strong>. Please make sure handover, asset return, access
      revocation and final settlement are wrapped up.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">
      ${detailRow("Employee",          escape(args.name))}
      ${args.employeeId  ? detailRow("Employee ID",  escape(args.employeeId))  : ""}
      ${args.designation ? detailRow("Designation",  escape(args.designation)) : ""}
      ${detailRow("Exit type",         escape(args.exitType.replace(/_/g, " ")))}
      ${detailRow("Last working day",   fmtDate(args.lastWorkingDay))}
      ${args.reason ? detailRow("Reason", escape(args.reason)) : ""}
    </table>
    ${ctaButton("Open Offboarding", link)}
  `);
  const text = [
    `Reminder: today is ${args.name}'s last working day with us.`,
    "",
    `Employee: ${args.name}`,
    args.employeeId  ? `Employee ID: ${args.employeeId}`   : "",
    args.designation ? `Designation: ${args.designation}`  : "",
    `Exit type: ${args.exitType.replace(/_/g, " ")}`,
    `Last working day: ${fmtDate(args.lastWorkingDay)}`,
    args.reason ? `Reason: ${args.reason}` : "",
    "",
    `Please ensure handover, asset return, access revocation and final settlement are complete.`,
    "",
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}

export function jobApplicationEmail(args: {
  name: string;
  email: string;
  phone: string;
  role: string;
  link: string;
}): EmailContent {
  const subject = `New application — ${args.role}`;
  const fullLink = args.link.startsWith("http") ? args.link : `${appUrl()}${args.link}`;
  const html = SHELL(subject, `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937">
      A new candidate just applied through the careers form.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">
      ${detailRow("Role",  escape(args.role))}
      ${detailRow("Name",  escape(args.name))}
      ${detailRow("Email", escape(args.email))}
      ${args.phone ? detailRow("Phone", escape(args.phone)) : ""}
    </table>
    ${ctaButton("Open Hiring inbox", fullLink)}
  `);
  const text = [
    `New application for ${args.role}`,
    "",
    `Name:  ${args.name}`,
    `Email: ${args.email}`,
    args.phone ? `Phone: ${args.phone}` : "",
    "",
    `Open: ${fullLink}`,
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}

export function welcomeLoginEmail(args: {
  name: string;
  email: string;
  needsOnboarding: boolean;
}): EmailContent {
  const subject = `Welcome to NB Media — your dashboard is ready`;
  const link = `${appUrl()}/login`;
  const onboardingNote = args.needsOnboarding
    ? `<p style="margin:0 0 12px;font-size:13.5px;color:#1f2937;line-height:1.6">
         When you sign in for the first time we'll walk you through a short
         onboarding step — confirming your contact details so HR has everything on file.
       </p>`
    : "";
  const html = SHELL("Welcome to NB Media", `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937">Hi ${escape(args.name)},</p>
    <p style="margin:0 0 12px;font-size:13.5px;color:#1f2937;line-height:1.6">
      Your account on the NB Media dashboard has been set up. You can sign in
      using your Google account at <strong>${escape(args.email)}</strong> — no
      password needed.
    </p>
    ${onboardingNote}
    ${ctaButton("Sign in to the dashboard", link)}
    <p style="margin:18px 0 0;font-size:11.5px;color:#64748b">
      If your Google account uses a different address, ask HR to update your
      record before signing in.
    </p>
  `);
  const text = [
    `Hi ${args.name},`,
    "",
    `Your NB Media dashboard account is ready. Sign in with your Google account at ${args.email}.`,
    args.needsOnboarding
      ? "On first sign-in we'll walk you through a short onboarding step."
      : "",
    "",
    `Sign in: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}

export function announcementEmail(args: {
  title: string;
  body: string;
  authorName: string;
}): EmailContent {
  const subject = `Announcement: ${args.title}`;
  const link = `${appUrl()}/dashboard/hr/announcements`;
  const html = SHELL(args.title, `
    <p style="margin:0 0 8px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">
      From ${escape(args.authorName)}
    </p>
    <div style="font-size:14px;color:#1f2937;line-height:1.65;white-space:pre-wrap">${escape(args.body)}</div>
    ${ctaButton("Open in dashboard", link)}
  `);
  const text = [
    `Announcement from ${args.authorName}`,
    "",
    args.title,
    "",
    args.body,
    "",
    `Open: ${link}`,
  ].join("\n");
  return { subject, html, text };
}

// ── Violations ────────────────────────────────────────────────────────
// Sent to the affected employee when a violation is first logged or
// transitioned, plus a 15-day cron reminder for HR while it's still
// in_progress. Visual style: tinted alert banner up top to signal the
// row's severity / state at a glance, then a clean info table, then
// per-section detail blocks for description / action / notes.
// UI-side severity labels are L0–L3; DB still stores
// low/medium/high/critical. Update both this map and the violations
// page if the user-facing labels ever change again.
const SEVERITY_LABEL: Record<string, string> = {
  low: "L0", medium: "L1", high: "L2", critical: "L3",
};
const SEVERITY_TINT: Record<string, { bg: string; border: string; text: string }> = {
  low:      { bg: "#f1f5f9", border: "#cbd5e1", text: "#475569" },
  medium:   { bg: "#fef3c7", border: "#fcd34d", text: "#92400e" },
  high:     { bg: "#ffedd5", border: "#fdba74", text: "#9a3412" },
  critical: { bg: "#fee2e2", border: "#fca5a5", text: "#991b1b" },
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", paused: "Paused", closed: "Closed",
};
const STATUS_COLOR: Record<string, string> = {
  open: "#ef4444", in_progress: "#0284c7", paused: "#d97706", closed: "#10b981",
};

// Shared section card — used by description / action / notes blocks.
const sectionCard = (label: string, value: string) => `
  <div style="margin-top:10px;padding:12px 14px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
    <p style="margin:0 0 6px;font-size:10.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.12em">${escape(label)}</p>
    <p style="margin:0;font-size:13.5px;color:#1f2937;line-height:1.6;white-space:pre-wrap">${escape(value)}</p>
  </div>`;

// Shared key/value row inside the violation summary table.
const vRow = (label: string, valueHtml: string) => `
  <tr>
    <td style="padding:8px 14px;font-size:10.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;width:130px;vertical-align:middle;border-bottom:1px solid #eef2f7">${escape(label)}</td>
    <td style="padding:8px 14px;font-size:13.5px;color:#1f2937;vertical-align:middle;border-bottom:1px solid #eef2f7">${valueHtml}</td>
  </tr>`;

export function violationCreatedEmail(args: {
  userName: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  category?: string | null;
  actionTaken?: string | null;
  notes?: string | null;
  reporterName?: string | null;
  violationDate?: string | Date | null;
}): EmailContent {
  const subject = `A violation has been logged on your record`;
  const link = `${appUrl()}/dashboard/strikes`;
  const sev   = SEVERITY_LABEL[args.severity] ?? args.severity;
  const stat  = STATUS_LABEL[args.status] ?? args.status;
  const statColor = STATUS_COLOR[args.status] ?? "#64748b";
  const sevTint = SEVERITY_TINT[args.severity] ?? SEVERITY_TINT.medium;
  // Attendance violations are tracked per-MONTH (e.g. "3 lates in May")
  // so the email surfaces "Month" + "May 2026" instead of the day-level
  // "Date" / "01 May, 2026". Every other category keeps the day-level
  // wording — matches the in-app violation detail row in
  // /dashboard/violations and the month-picker form input.
  const isAttendance = (args.category ?? "").toLowerCase() === "attendance";
  const dateLabel = args.violationDate
    ? (isAttendance ? fmtMonthYear(args.violationDate) : fmtDate(args.violationDate))
    : null;
  const dateRowLabel = isAttendance ? "Month" : "Date";

  // Severity-tinted alert banner — replaces the generic "policy
  // violation has been recorded" line with a colour-coded callout that
  // immediately telegraphs how serious the entry is.
  const banner = `
    <div style="margin:0 0 16px;padding:14px 16px;background:${sevTint.bg};border:1px solid ${sevTint.border};border-radius:8px">
      <p style="margin:0;font-size:10.5px;color:${sevTint.text};font-weight:700;text-transform:uppercase;letter-spacing:0.12em">Severity ${escape(sev)} — Violation logged</p>
      <p style="margin:6px 0 0;font-size:14px;color:#1f2937;font-weight:600;line-height:1.4">${escape(args.title)}</p>
    </div>`;

  const rows: string[] = [];
  if (args.category)     rows.push(vRow("Category",  escape(args.category)));
  rows.push(vRow("Status", `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;background:${statColor}1a;color:${statColor}">${escape(stat)}</span>`));
  if (dateLabel)         rows.push(vRow(dateRowLabel, escape(dateLabel)));
  if (args.reporterName) rows.push(vRow("Reported by", escape(args.reporterName)));

  const body = `
    <p style="margin:0 0 14px;font-size:14px;color:#1f2937;line-height:1.6">
      Hi ${escape(args.userName)},
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      A policy / conduct violation has been recorded on your record. Full details below.
    </p>
    ${banner}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${rows.join("")}
    </table>
    ${args.description ? sectionCard("Description",  args.description)  : ""}
    ${args.actionTaken ? sectionCard("Action taken", args.actionTaken)  : ""}
    ${args.notes       ? sectionCard("Notes",        args.notes)        : ""}
    <p style="margin:20px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #0f6ecd;border-radius:0 6px 6px 0;font-size:12.5px;color:#475569;line-height:1.55">
      To discuss or appeal this, reach out to HR or your manager directly.
    </p>
    ${ctaButton("View on dashboard", link)}
  `;
  const text = [
    `Hi ${args.userName},`,
    `A violation has been recorded against your name.`,
    ``,
    `Title: ${args.title}`,
    args.category ? `Category: ${args.category}` : null,
    `Severity: ${sev}`,
    `Status: ${stat}`,
    dateLabel ? `${dateRowLabel}: ${dateLabel}` : null,
    args.reporterName ? `Reported by: ${args.reporterName}` : null,
    args.description ? `\nDescription:\n${args.description}` : null,
    args.actionTaken ? `\nAction taken:\n${args.actionTaken}` : null,
    args.notes ? `\nNotes:\n${args.notes}` : null,
    ``,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}

// Sent to the affected employee whenever the status (or action / notes)
// changes — open → in_progress → closed, etc.
export function violationStatusChangedEmail(args: {
  userName: string;
  title: string;
  oldStatus: string;
  newStatus: string;
  actionTaken?: string | null;
  notes?: string | null;
  changedByName?: string | null;
}): EmailContent {
  const newStat   = STATUS_LABEL[args.newStatus] ?? args.newStatus;
  const newColor  = STATUS_COLOR[args.newStatus] ?? "#64748b";
  const oldStat   = STATUS_LABEL[args.oldStatus] ?? args.oldStatus;
  const oldColor  = STATUS_COLOR[args.oldStatus] ?? "#94a3b8";

  const subject = `Update on your violation: ${newStat}`;
  const link = `${appUrl()}/dashboard/strikes`;

  // Two-pill status transition — old (greyed) on the left, arrow,
  // new (coloured + bold) on the right. Renders consistently across
  // Gmail / Outlook / Apple Mail; tested against the major clients.
  const transitionPill = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px">
      <tr>
        <td style="padding:14px 16px;vertical-align:middle">
          <p style="margin:0 0 6px;font-size:10.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.12em">Status changed</p>
          <span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:11.5px;font-weight:700;background:${oldColor}14;color:${oldColor}">${escape(oldStat)}</span>
          <span style="font-size:13px;color:#94a3b8;margin:0 6px">→</span>
          <span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;background:${newColor}1f;color:${newColor};box-shadow:inset 0 0 0 1px ${newColor}55">${escape(newStat)}</span>
          ${args.changedByName ? `<p style="margin:8px 0 0;font-size:11.5px;color:#64748b">Updated by <strong style="color:#475569">${escape(args.changedByName)}</strong></p>` : ""}
        </td>
      </tr>
    </table>`;

  const body = `
    <p style="margin:0 0 14px;font-size:14px;color:#1f2937;line-height:1.6">
      Hi ${escape(args.userName)},
    </p>
    <p style="margin:0 0 6px;font-size:13.5px;color:#475569;line-height:1.6">
      The status of your violation has been updated.
    </p>
    <p style="margin:0 0 4px;font-size:14.5px;color:#1f2937;font-weight:600;line-height:1.4">
      ${escape(args.title)}
    </p>
    ${transitionPill}
    ${args.actionTaken ? sectionCard("Action taken", args.actionTaken) : ""}
    ${args.notes       ? sectionCard("Notes",        args.notes)       : ""}
    ${ctaButton("View on dashboard", link)}
  `;
  const text = [
    `Hi ${args.userName},`,
    `The status of the violation "${args.title}" has changed: ${oldStat} → ${newStat}${args.changedByName ? ` (by ${args.changedByName})` : ""}.`,
    args.actionTaken ? `\nAction taken:\n${args.actionTaken}` : null,
    args.notes ? `\nNotes:\n${args.notes}` : null,
    ``,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}

// Cron-scheduled gentle nudge to HR / CEO / admins when a violation has
// been sitting "in progress" for too long. Sent at most every 15 days
// per violation — throttle is enforced by Violation.lastReminderAt.
export function violationInProgressReminderEmail(args: {
  recipientName?: string | null;
  affectedUserName: string;
  title: string;
  daysOpen: number;
  severity: string;
  category?: string | null;
  reporterName?: string | null;
  actionTaken?: string | null;
}): EmailContent {
  const subject = `Reminder: violation for ${args.affectedUserName} is still in progress`;
  const link = `${appUrl()}/dashboard/strikes`;
  const sev = SEVERITY_LABEL[args.severity] ?? args.severity;
  const sevTint = SEVERITY_TINT[args.severity] ?? SEVERITY_TINT.medium;

  // Big day-counter callout — turns the central data point ("how long
  // has this been sitting") into the focal point so the recipient
  // immediately sees the urgency.
  const dayCounter = `
    <div style="margin:0 0 16px;padding:18px 16px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;text-align:center">
      <p style="margin:0;font-size:10.5px;color:#9a3412;font-weight:700;text-transform:uppercase;letter-spacing:0.12em">Open for</p>
      <p style="margin:6px 0 0;font-size:32px;font-weight:700;color:#9a3412;line-height:1">${args.daysOpen}<span style="font-size:14px;font-weight:600;margin-left:4px">day${args.daysOpen === 1 ? "" : "s"}</span></p>
      <p style="margin:6px 0 0;font-size:11.5px;color:#9a3412">since the violation was logged · still <strong>in progress</strong></p>
    </div>`;

  const rows: string[] = [];
  rows.push(vRow("Employee", escape(args.affectedUserName)));
  rows.push(vRow("Title",    escape(args.title)));
  if (args.category)     rows.push(vRow("Category", escape(args.category)));
  rows.push(vRow("Severity", `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;background:${sevTint.bg};color:${sevTint.text}">${escape(sev)}</span>`));
  if (args.reporterName) rows.push(vRow("Reported by", escape(args.reporterName)));

  const body = `
    <p style="margin:0 0 12px;font-size:14px;color:#1f2937;line-height:1.6">
      ${args.recipientName ? `Hi ${escape(args.recipientName)},` : "Hi,"}
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      A violation marked <strong>in progress</strong> hasn't been closed yet — a quick nudge so it doesn't get lost.
    </p>
    ${dayCounter}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${rows.join("")}
    </table>
    ${args.actionTaken ? sectionCard("Last action taken", args.actionTaken) : ""}
    <p style="margin:20px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #0f6ecd;border-radius:0 6px 6px 0;font-size:12.5px;color:#475569;line-height:1.55">
      Once this is resolved, update the status to <strong>Closed</strong> on the dashboard so the reminder stops firing every 15 days.
    </p>
    ${ctaButton("Open the violation", link)}
  `;
  const text = [
    args.recipientName ? `Hi ${args.recipientName},` : "Hi,",
    `A violation marked "in progress" still hasn't been closed.`,
    ``,
    `Employee: ${args.affectedUserName}`,
    `Title: ${args.title}`,
    args.category ? `Category: ${args.category}` : null,
    `Severity: ${sev}`,
    `Open for: ${args.daysOpen} day${args.daysOpen === 1 ? "" : "s"}`,
    args.reporterName ? `Reported by: ${args.reporterName}` : null,
    args.actionTaken ? `\nLast action taken:\n${args.actionTaken}` : null,
    ``,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}

// ── Pre-resolution follow-up to the reporting manager ────────────────
// Fires once at ~day 23 (= 30 - 7) of an open / in_progress violation —
// asks the affected employee's reporting manager for a status check:
// improvement seen? Any actions taken? Should this be closed or
// escalated? Distinct from the 15-day "still open" reminder above:
//   • The 15-day reminder goes to HR / admins (org-wide bystanders)
//   • This follow-up goes to the manager who's actually accountable
//     for the person and best placed to give a status update.
// The cron stamps Violation.followUpSentAt so we send only once per
// violation; the violations page renders a "follow-up email sent"
// badge under the Manager row when this is set.
// ── Compliance: missing PAN / Aadhaar / Education ───────────────────
// Two-stage escalation driven by the daily cron in
// src/lib/hr/doc-compliance.ts.
//
// Stage 1 — friendly warning sent only to the employee. Lists which
// specific pieces are missing so they know what to upload. Heading
// avoids the word "violation" (we're not there yet); copy is
// supportive, not punitive.
export function docComplianceWarningEmail(args: {
  employeeName: string;
  missing: string[];        // human-readable list, e.g. ["PAN number", "Aadhaar document"]
}): EmailContent {
  const subject = `Action needed: complete your compliance documents`;
  const link = `${appUrl()}/dashboard/hr/profile`;
  const redDot = `<span style="display:inline-block;width:7px;height:7px;background:#dc2626;border-radius:50%;vertical-align:middle;margin-right:8px"></span>`;
  const missingRows = args.missing.map((m) =>
    `<tr><td style="padding:6px 0;font-family:${FONT};font-size:13px;color:#1f2937">${redDot}${escape(m)}</td></tr>`
  ).join("");
  const body = `
    <p style="margin:0 0 12px;font-size:14px;color:#1f2937;line-height:1.6">
      Hi ${escape(args.employeeName)},
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      A quick reminder — some compliance details are still pending on your profile. Please upload / fill the items below within the next <strong>2 days</strong> to keep your record up to date.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;padding:14px 16px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px">
      <tr><td style="font-family:${FONT};font-size:11px;color:#9a3412;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;padding-bottom:6px">Still missing</td></tr>
      ${missingRows}
    </table>
    <p style="margin:14px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #0f6ecd;border-radius:0 6px 6px 0;font-size:12.5px;color:#475569;line-height:1.55">
      If you've already submitted these on paper, please also upload them in the dashboard — the system needs them on file. If anything looks incorrect, ping HR directly.
    </p>
    ${ctaButton("Open your profile to upload", link)}
  `;
  const text = [
    `Hi ${args.employeeName},`,
    ``,
    `Compliance items still pending on your profile. Please complete within 2 days:`,
    ...args.missing.map((m) => `  • ${m}`),
    ``,
    `Upload them here: ${link}`,
  ].join("\n");
  return { subject, html: SHELL(subject, body), text };
}

// Stage 2 — escalation. Sent to the employee + HR Manager + the
// employee's reporting manager when the auto-violation has just been
// created. Lays out exactly what's still missing, names the violation
// id so HR can find it on the dashboard, and signals to the manager
// that their direct report needs a nudge.
export function docComplianceViolationEmail(args: {
  recipientName: string | null;
  employeeName: string;
  employeeEmail: string;
  missing: string[];
  violationId: number | null;
  hrManagerName: string | null;
  reportingManagerName: string | null;
}): EmailContent {
  const subject = `Compliance violation logged: ${args.employeeName} — missing PAN / Aadhaar / Education`;
  const link = `${appUrl()}/dashboard/strikes${args.violationId ? `?focus=${args.violationId}` : ""}`;
  const redDot = `<span style="display:inline-block;width:7px;height:7px;background:#dc2626;border-radius:50%;vertical-align:middle;margin-right:8px"></span>`;
  const missingRows = args.missing.map((m) =>
    `<tr><td style="padding:6px 0;font-family:${FONT};font-size:13px;color:#1f2937">${redDot}${escape(m)}</td></tr>`
  ).join("");
  const rows: string[] = [];
  rows.push(vRow("Employee", `${escape(args.employeeName)} <${escape(args.employeeEmail)}>`));
  if (args.reportingManagerName) rows.push(vRow("Reporting Manager", escape(args.reportingManagerName)));
  if (args.hrManagerName)        rows.push(vRow("Reported by",        escape(args.hrManagerName)));
  rows.push(vRow("Severity",     `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;background:${SEVERITY_TINT.low.bg};color:${SEVERITY_TINT.low.text}">${escape(SEVERITY_LABEL.low ?? "low")}</span>`));
  rows.push(vRow("Category",     "Compliance"));
  const body = `
    <p style="margin:0 0 12px;font-size:14px;color:#1f2937;line-height:1.6">
      ${args.recipientName ? `Hi ${escape(args.recipientName)},` : "Hi,"}
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      The compliance reminder sent 2 days ago wasn't resolved, so an automatic violation has been logged. Items still missing from <strong>${escape(args.employeeName)}</strong>'s profile:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;padding:14px 16px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px">
      <tr><td style="font-family:${FONT};font-size:11px;color:#991b1b;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;padding-bottom:6px">Missing items</td></tr>
      ${missingRows}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${rows.join("")}
    </table>
    <p style="margin:14px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #6366f1;border-radius:0 6px 6px 0;font-size:12.5px;color:#475569;line-height:1.55">
      Once the missing items are uploaded, the violation can be marked as closed on the dashboard.
    </p>
    ${ctaButton("Open the violation", link)}
  `;
  const text = [
    args.recipientName ? `Hi ${args.recipientName},` : "Hi,",
    ``,
    `A compliance violation has been auto-logged for ${args.employeeName} <${args.employeeEmail}>.`,
    `Still missing:`,
    ...args.missing.map((m) => `  • ${m}`),
    ``,
    args.reportingManagerName ? `Reporting Manager: ${args.reportingManagerName}` : null,
    args.hrManagerName ? `Reported by: ${args.hrManagerName}` : null,
    `Severity: Low`,
    `Category: Compliance`,
    ``,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}

export function violationFollowUpEmail(args: {
  recipientName?: string | null;          // manager's name (greeting)
  affectedUserName: string;               // the reported employee
  title: string;
  daysOpen: number;
  severity: string;
  category?: string | null;
  reporterName?: string | null;
  actionTaken?: string | null;
}): EmailContent {
  const subject = `Follow-up: ${args.affectedUserName}'s violation · ${args.title}`;
  const link = `${appUrl()}/dashboard/strikes`;
  const sev = SEVERITY_LABEL[args.severity] ?? args.severity;
  const sevTint = SEVERITY_TINT[args.severity] ?? SEVERITY_TINT.medium;

  const rows: string[] = [];
  rows.push(vRow("Employee", escape(args.affectedUserName)));
  rows.push(vRow("Title",    escape(args.title)));
  if (args.category)     rows.push(vRow("Category", escape(args.category)));
  rows.push(vRow("Severity", `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;background:${sevTint.bg};color:${sevTint.text}">${escape(sev)}</span>`));
  rows.push(vRow("Open for", `${args.daysOpen} day${args.daysOpen === 1 ? "" : "s"}`));
  if (args.reporterName) rows.push(vRow("Reported by", escape(args.reporterName)));

  // Soft callout — phrased as a manager-facing question, not a "you're
  // behind" warning. The 15-day reminder uses the orange day-counter;
  // this one uses a calmer indigo so HR can tell the two emails apart.
  const callout = `
    <div style="margin:0 0 16px;padding:14px 16px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px">
      <p style="margin:0;font-size:13px;color:#3730a3;line-height:1.55">
        This violation has been open for around <strong>${args.daysOpen} days</strong> and is approaching the 1-month mark. Could you share a quick status update — improvement seen, action taken, or anything that should be flagged?
      </p>
    </div>`;

  const body = `
    <p style="margin:0 0 12px;font-size:14px;color:#1f2937;line-height:1.6">
      ${args.recipientName ? `Hi ${escape(args.recipientName)},` : "Hi,"}
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      A quick check-in on a violation involving someone on your team.
    </p>
    ${callout}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${rows.join("")}
    </table>
    ${args.actionTaken ? sectionCard("Last action taken", args.actionTaken) : ""}
    <p style="margin:20px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #6366f1;border-radius:0 6px 6px 0;font-size:12.5px;color:#475569;line-height:1.55">
      Reply with a brief status, or open the dashboard to add an action / close the violation if the issue's resolved.
    </p>
    ${ctaButton("Open the violation", link)}
  `;
  const text = [
    args.recipientName ? `Hi ${args.recipientName},` : "Hi,",
    `Follow-up on a violation involving ${args.affectedUserName} — open for around ${args.daysOpen} days and approaching the 1-month mark.`,
    ``,
    `Employee: ${args.affectedUserName}`,
    `Title: ${args.title}`,
    args.category ? `Category: ${args.category}` : null,
    `Severity: ${sev}`,
    `Open for: ${args.daysOpen} day${args.daysOpen === 1 ? "" : "s"}`,
    args.reporterName ? `Reported by: ${args.reporterName}` : null,
    args.actionTaken ? `\nLast action taken:\n${args.actionTaken}` : null,
    ``,
    `Could you share a brief status — improvement, action taken, or anything to flag?`,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}

// ── Probation ending soon (7 days out) ───────────────────────────────
// Fires once per employee, ~7 days before EmployeeProfile.probationEndDate.
// Recipients: HR (special_access + role=hr_manager) + the employee's
// reporting manager. The email gives HR a chance to plan the
// confirmation review OR extend probation in one click.
//
// Extension CTAs deep-link to the People page with query params the
// page reads to auto-open the quick-extend modal:
//   ?extendProbation=1m   → +1 month
//   ?extendProbation=2m   → +2 months
//   ?extendProbation=custom → opens the modal with a custom date picker
// HR still has to confirm in the UI — the email itself doesn't mutate
// any data, so accidental clicks don't change probation dates.
export function probationEndingReminderEmail(args: {
  recipientName?: string | null;            // greets the HR person / manager
  employeeName: string;                     // the person on probation
  employeeId?: string | null;               // HRM No.
  joiningDate?: Date | null;
  probationEndDate: Date;                   // when probation ends (required)
  daysRemaining: number;                    // <= 7
  managerName?: string | null;
  department?: string | null;
  /// User ID of the person on probation — used to build the
  /// deep-link to the People page so HR lands directly on the right
  /// employee from the email.
  employeeUserId: number;
}): EmailContent {
  const fmt = (d: Date | null | undefined) =>
    d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
  const subject = `Probation ending soon · ${args.employeeName} (${args.daysRemaining} day${args.daysRemaining === 1 ? "" : "s"})`;

  const peopleLink = (suffix: string) =>
    `${appUrl()}/dashboard/hr/people/${args.employeeUserId}${suffix}`;

  // Header callout — calm indigo (matches the violation follow-up
  // palette so HR can pattern-match "this is a scheduled HR check-in,
  // not a fire").
  const callout = `
    <div style="margin:0 0 16px;padding:16px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;text-align:center">
      <p style="margin:0;font-size:10.5px;color:#3730a3;font-weight:700;text-transform:uppercase;letter-spacing:0.12em">Probation ends in</p>
      <p style="margin:6px 0 0;font-size:32px;font-weight:700;color:#3730a3;line-height:1">${args.daysRemaining}<span style="font-size:14px;font-weight:600;margin-left:4px">day${args.daysRemaining === 1 ? "" : "s"}</span></p>
      <p style="margin:6px 0 0;font-size:11.5px;color:#3730a3">${escape(args.employeeName)} · ends ${fmt(args.probationEndDate)}</p>
    </div>`;

  const rows: string[] = [];
  rows.push(vRow("Employee",      escape(args.employeeName)));
  if (args.employeeId)   rows.push(vRow("HRM No.",    escape(args.employeeId)));
  if (args.department)   rows.push(vRow("Department", escape(args.department)));
  if (args.managerName)  rows.push(vRow("Reporting Manager", escape(args.managerName)));
  if (args.joiningDate)  rows.push(vRow("Joined",     fmt(args.joiningDate)));
  rows.push(vRow("Probation Ends", fmt(args.probationEndDate)));

  // Extension shortcut row — three buttons that deep-link to the
  // People page with the quick-extend modal pre-opened. Stacked
  // vertically for predictable rendering on mobile.
  const extensionCTAs = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;border-collapse:collapse;width:100%">
      <tr>
        <td style="padding:0 0 8px;font-family:${FONT};font-size:11px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Need more time? Extend probation:</td>
      </tr>
      <tr>
        <td style="padding:0">
          <a href="${peopleLink("?extendProbation=1m")}" style="display:inline-block;margin:0 8px 8px 0;background:#ffffff;color:#3730a3;text-decoration:none;font-family:${FONT};font-size:12.5px;font-weight:600;padding:8px 14px;border:1px solid #c7d2fe;border-radius:6px">Extend by 1 month</a>
          <a href="${peopleLink("?extendProbation=2m")}" style="display:inline-block;margin:0 8px 8px 0;background:#ffffff;color:#3730a3;text-decoration:none;font-family:${FONT};font-size:12.5px;font-weight:600;padding:8px 14px;border:1px solid #c7d2fe;border-radius:6px">Extend by 2 months</a>
          <a href="${peopleLink("?extendProbation=custom")}" style="display:inline-block;margin:0 0 8px 0;background:#ffffff;color:#3730a3;text-decoration:none;font-family:${FONT};font-size:12.5px;font-weight:600;padding:8px 14px;border:1px solid #c7d2fe;border-radius:6px">Custom date…</a>
        </td>
      </tr>
    </table>`;

  const body = `
    <p style="margin:0 0 12px;font-size:14px;color:#1f2937;line-height:1.6">
      ${args.recipientName ? `Hi ${escape(args.recipientName)},` : "Hi,"}
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      Heads-up — ${escape(args.employeeName)}'s probation period is wrapping up. A confirmation review (or an extension) should happen before the end date.
    </p>
    ${callout}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${rows.join("")}
    </table>
    ${extensionCTAs}
    <p style="margin:18px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #6366f1;border-radius:0 6px 6px 0;font-size:12.5px;color:#475569;line-height:1.55">
      Extension buttons open the employee's profile with a confirmation modal — they don't change anything until you confirm. Use "Custom date" if you need a specific end date.
    </p>
    ${ctaButton("Open employee profile", peopleLink(""))}
  `;

  const text = [
    args.recipientName ? `Hi ${args.recipientName},` : "Hi,",
    `${args.employeeName}'s probation ends in ${args.daysRemaining} day${args.daysRemaining === 1 ? "" : "s"} (${fmt(args.probationEndDate)}).`,
    ``,
    `Employee: ${args.employeeName}`,
    args.employeeId   ? `HRM No.: ${args.employeeId}` : null,
    args.department   ? `Department: ${args.department}` : null,
    args.managerName  ? `Reporting Manager: ${args.managerName}` : null,
    args.joiningDate  ? `Joined: ${fmt(args.joiningDate)}` : null,
    `Probation Ends: ${fmt(args.probationEndDate)}`,
    ``,
    `Need more time? Extend probation:`,
    `  +1 month  : ${peopleLink("?extendProbation=1m")}`,
    `  +2 months : ${peopleLink("?extendProbation=2m")}`,
    `  Custom    : ${peopleLink("?extendProbation=custom")}`,
    ``,
    `Open profile: ${peopleLink("")}`,
  ].filter(Boolean).join("\n");

  return { subject, html: SHELL(subject, body), text };
}

// ── PIP (Performance Improvement Plan) ending reminder ─────────────────
// Heads-up to a leaving employee (~2 days before their last working day)
// to complete the Exit Survey. CTA → the exit survey form.
export function exitSurveyReminderEmail(args: {
  employeeName: string;
  lastWorkingDay: string; // YYYY-MM-DD
  daysRemaining: number;
}): EmailContent {
  const link = `${appUrl()}/dashboard/hr/exit-survey`;
  const lwd = new Date(`${args.lastWorkingDay}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
  const when = args.daysRemaining <= 0 ? "today" : args.daysRemaining === 1 ? "tomorrow" : `in ${args.daysRemaining} days`;
  const subject = "Please complete your Exit Survey";
  const body = `
    <p style="margin:0 0 12px">Hi ${escape(args.employeeName)},</p>
    <p style="margin:0 0 12px">As your last working day approaches (<strong>${lwd}</strong>, ${when}), we'd really value your honest feedback. Please take a few minutes to complete your <strong>Exit Survey</strong>.</p>
    <p style="margin:0 0 12px">It's required before you clock out on your final day, and your responses go straight to HR to help us improve.</p>
    <p style="margin:16px 0"><a href="${link}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:13.5px;font-weight:600">Complete Exit Survey &rarr;</a></p>
    <p style="margin:0;color:#6b7280;font-size:12px">Thank you for everything &mdash; we wish you the very best.</p>
  `;
  const text = `Hi ${args.employeeName},\n\nAs your last working day approaches (${lwd}, ${when}), please complete your Exit Survey. It's required before clocking out on your final day, and your feedback goes to HR.\n\nComplete it here: ${link}\n\nThank you, and all the best.`;
  return { subject, html: SHELL(subject, body), text };
}

// 7-day heads-up to brand HR + the employee's reporting manager that a
// performance plan's review date is approaching. CTA → My Team → PIP Reviews.
export function pipEndingReminderEmail(args: {
  recipientName?: string | null;
  employeeName: string;
  employeeId?: string | null;
  pipStartedAt?: Date | null;
  pipEndDate: Date;
  daysRemaining: number;
  managerName?: string | null;
  department?: string | null;
  reason?: string | null;
  employeeUserId: number;
}): EmailContent {
  const fmt = (d: Date | null | undefined) =>
    d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
  const subject = `Performance plan review due · ${args.employeeName} (${args.daysRemaining} day${args.daysRemaining === 1 ? "" : "s"})`;

  const reviewLink = `${appUrl()}/dashboard/hr/my-team/pip`;
  const peopleLink = `${appUrl()}/dashboard/hr/people/${args.employeeUserId}`;

  const callout = `
    <div style="margin:0 0 16px;padding:16px;background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;text-align:center">
      <p style="margin:0;font-size:10.5px;color:#9f1239;font-weight:700;text-transform:uppercase;letter-spacing:0.12em">Plan review due in</p>
      <p style="margin:6px 0 0;font-size:32px;font-weight:700;color:#9f1239;line-height:1">${args.daysRemaining}<span style="font-size:14px;font-weight:600;margin-left:4px">day${args.daysRemaining === 1 ? "" : "s"}</span></p>
      <p style="margin:6px 0 0;font-size:11.5px;color:#9f1239">${escape(args.employeeName)} · review by ${fmt(args.pipEndDate)}</p>
    </div>`;

  const rows: string[] = [];
  rows.push(vRow("Employee", escape(args.employeeName)));
  if (args.employeeId)  rows.push(vRow("HRM No.", escape(args.employeeId)));
  if (args.department)  rows.push(vRow("Department", escape(args.department)));
  if (args.managerName) rows.push(vRow("Reporting Manager", escape(args.managerName)));
  if (args.pipStartedAt) rows.push(vRow("Plan started", fmt(args.pipStartedAt)));
  rows.push(vRow("Review date", fmt(args.pipEndDate)));
  if (args.reason) rows.push(vRow("Concern", escape(args.reason)));

  const body = `
    <p style="margin:0 0 12px;font-size:14px;color:#1f2937;line-height:1.6">
      ${args.recipientName ? `Hi ${escape(args.recipientName)},` : "Hi,"}
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      ${escape(args.employeeName)}'s performance improvement plan is approaching its review date. The reporting manager should review it and recommend an outcome — extend, mark as passed, or end employment — for HR approval.
    </p>
    ${callout}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${rows.join("")}
    </table>
    ${ctaButton("Review in My Team → PIP Reviews", reviewLink)}
    <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;line-height:1.55">
      Or open the employee's profile: <a href="${peopleLink}" style="color:#9f1239">${peopleLink}</a>
    </p>
  `;

  const text = [
    args.recipientName ? `Hi ${args.recipientName},` : "Hi,",
    `${args.employeeName}'s performance plan review is due in ${args.daysRemaining} day${args.daysRemaining === 1 ? "" : "s"} (${fmt(args.pipEndDate)}).`,
    ``,
    `Employee: ${args.employeeName}`,
    args.employeeId  ? `HRM No.: ${args.employeeId}` : null,
    args.managerName ? `Reporting Manager: ${args.managerName}` : null,
    args.reason      ? `Concern: ${args.reason}` : null,
    `Review date: ${fmt(args.pipEndDate)}`,
    ``,
    `Review: ${reviewLink}`,
    `Profile: ${peopleLink}`,
  ].filter(Boolean).join("\n");

  return { subject, html: SHELL(subject, body), text };
}

// ── Reporting-manager change applied ───────────────────────────────────
// Sent when a scheduled (effective-dated) reporting-manager change takes
// effect. Goes to the employee, their new manager, and brand HR.
export function managerChangeAppliedEmail(args: {
  recipientName?: string | null;
  employeeName: string;
  employeeId?: string | null;
  oldManagerName?: string | null;
  newManagerName: string;
  effectiveDate: string | Date;
  employeeUserId: number;
}): EmailContent {
  const eff = fmtDate(args.effectiveDate);
  const subject = `Reporting manager updated · ${args.employeeName} → ${args.newManagerName}`;
  const peopleLink = `${appUrl()}/dashboard/hr/people/${args.employeeUserId}`;

  const rows = [
    vRow("Employee", escape(args.employeeName)),
    args.employeeId ? vRow("HRM No.", escape(args.employeeId)) : "",
    args.oldManagerName ? vRow("Previous Manager", escape(args.oldManagerName)) : "",
    vRow("New Reporting Manager", escape(args.newManagerName)),
    vRow("Effective", escape(eff)),
  ].join("");

  const body = `
    <p style="margin:0 0 12px;font-size:14px;color:#1f2937;line-height:1.6">
      ${args.recipientName ? `Hi ${escape(args.recipientName)},` : "Hi,"}
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      A scheduled reporting-line change has taken effect. <strong>${escape(args.employeeName)}</strong> now reports to <strong>${escape(args.newManagerName)}</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${rows}
    </table>
    ${ctaButton("Open employee profile", peopleLink)}
  `;

  const text = [
    args.recipientName ? `Hi ${args.recipientName},` : "Hi,",
    `${args.employeeName} now reports to ${args.newManagerName} (effective ${eff}).`,
    ``,
    `Employee: ${args.employeeName}`,
    args.employeeId ? `HRM No.: ${args.employeeId}` : null,
    args.oldManagerName ? `Previous Manager: ${args.oldManagerName}` : null,
    `New Reporting Manager: ${args.newManagerName}`,
    `Effective: ${eff}`,
    ``,
    `Open profile: ${peopleLink}`,
  ].filter(Boolean).join("\n");

  return { subject, html: SHELL(subject, body), text };
}

// ── POC assignment ────────────────────────────────────────────────────
// Sent to the employee picked as "POC in Absence" on any leave-style
// request (Leave / WFH / On Duty / Half Day / Comp Off). Heads-up that
// they've been named as the backup so they can take over pending work
// + intercept any teams coordinating with the applicant while they're
// out.
export function pocAssignmentEmail(args: {
  pocName: string;
  applicantName: string;
  /** Free-form: "Leave (Casual Leave)" / "Work From Home" / "On Duty" / etc. */
  requestType: string;
  /** Human-readable date or range. "Fri, 22 May 2026" or "22–23 May". */
  dateLabel: string;
  /** Optional. e.g. "2 days". */
  daysLabel?: string;
  /** Pending tasks the applicant left for the POC to cover. */
  workStatus: string;
  /** Why the applicant is out (free text from the form). */
  reason?: string;
}): EmailContent {
  // Subject locked in the design discussion:
  //   "You're the POC for {Name}'s leave (22-23 May)"
  // Generic enough to read naturally for WFH / On Duty too.
  const subject = `You're the POC for ${args.applicantName}'s ${args.requestType.toLowerCase()} (${args.dateLabel})`;
  const link = `${appUrl()}/dashboard/hr/approvals`;

  const banner = `
    <div style="margin:0 0 16px;padding:14px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px">
      <p style="margin:0;font-size:10.5px;color:#1e40af;font-weight:700;text-transform:uppercase;letter-spacing:0.12em">You're the POC</p>
      <p style="margin:6px 0 0;font-size:14px;color:#1f2937;font-weight:600;line-height:1.4">
        ${escape(args.applicantName)} listed you as their point of contact while they're out.
      </p>
    </div>`;

  const rows: string[] = [];
  rows.push(vRow("Request Type", escape(args.requestType)));
  rows.push(vRow("Date",         escape(args.dateLabel)));
  if (args.daysLabel) rows.push(vRow("Duration", escape(args.daysLabel)));
  if (args.reason)    rows.push(vRow("Reason",   escape(args.reason)));

  const body = `
    <p style="margin:0 0 14px;font-size:14px;color:#1f2937;line-height:1.6">
      Hi ${escape(args.pocName)},
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.6">
      A heads-up: <strong>${escape(args.applicantName)}</strong> picked you as
      the named point of contact for their upcoming time away. If teams
      need anything during this window, expect them to reach out to you.
    </p>
    ${banner}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      ${rows.join("")}
    </table>
    ${sectionCard("Work status they left for you", args.workStatus)}
    <p style="margin:20px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #0f6ecd;border-radius:0 6px 6px 0;font-size:12.5px;color:#475569;line-height:1.55">
      You don't need to approve this — the regular L1 / L2 chain still
      processes the request. This is just so you're not surprised.
    </p>
    ${ctaButton("View on dashboard", link)}
  `;
  const text = [
    `Hi ${args.pocName},`,
    `${args.applicantName} listed you as their POC for ${args.requestType} on ${args.dateLabel}${args.daysLabel ? ` (${args.daysLabel})` : ""}.`,
    args.reason ? `\nReason: ${args.reason}` : null,
    `\nWork status they left for you:`,
    args.workStatus,
    ``,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}
