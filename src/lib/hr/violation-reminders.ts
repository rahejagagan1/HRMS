// Sweeps every "in progress" violation. For each one, if 15+ days have
// passed since the violation was created OR the last reminder fired,
// send a fresh reminder to HR / CEO / admins / special_access /
// developers and stamp lastReminderAt = now.
//
// Idempotent — running the cron multiple times within the same 15-day
// window is a no-op for already-reminded rows.
//
// Uses raw SQL for the lastReminderAt-aware queries so the runner is
// independent of `prisma generate` cache state on dev machines.

import prisma from "@/lib/prisma";
import { brandBucket } from "@/lib/notifications";
import { sendEmail } from "@/lib/email/sender";
import { violationInProgressReminderEmail, violationFollowUpEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";
import { isEmailEnabled, devEmailRecipientsClause } from "@/lib/email/toggles";

const REMINDER_INTERVAL_DAYS = 15;
// Follow-up email parameters — fires once per violation at day 23
// (= 30 - 7), so the reporting manager gets a heads-up roughly a week
// before the implicit 1-month resolution mark. Both knobs in one
// place if HR wants to retune later (e.g. severity-based windows).
const FOLLOW_UP_VIOLATION_DURATION_DAYS = 30;
const FOLLOW_UP_LEAD_DAYS = 7;
const FOLLOW_UP_FIRE_AFTER_DAYS = FOLLOW_UP_VIOLATION_DURATION_DAYS - FOLLOW_UP_LEAD_DAYS;

type DueRow = {
    id: number;
    title: string;
    severity: string;
    category: string | null;
    actionTaken: string | null;
    createdAt: Date;
    userId: number | null;
    userName: string | null;
    reporterName: string | null;
};

export async function sendViolationInProgressReminders(): Promise<number> {
    // Admin-controllable kill-switch (Admin → Emails Automation). When
    // disabled, the cron still runs but sends zero emails — no state
    // change, no lastReminderAt stamps, so flipping back ON later picks
    // up exactly where it left off.
    if (!(await isEmailEnabled("violation_reminders"))) {
        console.log("[violation-reminders] skipped — disabled in admin toggles");
        return 0;
    }

    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

    // Pull every in-progress violation whose last reminder is older
    // than the cutoff (or has never been reminded). The OR handles both
    // cases: brand-new in-progress + already-reminded-but-stale.
    const due = await prisma.$queryRawUnsafe<DueRow[]>(
        `SELECT v.id, v.title, v.severity::text AS severity, v.category, v."actionTaken",
                v."createdAt", v."userId",
                u.name AS "userName",
                r.name AS "reporterName"
           FROM "Violation" v
           LEFT JOIN "User" u ON u.id = v."userId"
           LEFT JOIN "User" r ON r.id = v."reportedBy"
          WHERE v.status = 'in_progress'
            AND (
              (v."lastReminderAt" IS NULL AND v."createdAt" <= $1)
              OR v."lastReminderAt" <= $1
            )
          ORDER BY v."createdAt" ASC`,
        cutoff,
    );
    if (due.length === 0) return 0;

    // Recipient list — special_access / admin / hr_manager. The CEO is
    // EXCLUDED here (top-level NOT, because the CEO/owner account also
    // carries role="admin"); they're reminded only about violations of
    // their OWN direct reports, added per-violation below.
    const recipients = await prisma.user.findMany({
        where: {
            isActive: true,
            orgLevel: { not: "ceo" },
            OR: [
                { orgLevel: { in: ["hr_manager", "special_access"] } },
                { role: "admin" },
                { role: "hr_manager" },
                ...(await devEmailRecipientsClause()),
            ],
        },
        select: { name: true, email: true, orgLevel: true, role: true, employeeProfile: { select: { businessUnit: true } } },
    });
    // Apply the per-role email-toggle filter — drops recipients whose
    // role-specific override for "violation_reminders" is OFF.
    const { rolesForUser, isEmailEnabledForRoles } = await import("@/lib/email/toggles");
    const validRecipients: Array<{ name: string | null; email: string; orgLevel: string | null; role: string | null; businessUnit: string | null }> = [];
    for (const r of recipients) {
        if (!r.email) continue;
        const roles = rolesForUser({ orgLevel: r.orgLevel, role: r.role });
        if (!(await isEmailEnabledForRoles("violation_reminders", roles))) continue;
        validRecipients.push({ name: r.name ?? null, email: r.email, orgLevel: r.orgLevel, role: r.role, businessUnit: r.employeeProfile?.businessUnit ?? null });
    }

    // CEO-per-brand lookup: resolve each affected employee's brand and
    // tag the violation with their brand CEO. Wider than direct-manager-
    // only — Kunal sees every YT Labs violation reminder, Nikit sees
    // every NB Media one, regardless of reporting chain.
    const affectedIds = [...new Set(due.map((d) => d.userId).filter((id): id is number => id != null))];
    const ceoByEmployee = new Map<number, { name: string | null; email: string }>();
    const brandByEmployee = new Map<number, "NB Media" | "YT Labs">();
    if (affectedIds.length) {
        const [emps, ceos] = await Promise.all([
            prisma.user.findMany({
                where:  { id: { in: affectedIds } },
                select: { id: true, employeeProfile: { select: { businessUnit: true } } },
            }),
            prisma.user.findMany({
                where: { isActive: true, orgLevel: "ceo" },
                select: {
                    id: true, name: true, email: true,
                    employeeProfile: { select: { businessUnit: true } },
                },
            }),
        ]);
        const ceoByBrand = new Map<string, { name: string | null; email: string }>();
        for (const c of ceos) {
            if (!c.email) continue;
            const bu = c.employeeProfile?.businessUnit || "NB Media";
            ceoByBrand.set(bu, { name: c.name, email: c.email });
        }
        for (const e of emps) {
            const bu = e.employeeProfile?.businessUnit || "NB Media";
            brandByEmployee.set(e.id, brandBucket(bu));
            const ceo = ceoByBrand.get(bu);
            if (ceo) ceoByEmployee.set(e.id, ceo);
        }
    }
    if (validRecipients.length === 0 && ceoByEmployee.size === 0) return 0;

    let processed = 0;
    for (const v of due) {
        const daysOpen = Math.max(
            1,
            Math.floor((Date.now() - new Date(v.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
        );
        // Base recipients (HR / special_access / admin) plus the CEO only
        // when this violation is about one of their own direct reports.
        // The per-violation CEO entry is the DIRECT-REPORT exemption —
        // always sent regardless of the per-role "ceo" toggle, because
        // the toggle only silences BLANKET fan-out. The HR / special /
        // admin recipients above ARE filtered by their per-role toggle
        // (see the validRecipients loop earlier in this file).
        const ceo = v.userId != null ? ceoByEmployee.get(v.userId) : undefined;
        // Brand-scope HR recipients to this violation's employee brand; CEO already per-brand.
        const empBrand = v.userId != null ? (brandByEmployee.get(v.userId) ?? "NB Media") : "NB Media";
        const brandRecipients = validRecipients.filter((r) => brandBucket(r.businessUnit) === empBrand);
        const violationRecipients = ceo ? [...brandRecipients, ceo] : brandRecipients;
        // Send one mail per recipient — keeps the salutation personal
        // and avoids exposing the recipient list in the To header.
        for (const r of violationRecipients) {
            try {
                await sendEmail({
                    to: r.email!,
                    content: violationInProgressReminderEmail({
                        recipientName:    r.name ?? null,
                        affectedUserName: v.userName || "an employee",
                        title:            v.title,
                        daysOpen,
                        severity:         v.severity,
                        category:         v.category,
                        reporterName:     v.reporterName,
                        actionTaken:      v.actionTaken,
                    }),
                });
            } catch (e) {
                console.warn("[violation-reminder] mail failed:", r.email, e);
            }
        }

        // Skip the lastReminderAt stamp in dry-run so dev testing
        // doesn't lock the row out of further reminder cycles.
        if (!isDryRun()) {
            await prisma.$executeRawUnsafe(
                `UPDATE "Violation" SET "lastReminderAt" = NOW() WHERE id = $1`,
                v.id,
            );
        }
        processed++;
    }
    return processed;
}

// ── Pre-resolution follow-up to the reporting manager ────────────────
// Sweeps every open / in_progress violation that's been around for
// FOLLOW_UP_FIRE_AFTER_DAYS days AND hasn't had its follow-up email
// stamped yet. For each one we look up the AFFECTED EMPLOYEE'S reporting
// manager (User.managerId) — NOT the violation's reportedBy or
// responsiblePersonId, which can be HR — and email them asking for a
// status check before the implicit 1-month resolution window closes.
// One mail per violation per manager; the followUpSentAt stamp keeps
// the cron idempotent across reruns.
type FollowUpRow = {
    id: number;
    title: string;
    severity: string;
    category: string | null;
    actionTaken: string | null;
    createdAt: Date;
    userId: number | null;
    userName: string | null;
    reporterName: string | null;
    managerId: number | null;
    managerName: string | null;
    managerEmail: string | null;
};

export async function sendViolationFollowUpReminders(): Promise<number> {
    if (!(await isEmailEnabled("violation_reminders"))) {
        console.log("[violation-followup] skipped — disabled in admin toggles");
        return 0;
    }

    // "Old enough to need a follow-up" cutoff: createdAt <= NOW() - 23 days.
    const cutoff = new Date(Date.now() - FOLLOW_UP_FIRE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    // Pull every open / in_progress violation past the cutoff that hasn't
    // had its follow-up sent yet. Join the affected employee's manager
    // in one shot so we can route by managerId without a per-row query.
    const due = await prisma.$queryRawUnsafe<FollowUpRow[]>(
        `SELECT v.id, v.title, v.severity::text AS severity, v.category, v."actionTaken",
                v."createdAt", v."userId",
                u.name  AS "userName",
                r.name  AS "reporterName",
                u."managerId" AS "managerId",
                m.name  AS "managerName",
                m.email AS "managerEmail"
           FROM "Violation" v
           LEFT JOIN "User" u ON u.id = v."userId"
           LEFT JOIN "User" r ON r.id = v."reportedBy"
           LEFT JOIN "User" m ON m.id = u."managerId"
          WHERE v.status IN ('open', 'in_progress')
            AND v."followUpSentAt" IS NULL
            AND v."createdAt" <= $1
          ORDER BY v."createdAt" ASC`,
        cutoff,
    );
    if (due.length === 0) return 0;

    let processed = 0;
    for (const v of due) {
        // No reporting manager on file → skip + log. We don't fall back
        // to HR / CEO because the whole point of THIS reminder is to
        // engage the manager accountable for the person; the org-wide
        // bystanders already get the 15-day reminder above.
        if (!v.managerId || !v.managerEmail) {
            console.warn(`[violation-followup] violation #${v.id} (${v.userName ?? "?"}) has no reporting manager — skipping`);
            continue;
        }

        const daysOpen = Math.max(
            1,
            Math.floor((Date.now() - new Date(v.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
        );

        try {
            await sendEmail({
                to: v.managerEmail,
                content: violationFollowUpEmail({
                    recipientName:    v.managerName ?? null,
                    affectedUserName: v.userName || "an employee",
                    title:            v.title,
                    daysOpen,
                    severity:         v.severity,
                    category:         v.category,
                    reporterName:     v.reporterName,
                    actionTaken:      v.actionTaken,
                }),
            });
        } catch (e) {
            console.warn("[violation-followup] mail failed:", v.managerEmail, e);
            // Don't stamp on send failure — let the next cron tick retry.
            continue;
        }

        // Stamp so the cron never re-sends for this violation. Skip in
        // dry-run so dev testing doesn't permanently mark prod rows.
        if (!isDryRun()) {
            await prisma.$executeRawUnsafe(
                `UPDATE "Violation" SET "followUpSentAt" = NOW() WHERE id = $1`,
                v.id,
            );
        }
        processed++;
    }
    return processed;
}
