import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";
import { canApplyRestrictedLeave } from "@/lib/access";
import { notifyUsers, brandCeoIdForEmployee, brandScopedFinalApprovers } from "@/lib/notifications";
import { countWorkingDays } from "@/lib/hr/working-days";
import { checkPastDateAllowed, checkNoticePeriod } from "@/lib/hr/leave-date-rules";
import { sendEmail } from "@/lib/email/sender";
import { pocAssignmentEmail } from "@/lib/email/templates";
import {
  isShortLeaveReason, shortLeaveSlot, SHORT_LEAVE_DAYS,
  SHORT_LEAVE_MONTHLY_CAP, MIN_SHORT_LEAVE_BAR_MIN, type ShortLeaveSlot,
} from "@/lib/hr/short-leave";
import { dayBars } from "@/lib/hr/day-rules";
import { istMonthRange } from "@/lib/ist-date";

// GET /api/hr/leaves — list leave applications
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    const isAdmin = isHRAdmin(self);
    const view = searchParams.get("view") || "my";
    const userIdParam = searchParams.get("userId");
    const targetUserId = Number(userIdParam);

    let where: any = {};
    if (isAdmin && userIdParam && Number.isFinite(targetUserId)) {
      // HR-admin viewing ONE employee's applications — powers the read-only
      // leave view on the employee profile (Attendance → Leave). Guarded so a
      // malformed ?userId= falls through instead of throwing on NaN.
      where.userId = targetUserId;
    } else if (view === "all") {
      // HR-admin only — full org-wide view used by the admin Leaves panel.
      if (!isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // No userId filter — admin sees everyone.
    } else if (view === "team") {
      if (isAdmin) {
        // admin sees all teams
      } else {
        const team = await prisma.user.findMany({ where: { managerId: myId }, select: { id: true } });
        where.userId = { in: team.map((u) => u.id) };
      }
    } else {
      where.userId = myId;
    }
    const status = searchParams.get("status");
    if (status) where.status = status;

    // Brand isolation — a single-brand HR Manager only sees their own
    // brand's applications; developers / allowlisted (canViewAllBrands)
    // see all. Applied ONLY to the admin multi-user paths: the self
    // (view=my) and non-admin team paths are already user-scoped, and
    // an employee with no businessUnit must still see their own leaves,
    // so we must not fail-closed there.
    if (isAdmin) {
      const scope = getBrandScope(self);
      if (!scope.allBrands) {
        if (!scope.brand) return NextResponse.json([]); // fail closed
        where.user = { ...(where.user ?? {}), employeeProfile: { businessUnit: scope.brand } };
      }
    }

    const applications = await prisma.leaveApplication.findMany({
      where, include: {
        leaveType: true,
        user: { select: { id: true, name: true, email: true, profilePictureUrl: true } },
        approver: { select: { id: true, name: true } },
        finalApprover: { select: { id: true, name: true } },
      },
      // Admin view loads the full history; per-user view stays paginated at 100.
      orderBy: { appliedAt: "desc" },
      take: view === "all" ? 500 : 100,
    });
    return NextResponse.json(applications);
  } catch (e) { return serverError(e, "GET /api/hr/leaves"); }
}

