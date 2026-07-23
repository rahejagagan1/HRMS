import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";
import { canApplyRestrictedLeave } from "@/lib/access";
import { notifyUsers, brandCeoIdForEmployee, brandScopedFinalApprovers } from "@/lib/notifications";
import { countWorkingDays } from "@/lib/hr/working-days";
import { checkPastDateAllowed } from "@/lib/hr/leave-date-rules";
import { sendEmail } from "@/lib/email/sender";
import { pocAssignmentEmail } from "@/lib/email/templates";

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

    // Half-day requests carry a marker in the reason field — the apply form
    // adds `[Half Day]`, `[First Half]`, or `[Second Half]` so the API
    // doesn't need a separate column. When present, the request only ever
    // covers a single calendar date and counts as 0.5 days.
    const isHalfDay = /^\s*\[(Half Day|First Half|Second Half)\]/i.test(String(reason ?? ""));
    let totalDays = isHalfDay
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
        if (onBehalf && useLwpFallback) {
          const fb = await switchToLwp();
          if (fb) return fb;
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
    const leaveHalf = (txt: string | null | undefined): "first" | "second" | null => {
      const m = /^\s*\[(First Half|Second Half)\]/i.exec(String(txt ?? ""));
      return m ? (/first/i.test(m[1]) ? "first" : "second") : null;
    };
    const newHalf = leaveHalf(reason);
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
      const oHalf = leaveHalf(o.reason);
      const oSingleDay = new Date(o.fromDate).toDateString() === new Date(o.toDate).toDateString();
      const sameDate = new Date(o.fromDate).toDateString() === from.toDateString();
      // Opposite halves of the same single day → not a conflict.
      if (newHalf && oHalf && newSingleDay && oSingleDay && sameDate &&
          ((newHalf === "first" && oHalf === "second") || (newHalf === "second" && oHalf === "first"))) {
        return false;
      }
      return true;
    });
    if (realConflict) return NextResponse.json({ error: "Overlapping leave exists" }, { status: 400 });

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

    return NextResponse.json(application);
  } catch (e) { return serverError(e, "POST /api/hr/leaves"); }
}