// POST /api/hr/leaves — apply for leave
//
// Self-apply (default): creates a `pending` request that flows through L1/L2.
// HR-admin "apply on behalf" (when `targetUserId` is set + caller is HR admin):
//   • Allows ANY active leave type (including LWP) regardless of the
//     subject's existing balance rows.
//   • If `useLwpFallback: true` and the subject's chosen-type balance is
//     missing OR insufficient, auto-switches to Leave Without Pay so the
//     request still goes through without manual back-and-forth.
//   • Routed through the same L1 (manager) → L2 (CEO/HR) queue as a
//     self-applied leave — i.e. it lands as `pending`, not auto-approved.
//     Originally HR-on-behalf was auto-approved, but HR asked to keep
//     every leave on the same approval flow so nothing slips past the
//     direct manager. The subject is notified that HR filed it for them.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const body = await req.json();
    const fromDate = body.fromDate, toDate = body.toDate, reason = body.reason;
    const notifyUserIds = body.notifyUserIds;
    let leaveTypeId = Number(body.leaveTypeId);
    const targetUserId    = typeof body.targetUserId === "number" ? body.targetUserId : null;
    const useLwpFallback  = body.useLwpFallback === true;
    const callerIsHRAdmin = isHRAdmin(self);
    const onBehalf        = targetUserId !== null && targetUserId !== myId;
    if (onBehalf && !callerIsHRAdmin) {
      return NextResponse.json(
        { error: "Only HR admins can apply for leave on behalf of another user." },
        { status: 403 },
      );
    }
    const subjectUserId = onBehalf ? targetUserId! : myId;

    // Short leave forces Casual Leave server-side, so the client needn't send
    // a leaveTypeId for it — only the marker in `reason`. Every other leave
    // still requires an explicit type.
    // Short leave now picks its leave type like any other leave (2026-07-25) —
    // the client always sends a leaveTypeId; short leave just changes the
    // amount (0.25), single-day shape, monthly cap, and attendance excuse.
    const wantShortLeave = isShortLeaveReason(reason);
    if (!leaveTypeId || !fromDate || !toDate || !reason)
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    const from = new Date(fromDate), to = new Date(toDate);
    if (from > to) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

    // Past-date gate: regular users can't back-date leave. CEO /
    // role=hr_manager / isDeveloper (canApplyRestrictedLeave) can.
    const pastErr = checkPastDateAllowed(fromDate, self);
    if (pastErr) return NextResponse.json({ error: pastErr }, { status: 400 });

    // Handoff fields — workStatus is always required. POC is N/A-able:
    // the form has a "Mark as N/A" toggle for cases where no specific
    // cover is assigned, and sends pocUserId=null. When a POC is named,
    // it has to be a real active user — picking someone offboarded is
    // a sign of stale UI state, so we reject those.
    // Coerce defensively: Number(null) === 0 and Number.isFinite(0) === true,
    // so a missing/N/A POC would otherwise become userId 0 and fail the FK.
    const pocUserId  = Number.isInteger(Number(body.pocUserId)) && Number(body.pocUserId) > 0 ? Number(body.pocUserId) : null;
    const workStatus = typeof body.workStatus === "string" ? body.workStatus.trim() : "";
    if (!workStatus) return NextResponse.json({ error: "Work Status is required." }, { status: 400 });
    const pocUser = pocUserId
      ? await prisma.user.findUnique({
          where: { id: pocUserId },
          select: { id: true, name: true, email: true, isActive: true },
        })
      : null;
    if (pocUserId && (!pocUser || !pocUser.isActive)) {
      return NextResponse.json({ error: "Selected POC is not an active employee." }, { status: 400 });
    }

    // Block balance-only types (e.g. Carry Over Leave) — the UI hides
    // them but a hand-crafted POST would otherwise sneak through.
    let leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType || !leaveType.isActive) {
      return NextResponse.json({ error: "Unknown leave type" }, { status: 400 });
    }
    if (leaveType.applicable === false) {
      return NextResponse.json({ error: "This leave type is not applicable — balance is encashed at exit." }, { status: 400 });
    }
    // Restricted-admin leave types (e.g. Carry Over Leave) — applyable
    // only by the tightest admin tier: CEO / role=hr_manager /
    // isDeveloper. Explicitly excludes special_access + role=admin so
    // the gate matches the leadership intent for sensitive balances.
    if ((leaveType as any).adminOnly === true && !canApplyRestrictedLeave(self)) {
      return NextResponse.json(
        { error: "This leave type can only be applied by HR Manager, CEO, or a developer." },
        { status: 403 },
      );
    }
    // Advance-notice gate (2026-08-25): Casual Leave must be applied at
    // least 2 days before its start date (see NOTICE_DAYS_BY_TYPE). Short
    // leaves are exempt (same-day 2h by design); the back-dating tier
    // (HR dept / CEO / developer) is exempt so urgent on-behalf filings
    // still go through.
    const noticeErr = checkNoticePeriod(fromDate, self, leaveType.code, {
      shortLeave: wantShortLeave,
      typeName: leaveType.name,
    });
    if (noticeErr) return NextResponse.json({ error: noticeErr }, { status: 400 });
    // ── Short Leave (2026-07-24) ────────────────────────────────────────
    // A 2-hour leave costing 0.25 CL, tagged in the reason as
    // "[Short Leave - Morning/Evening]". When detected we FORCE the type to
    // Casual Leave regardless of what the client sent, and validate the
    // slot + single-day shape here. The remaining short-leave rules (shift
    // required, monthly cap, 0.25 amount) are enforced further below where
    // the shift + balance are already in hand.
    // Short leave draws from whatever applicable type the employee chose
    // (leaveType already resolved + validated above). Here we only enforce
    // its shape: a valid slot and a single day.
    const shortLeave = wantShortLeave;
    let shortSlot: ShortLeaveSlot | null = null;
    if (shortLeave) {
      shortSlot = shortLeaveSlot(reason);
      if (!shortSlot) {
        return NextResponse.json({ error: "Pick a Morning or Evening slot for the short leave." }, { status: 400 });
      }
      if (from.toDateString() !== to.toDateString()) {
        return NextResponse.json({ error: "A short leave is for a single day." }, { status: 400 });
      }
    }

    // Floater Leave is date-locked to the optional-holiday calendar
    // (2026-07-22): it can ONLY be taken on dates listed with
    // type="optional" (Pongal, Raksha Bandhan, …). The lock is
    // one-directional — other leave types stay applicable on those days,
    // which remain ordinary working days for everyone who doesn't book
    // the floater. Matched by code "FL" with a name fallback.
    const isFloater = leaveType.code === "FL" || /floater/i.test(leaveType.name);
    if (isFloater) {
      const optionals = await prisma.holidayCalendar.findMany({
        where: { type: "optional", date: { gte: from, lte: to } },
        select: { date: true },
      });
      const optionalSet = new Set(optionals.map((h) => h.date.toISOString().slice(0, 10)));
      // EVERY calendar day in the requested range must be an optional
      // holiday — in practice a floater is a single such date.
      let allOptional = true;
      const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
      const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
      while (cur.getTime() <= end) {
        if (!optionalSet.has(cur.toISOString().slice(0, 10))) { allOptional = false; break; }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      if (!allOptional) {
        const upcoming = await prisma.holidayCalendar.findMany({
          where: { type: "optional", date: { gte: new Date() } },
          orderBy: { date: "asc" },
          take: 4,
          select: { date: true, name: true },
        });
        const hint = upcoming
          .map((h) => `${h.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} (${h.name.split("/")[0].trim()})`)
          .join(", ");
        return NextResponse.json(
          { error: `Floater Leave can only be taken on an optional-holiday date.${hint ? ` Upcoming: ${hint}.` : ""}` },
          { status: 400 },
        );
      }
    }

    // Note: we intentionally do NOT gate applications by user.leavePolicyId.
    // HR manages balances manually in the Leave Balances matrix and can
    // grant any type to any user; the balance check below is the canonical
    // "do you have enough days" guard. Policy only drives monthly accrual.

    // Count leave days against the SUBJECT's own shift calendar, not a flat
    // Mon–Fri week. This is what makes alternate-Saturday shifts behave
    // correctly: an NB employee whose shift works that Saturday gets the day
    // counted (and debited), while a 5-day YT employee still has every
    // Saturday treated as non-working. effectiveFrom anchors the
    // alternate-Saturday phase; both fall back to Mon–Fri when no shift is
    // assigned.
    const subjectShift = await prisma.userShift.findUnique({
      where: { userId: subjectUserId },
      include: { shift: true },
    });

    // Short leave needs a shift — the excused 2-hour window is computed from
    // the employee's own shift start/end + grace. No shift → block with the
    // agreed message so HR knows to assign one.
    if (shortLeave && !subjectShift?.shift) {
      return NextResponse.json(
        { error: "Shift not assigned — please contact the HR department." },
        { status: 400 },
      );
    }

    // Short leave needs a long-enough day: the day's full bar (Saturday-aware
    // — a 6h working Saturday's bar is 6h) must leave at least 2h of real
    // work after the 2h excuse. Blocks short leave on e.g. a 2–3h Saturday.
    if (shortLeave) {
      const bar = dayBars(from, subjectShift!.shift as any).full;
      if (bar < MIN_SHORT_LEAVE_BAR_MIN) {
        return NextResponse.json(
          { error: `This day's shift is only ${Math.round(bar / 60 * 10) / 10}h — too short for a 2-hour short leave (needs a ${MIN_SHORT_LEAVE_BAR_MIN / 60}h+ day).` },
          { status: 400 },
        );
      }
    }

    // Short leave — max SHORT_LEAVE_MONTHLY_CAP per calendar month per person.
    // Count the subject's live short leaves (pending / partially_approved /
    // approved) in the requested date's IST month, detected by marker.
    if (shortLeave) {
      const { start, end } = istMonthRange(from);
      const monthRows = await prisma.leaveApplication.findMany({
        where: {
          userId: subjectUserId,
          status: { in: ["pending", "partially_approved", "approved"] },
          fromDate: { gte: start, lte: end },
        },
        select: { reason: true },
      });
      const used = monthRows.filter((r) => isShortLeaveReason(r.reason)).length;
      if (used >= SHORT_LEAVE_MONTHLY_CAP) {
        const monthLabel = start.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
        return NextResponse.json(
          { error: `Short leave limit reached — ${used} of ${SHORT_LEAVE_MONTHLY_CAP} used for ${monthLabel}.` },
          { status: 400 },
        );
      }
    }

    // Half-day requests carry a marker in the reason field — the apply form
    // adds `[Half Day]`, `[First Half]`, or `[Second Half]` so the API
    // doesn't need a separate column. When present, the request only ever
    // covers a single calendar date and counts as 0.5 days.
    const isHalfDay = /^\s*\[(Half Day|First Half|Second Half)\]/i.test(String(reason ?? ""));
    let totalDays = shortLeave
      ? SHORT_LEAVE_DAYS
      : isHalfDay
        ? 0.5
        : await countWorkingDays(from, to, subjectShift?.shift, subjectShift?.effectiveFrom);
    if (totalDays === 0) return NextResponse.json({ error: "Selected dates are all non-working days / holidays for this shift" }, { status: 400 });

    const year = from.getFullYear();
    // Look up the subject's balance for the chosen type. May be missing
    // (e.g. LWP never has a default row) — that's handled below.
    let balance = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: subjectUserId, leaveTypeId, year } },
    });
    const isLwp = leaveType.code === "LWP";

    // Helper: switch the application to Leave Without Pay, upserting a
    // zero-totalDays balance row if needed so the usual increment math works.
    async function switchToLwp() {
      const lwp = await prisma.leaveType.findUnique({ where: { code: "LWP" } });
      if (!lwp || !lwp.isActive) {
        return NextResponse.json({ error: "Leave Without Pay type is not configured." }, { status: 400 });
      }
      leaveType   = lwp;
      leaveTypeId = lwp.id;
      balance = await prisma.leaveBalance.upsert({
        where:  { userId_leaveTypeId_year: { userId: subjectUserId, leaveTypeId, year } },
        create: { userId: subjectUserId, leaveTypeId, year, totalDays: 0, usedDays: 0, pendingDays: 0 },
        update: {},
      });
      return null;
    }

    if (!balance) {
      // No row at all. LWP intentionally has no default rows — upsert one.
      // Other types: only HR admin gets the LWP-fallback path.
      if (isLwp) {
        await switchToLwp();
      } else if (onBehalf && useLwpFallback) {
        const fb = await switchToLwp();
        if (fb) return fb;
      } else {
        return NextResponse.json({ error: "No leave balance found. Contact HR." }, { status: 400 });
      }
    } else if (!isLwp) {
      // Standard balance check. HR-admin-on-behalf with LWP fallback can
      // bypass by switching to LWP; everyone else has to stay within their
      // balance.
      const available = parseFloat(balance.totalDays.toString())
                      - parseFloat(balance.usedDays.toString())
                      - parseFloat(balance.pendingDays.toString());
      if (totalDays > available) {
        // Short leave never falls back to LWP — if CL is below 0.25 it's
        // simply blocked (agreed rule). Everyone else keeps the on-behalf
        // LWP-fallback path.
        if (onBehalf && useLwpFallback && !shortLeave) {
          const fb = await switchToLwp();
          if (fb) return fb;
        } else if (shortLeave) {
          return NextResponse.json({ error: `Not enough ${leaveType.name} for a short leave — need 0.25, have ${available}.` }, { status: 400 });
        } else {
          return NextResponse.json({ error: `Insufficient balance. Available: ${available}, requested: ${totalDays}` }, { status: 400 });
        }
      }
    }

    // Overlap guard. A plain date-range overlap isn't always a real clash:
    // a First-Half and a Second-Half leave on the SAME calendar day are
    // complementary, not overlapping. The half is encoded as a "[First Half]"
    // / "[Second Half]" marker in the reason (no dedicated column), so we
    // parse it to let the two halves of one day coexist while still blocking
    // every genuine overlap (full days, duplicate halves, multi-day ranges,
    // generic [Half Day] which carries no specific half).
    // A day-segment for each booking: full day, first/second half, or a
    // short-leave morning/evening slot. Two single-day bookings only coexist
    // when their segments are non-overlapping complements — {first,second}
    // or {sl-morning,sl-evening}. So an employee can take BOTH a morning and
    // an evening short leave on the same day, but a short leave never stacks
    // onto a half/full-day leave (or a duplicate slot).
    const segOf = (txt: string | null | undefined): "full" | "first" | "second" | "sl-morning" | "sl-evening" => {
      if (isShortLeaveReason(txt)) return shortLeaveSlot(txt) === "evening" ? "sl-evening" : "sl-morning";
      const m = /^\s*\[(First Half|Second Half)\]/i.exec(String(txt ?? ""));
      if (m) return /first/i.test(m[1]) ? "first" : "second";
      return "full";
    };
    const COMPLEMENTS = new Set(["first|second", "second|first", "sl-morning|sl-evening", "sl-evening|sl-morning"]);
    const newSeg = segOf(reason);
    const newSingleDay = from.toDateString() === to.toDateString();
    const overlaps = await prisma.leaveApplication.findMany({
      // Include "partially_approved" — a leave that's cleared L1 but not yet L2
      // is still a live booking. Omitting it left a blind spot where a second
      // overlapping leave could be filed in the L1→L2 window (produced real
      // duplicate LWP double-counted in payroll).
      where: { userId: subjectUserId, status: { in: ["pending", "partially_approved", "approved"] }, fromDate: { lte: to }, toDate: { gte: from } },
      select: { fromDate: true, toDate: true, reason: true },
    });
    const realConflict = overlaps.some((o) => {
      const oSeg = segOf(o.reason);
      const oSingleDay = new Date(o.fromDate).toDateString() === new Date(o.toDate).toDateString();
      const sameDate = new Date(o.fromDate).toDateString() === from.toDateString();
      // Complementary segments on the same single day → not a conflict.
      if (newSingleDay && oSingleDay && sameDate && COMPLEMENTS.has(`${newSeg}|${oSeg}`)) {
        return false;
      }
      return true;
    });
    if (realConflict) {
      return NextResponse.json(
        { error: shortLeave ? "You already have leave booked for this slot / day." : "Overlapping leave exists" },
        { status: 400 },
      );
    }

    // Every leave starts as "pending" — including HR applying on behalf
    // of someone else. The on-behalf path used to auto-approve, but HR
    // now wants it routed through the same L1 (manager) → L2 (CEO/HR)
    // approval queue as a self-applied leave so nothing slips past the
    // direct manager.
    const finalStatus = "pending";

    const application = await prisma.$transaction(async (tx) => {
      // pocUserId / workStatus may be unknown to the typed client until
      // `prisma generate` reruns (Windows DLL lock blocks regen on the
      // dev box) — runtime is fine because the migration already added
      // both columns. `as any` keeps TypeScript happy without losing
      // anything at runtime.
      const app = await tx.leaveApplication.create({
        data: ({
          userId: subjectUserId, leaveTypeId, fromDate: from, toDate: to, totalDays, reason,
          status: finalStatus,
          notifyUserIds: extras,
          pocUserId, workStatus,
        } as any),
        include: { leaveType: true, user: { select: { managerId: true, name: true } } },
      });
      // Balance debit: reserve as `pending`. It moves to `used` when the
      // request is finalised by L2 (or when the CEO direct-approve
      // fast-path fires in /api/hr/leaves/[id] PUT).
      await tx.leaveBalance.update({
        where: { userId_leaveTypeId_year: { userId: subjectUserId, leaveTypeId, year } },
        data:  { pendingDays: { increment: totalDays } },
      });
      return app;
    });

    // ── Post-commit, best-effort from here (2026-08-25) ────────────────
    // The leave row + pending-balance debit are COMMITTED above. Anything
    // below is notifications/emails — a failure here used to bubble to the
    // catch and 500 the request, so the client's apply popup stayed open
    // showing a failure while the leave was actually filed (reported on
    // the HR on-behalf flow). Log and still return the created leave.
    try {
    // Initial notification recipients: the applicant's direct manager (L1
    // approver), every CEO / HR manager (L2 final approvers), and anyone
    // the applicant tagged in the "Notify" picker. HR/CEO are included
    // up-front so they see every new leave immediately rather than only
    // after the manager forwards via L1 approval. Developer accounts are
    // conditional on the "Notify developers" toggle in Admin → Emails
    // Automation — default ON.
    const requesterName = application.user?.name || "An employee";
    const managerId = application.user?.managerId ?? null;
    // Brand-CEO routing: drop blanket CEOs from the HR pool and re-
    // add the applicant's brand CEO separately. This keeps Kunal off
    // every NB Media leave (and vice versa) instead of the old
    // "every active CEO sees every leave" behaviour.
    const [finalApprovers, brandCeoId] = await Promise.all([
      brandScopedFinalApprovers(subjectUserId),
      brandCeoIdForEmployee(subjectUserId),
    ]);
    const dateLabel = `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    const daysLabel = `${totalDays} day${totalDays === 1 ? "" : "s"}`;
    const typeName  = application.leaveType?.name || "leave";

    // Approval-queue ping: L1 manager + L2 approvers (brand-scoped) +
    // any tagged extras. On the HR-on-behalf path we ALSO ping the
    // subject so they know HR filed it for them, and skip the HR
    // caller from the L2 list to avoid notifying themselves.
    const approverRecipients = Array.from(new Set([
      ...(managerId ? [managerId] : []),
      ...finalApprovers.map((u) => u.id).filter((id) => id !== myId),
      ...(brandCeoId && brandCeoId !== myId ? [brandCeoId] : []),
      ...extras,
    ]));
    // Structured email payload — feeds the leave type, real dates, total
    // days, half-day flag, and reason into the templated email so the
    // notification renders concrete details instead of placeholders.
    const leaveEmailData = {
      applicantName: requesterName,
      leaveType:     typeName,
      fromDate:      from,
      toDate:        to,
      totalDays,
      isHalfDay,
      reason:        reason || undefined,
    };
    await notifyUsers({
      actorId:  myId,
      userIds:  approverRecipients,
      type:     "leave",
      entityId: application.id,
      title:    onBehalf
        ? `HR applied ${typeName} for ${requesterName} — awaiting manager approval`
        : `${requesterName} requested ${typeName}`,
      body:     `${dateLabel} (${daysLabel}) — awaiting manager approval.`,
      linkUrl:  "/dashboard/hr/approvals",
      emailData: leaveEmailData,
    });
    if (onBehalf) {
      // Heads-up to the subject so they know a leave was filed for them.
      await notifyUsers({
        actorId:  myId,
        userIds:  [subjectUserId],
        type:     "leave",
        entityId: application.id,
        title:    `HR applied ${typeName} for you`,
        body:     `${dateLabel} (${daysLabel}) — awaiting manager approval.`,
        linkUrl:  "/dashboard/hr/leaves",
        emailData: leaveEmailData,
      });
    }

    // POC heads-up — separate from the approver chain so the named
    // backup gets notified even if approvers haven't actioned the
    // request yet. Fire-and-forget so SMTP hiccups don't 500 the save.
    // When POC is N/A (HR on-behalf), pocUser is null — skip the email.
    if (pocUser && pocUser.email && pocUserId !== subjectUserId) {
      void sendEmail({
        to: pocUser.email,
        content: pocAssignmentEmail({
          pocName:        pocUser.name || "there",
          applicantName:  requesterName,
          requestType:    `Leave (${typeName})`,
          dateLabel,
          daysLabel,
          workStatus,
          reason:         reason || undefined,
        }),
      });
    }
    } catch (notifyErr) {
      console.error("[POST /api/hr/leaves] post-create notifications failed (leave saved):", notifyErr);
    }

    return NextResponse.json(application);
  } catch (e) { return serverError(e, "POST /api/hr/leaves"); }
}
