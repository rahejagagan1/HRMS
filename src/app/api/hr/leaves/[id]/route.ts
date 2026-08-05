import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyUsers, brandCeoIdForEmployee, brandScopedFinalApprovers } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit-log";
import { countWorkingDays } from "@/lib/hr/working-days";
import { assertSameBrandOrSuperAdmin } from "@/lib/hr/cross-brand-guard";
import { refundLopLwp } from "@/lib/hr/lop-lwp";
import { isSingleStageApprovalEmployee } from "@/lib/hr/single-stage-approval";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";
import {
  isShortLeaveReason, shortLeaveSlot, SHORT_LEAVE_DAYS, SHORT_LEAVE_MONTHLY_CAP,
  SHORT_LEAVE_MINUTES, shortLeaveDayState, resolveShortLeaveDayStatus,
} from "@/lib/hr/short-leave";
import { dayBars, lateCutoffMinFor } from "@/lib/hr/day-rules";
import { istMonthRange } from "@/lib/ist-date";

// After approving a HALF-day leave: if the OTHER half of the same date is
// also covered by an approved leave, the whole day is now leave — mark it
// on_leave and refund any auto-LOP. A single half never touches attendance
// (the working half must earn its own outcome — see the isHalfDay guards
// below), but two approved halves together earn the full-day treatment.
async function settleFullyCoveredHalfDay(
  userId: number, dateOnly: Date, thisReason: string | null | undefined, thisAppId: number,
): Promise<void> {
  const r = String(thisReason ?? "");
  const thisHalf = /\[first\s+half\]/i.test(r) ? "first" : /\[second\s+half\]/i.test(r) ? "second" : null;
  if (!thisHalf) return; // [Half Day] without a side — can't pair reliably
  const otherHalfRe = thisHalf === "first" ? /\[second\s+half\]/i : /\[first\s+half\]/i;
  const others = await prisma.leaveApplication.findMany({
    where: {
      userId, status: "approved", id: { not: thisAppId },
      fromDate: { lte: dateOnly }, toDate: { gte: dateOnly },
    },
    select: { reason: true },
  });
  if (!others.some((o) => otherHalfRe.test(String(o.reason ?? "")))) return;
  await refundLopLwp(prisma, userId, dateOnly);
  await prisma.attendance.upsert({
    where: { userId_date: { userId, date: dateOnly } },
    create: { userId, date: dateOnly, status: "on_leave" },
    update: { status: "on_leave" },
  });
}

// After a SHORT-leave decision (approve OR reject): re-settle the day's
// attendance row from the CURRENT state of every short leave on that date.
// A short leave never stamps on_leave (it excuses 2h, not the day) — instead
// the clocked-out day is re-judged by the shared resolver:
//   approved + worked ≥ (bar − excuse)  → present (full pay)
//   rejected + worked ≥ (bar − excuse)  → short_lop (¼ day)
//   below the reduced bar               → half_day / unchanged (normal bands)
// Missed-clock-out / regularized rows are left alone — the missed-swipe path
// (auto-LOP + lop-integrity) prices those at ¼ day itself.
async function settleShortLeaveDay(userId: number, dateOnly: Date): Promise<void> {
  const row = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: dateOnly } },
    select: { id: true, status: true, isRegularized: true, totalMinutes: true, clockIn: true, clockOut: true, notes: true },
  });
  if (!row || row.isRegularized || !row.clockOut) return;
  if (!["present", "late", "half_day", "short_lop"].includes(row.status)) return;

  const slRows = await prisma.leaveApplication.findMany({
    where: { userId, fromDate: { lte: dateOnly }, toDate: { gte: dateOnly } },
    select: { reason: true, status: true },
  });
  const state = shortLeaveDayState(slRows);
  if (!state.appliedAny) return;

  const shiftRows = await prisma.$queryRawUnsafe<Array<{
    startTime: string | null; endTime: string | null; breakMinutes: number | null;
    satStartTime: string | null; satEndTime: string | null; satGraceMinutes: number | null;
  }>>(
    `SELECT s."startTime", s."endTime", s."breakMinutes",
            s."satStartTime", s."satEndTime", s."satGraceMinutes"
       FROM "UserShift" us JOIN "Shift" s ON s.id = us."shiftId"
      WHERE us."userId" = $1`,
    userId,
  );
  const bars = dayBars(dateOnly, shiftRows[0] ?? null);
  let next = resolveShortLeaveDayStatus({
    worked: row.totalMinutes ?? 0,
    fullBar: bars.full, halfBar: bars.half,
    activeMin: state.activeMin, rejectedMin: state.rejectedMin,
    prevStatus: row.status,
  });
  // Cosmetic-LATE repair: an approved MORNING short leave moves the late
  // cutoff by 2h/slot — if the actual clock-in was inside that shifted
  // window, the "late" stamped by an unaware clock-in (older build, or the
  // leave applied after arriving) is wrong. Clear it to present.
  if (next === "late" && row.clockIn) {
    const morningApproved = slRows.filter((l) =>
      l.status === "approved" && /\[\s*short\s*leave\s*[-–:]?\s*morning\s*\]/i.test(l.reason ?? "")).length;
    if (morningApproved > 0) {
      const cutoff = lateCutoffMinFor(dateOnly, shiftRows[0] ?? null, {
        morningShortLeaveMinutes: morningApproved * SHORT_LEAVE_MINUTES,
      });
      const istIn = new Date(new Date(row.clockIn).getTime() + 330 * 60000);
      const inMin = istIn.getUTCHours() * 60 + istIn.getUTCMinutes();
      if (inMin <= cutoff) next = "present";
    }
  }
  if (next !== row.status) {
    await prisma.attendance.update({
      where: { id: row.id },
      data: { status: next, notes: `Short-leave settle: ${row.status} → ${next} (worked ${row.totalMinutes}m, bar ${bars.full}m, excused ${state.activeMin}m).` },
    });
  }
}

function fmtRange(from: Date, to: Date, days: number) {
  return `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (${days} day${days === 1 ? "" : "s"})`;
}

// Notification body suffix for approver-written notes. Always rendered on a
// new line with a "Note: " prefix so the bell-panel can detect and pull it
// out into a styled callout (and the "Notes" filter tab can find it).
function noteSuffix(note: string | null | undefined): string {
  const t = (note || "").trim();
  return t ? `\nNote: ${t.slice(0, 240)}` : "";
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { id: idParam } = await params;
    const appId = Number(idParam);
    if (!Number.isInteger(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const approvalNote = typeof body?.approvalNote === "string" ? body.approvalNote : null;

    const application = await prisma.leaveApplication.findUnique({
      where: { id: appId },
      include: { leaveType: true, user: { select: { id: true, name: true, managerId: true } } },
    });
    if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // RBAC-designation-driven (policy 2026-07-14): APPROVE_ALL_REQUESTS is
    // the L2/final-approver permission. Legacy expression kept only as the
    // fallback for sessions without resolved permissions.
    const isFinalApprover = hasResolvedPermissions(self)
      ? can(self, "APPROVE_ALL_REQUESTS")
      : (self.orgLevel === "ceo" ||
         self.isDeveloper ||
         self.orgLevel === "hr_manager" ||
         self.orgLevel === "special_access" ||
         self.role === "admin" ||
         self.role === "hr_manager");
    const isDirectManager = application.user?.managerId === myId;
    // Single-stage policy check — returns false for ALL brands since
    // 2026-07-21 (YT Labs re-joined the NB two-stage flow); see
    // src/lib/hr/single-stage-approval.ts.
    const singleStage = await isSingleStageApprovalEmployee(application.userId);
    const year = new Date(application.fromDate).getFullYear();
    const totalDays = parseFloat(application.totalDays.toString());
    const rangeLabel = fmtRange(new Date(application.fromDate), new Date(application.toDate), totalDays);
    // Half-day requests carry a marker in the reason field (see POST flow).
    const isHalfDay = /^\s*\[(Half Day|First Half|Second Half)\]/i.test(String(application.reason ?? ""));
    // Short leave: 2h excuse — NEVER stamps the day on_leave; approve/reject
    // re-settles the day's attendance row instead (see settleShortLeaveDay).
    const isShortLv = isShortLeaveReason(application.reason);
    // Approver display name — used by the email template so recipients
    // can see WHO took the action at each stage.
    const approverName = (self?.name as string) || (self?.email as string) || "An approver";
    // Base structured payload shared across reject / approve emails.
    const leaveEmailBase = {
      applicantName: application.user?.name || "An employee",
      leaveType:     application.leaveType?.name || "leave",
      fromDate:      application.fromDate,
      toDate:        application.toDate,
      totalDays,
      isHalfDay,
      reason:        application.reason || undefined,
    } as const;

    // ── EDIT (owner or HR admin, BEFORE L1 approval) ──────────────────
    // The applicant can fix their own request — or HR can fix it on their
    // behalf — but ONLY while it's still "pending" (not yet acted on by the
    // L1 manager). Once it's L1-approved / approved, editing is closed:
    // cancel & re-apply instead, so an already-moved balance / attendance
    // mark never desyncs (agreed policy 2026-07-25, option A / pre-L1).
    if (action === "edit") {
      const isOwner = application.userId === myId;
      if (!isOwner && !isFinalApprover) {
        return NextResponse.json({ error: "You can only edit your own leave." }, { status: 403 });
      }
      if (application.status !== "pending") {
        return NextResponse.json(
          { error: "This leave has already been approved — cancel and re-apply to change it." },
          { status: 400 },
        );
      }

      const newFrom   = body?.fromDate ? new Date(body.fromDate) : new Date(application.fromDate);
      const newTo     = body?.toDate   ? new Date(body.toDate)   : new Date(application.toDate);
      const newReason = typeof body?.reason === "string" && body.reason.trim() ? body.reason : application.reason;
      const newTypeId = Number.isInteger(body?.leaveTypeId) ? body.leaveTypeId : application.leaveTypeId;
      if (newFrom > newTo) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

      const newType = await prisma.leaveType.findUnique({ where: { id: newTypeId } });
      if (!newType || !newType.isActive) return NextResponse.json({ error: "Unknown leave type" }, { status: 400 });

      const subjectShift = await prisma.userShift.findUnique({
        where: { userId: application.userId },
        include: { shift: true },
      });

      // New amount — honour the leave SHAPE encoded in the (new) reason so a
      // half-day / short leave keeps its 0.5 / 0.25 amount instead of being
      // recounted as whole working days.
      const nowShort = isShortLeaveReason(newReason);
      const nowHalf  = /^\s*\[(Half Day|First Half|Second Half)\]/i.test(String(newReason ?? ""));
      let newTotal: number;
      if (nowShort) {
        if (!shortLeaveSlot(newReason)) return NextResponse.json({ error: "Pick a Morning or Evening slot for the short leave." }, { status: 400 });
        if (newFrom.toDateString() !== newTo.toDateString()) return NextResponse.json({ error: "A short leave is for a single day." }, { status: 400 });
        if (!subjectShift?.shift) return NextResponse.json({ error: "Shift not assigned — please contact the HR department." }, { status: 400 });
        newTotal = SHORT_LEAVE_DAYS;
      } else if (nowHalf) {
        newTotal = 0.5;
      } else {
        newTotal = await countWorkingDays(newFrom, newTo, subjectShift?.shift, subjectShift?.effectiveFrom);
      }
      if (newTotal === 0) return NextResponse.json({ error: "Selected dates are all non-working days / holidays for this shift" }, { status: 400 });

      // Short-leave monthly cap — count the subject's OTHER live short leaves
      // this month (exclude this application, since we're editing it).
      if (nowShort) {
        const { start, end } = istMonthRange(newFrom);
        const monthRows = await prisma.leaveApplication.findMany({
          where: { userId: application.userId, id: { not: appId }, status: { in: ["pending", "partially_approved", "approved"] }, fromDate: { gte: start, lte: end } },
          select: { reason: true },
        });
        if (monthRows.filter((r) => isShortLeaveReason(r.reason)).length >= SHORT_LEAVE_MONTHLY_CAP) {
          return NextResponse.json({ error: `Short leave limit reached — max ${SHORT_LEAVE_MONTHLY_CAP} per month.` }, { status: 400 });
        }
      }

      const oldTotal = parseFloat(application.totalDays.toString()) || 0;

      try {
        await prisma.$transaction(async (tx) => {
          // Release the OLD pending debit from the old type, then reserve the
          // NEW one on the new type — after reversal, verify the new type has
          // room; throw to roll back if it doesn't (caught → clean 400 below).
          await tx.leaveBalance.updateMany({
            where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
            data:  { pendingDays: { decrement: oldTotal } },
          });
          const newBal = await tx.leaveBalance.findUnique({
            where: { userId_leaveTypeId_year: { userId: application.userId, leaveTypeId: newTypeId, year } },
          });
          const available = newBal
            ? parseFloat(newBal.totalDays.toString()) - parseFloat(newBal.usedDays.toString()) - parseFloat(newBal.pendingDays.toString())
            : 0;
          if (newTotal > available) {
            throw new Error(`INSUFFICIENT:${newType.name}:${available}`);
          }
          await tx.leaveBalance.upsert({
            where:  { userId_leaveTypeId_year: { userId: application.userId, leaveTypeId: newTypeId, year } },
            create: { userId: application.userId, leaveTypeId: newTypeId, year, totalDays: 0, usedDays: 0, pendingDays: newTotal },
            update: { pendingDays: { increment: newTotal } },
          });
          await tx.leaveApplication.update({
            where: { id: appId },
            data:  { fromDate: newFrom, toDate: newTo, reason: newReason, leaveTypeId: newTypeId, totalDays: newTotal, status: "pending" },
          });
        });
      } catch (e: any) {
        const m = String(e?.message ?? "");
        if (m.startsWith("INSUFFICIENT:")) {
          const [, tn, av] = m.split(":");
          return NextResponse.json({ error: `Not enough ${tn} — available ${av}, need ${newTotal}.` }, { status: 400 });
        }
        throw e;
      }

      await writeAuditLog({
        action: "leave.edit", entityType: "LeaveApplication", entityId: String(appId),
        actorId: myId,
        metadata: { by: isOwner ? "owner" : "hr", newTotal },
      }).catch(() => {});
      return NextResponse.json({ success: true });
    }

    // ── CANCEL ─────────────────────────────────────────────────────────────
    // Race-safe: only one cancel wins. The status filter inside updateMany is
    // the guard — if another request already cancelled/approved, count === 0.
    if (action === "cancel") {
      if (application.userId !== myId && !isFinalApprover) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const cancellableStatuses = ["pending", "partially_approved", "approved"];
      if (!cancellableStatuses.includes(application.status)) {
        return NextResponse.json({ error: "Cannot cancel" }, { status: 400 });
      }
      const originalStatus = application.status;
      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.leaveApplication.updateMany({
          where: { id: appId, status: { in: cancellableStatuses } },
          data:  { status: "cancelled" },
        });
        if (count === 0) return { raced: true as const };
        await tx.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: originalStatus === "approved"
            ? { usedDays: { decrement: totalDays } }
            : { pendingDays: { decrement: totalDays } },
        });
        return { raced: false as const };
      });
      if (result.raced) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
      return NextResponse.json({ success: true });
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Cross-brand approval guard — a YT Labs HR manager cannot
    // approve/reject an NB Media employee's leave (and vice versa).
    // Founders (orgLevel=ceo / isDeveloper) bypass this.
    const crossBrand = await assertSameBrandOrSuperAdmin(session, application.userId);
    if (crossBrand) return crossBrand;

    // ── REJECT ─────────────────────────────────────────────────────────────
    // Either the direct manager or a final approver can reject. Race-safe.
    if (action === "reject") {
      if (!isFinalApprover && !isDirectManager) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
      if (!["pending", "partially_approved"].includes(application.status)) {
        return NextResponse.json({ error: "Only pending leaves can be rejected" }, { status: 400 });
      }
      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.leaveApplication.updateMany({
          where: { id: appId, status: { in: ["pending", "partially_approved"] } },
          data: {
            status: "rejected",
            approvedById: application.approvedById ?? myId,
            approvalNote: approvalNote ?? application.approvalNote,
            finalApprovedById: isFinalApprover ? myId : application.finalApprovedById,
            finalApprovedAt:   isFinalApprover ? new Date() : application.finalApprovedAt,
            finalApprovalNote: isFinalApprover ? approvalNote : application.finalApprovalNote,
          },
        });
        if (count === 0) return { raced: true as const };
        await tx.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: { pendingDays: { decrement: totalDays } },
        });
        return { raced: false as const };
      });
      if (result.raced) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

      // A rejected SHORT leave changes the day's price: worked ≥ (bar − 2h)
      // but < bar drops from the provisional full-pay to a ¼-day penalty.
      if (isShortLv) {
        await settleShortLeaveDay(application.userId, new Date(application.fromDate));
      }

      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId],
        type:     "leave",
        entityId: appId,
        title:    `Your ${application.leaveType?.name || "leave"} request was rejected`,
        body:     `${rangeLabel}${noteSuffix(approvalNote)}`,
        linkUrl:  "/dashboard/hr/leaves",
        emailData: { ...leaveEmailBase, approverName, stageLabel: "Rejected by", approvalNote: approvalNote ?? undefined },
      });
      return NextResponse.json({ success: true });
    }

    // ── APPROVE — stage 1: manager → partially_approved ───────────────────
    if (application.status === "pending") {
      if (!isDirectManager && !isFinalApprover) return NextResponse.json({ error: "Not authorised" }, { status: 403 });

      // Final-approver fast-path: when the L1 approver is themselves
      // the L2 approver (CEO or HR Manager), collapse both stages into
      // a single click — there's no point making them approve, then come
      // back and approve their own decision. Applies whether they are
      // the direct manager or just stepping in at L1.
      //
      // Limited to CEO + HR Manager (the named final approvers in
      // policy). Other final-approver tiers (special_access, role=admin,
      // isDeveloper) still go through the normal two-step flow.
      const isCeo = self.orgLevel === "ceo";
      const isHrManager = self.orgLevel === "hr_manager" || self.role === "hr_manager";
      // L2 auto-approval is CEO ONLY: a CEO approving at L1 collapses straight
      // to approved. HR Managers go through the normal two-step L1 → L2 flow.
      // YT Labs single-stage still collapses for any authorised approver.
      const isFastPathFinalApprover = isCeo || singleStage;
      if (isFastPathFinalApprover) {
        const result = await prisma.$transaction(async (tx) => {
          const { count } = await tx.leaveApplication.updateMany({
            where: { id: appId, status: "pending" },
            data:  {
              status:            "approved",
              approvedById:      myId,
              approvedAt:        new Date(),
              approvalNote,
              finalApprovedById: myId,
              finalApprovedAt:   new Date(),
              finalApprovalNote: approvalNote,
            },
          });
          if (count === 0) return { raced: true as const };
          // Balance: pending → used (same as the L2 finaliser).
          await tx.leaveBalance.updateMany({
            where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
            data: { pendingDays: { decrement: totalDays }, usedDays: { increment: totalDays } },
          });
          return { raced: false as const };
        });
        if (result.raced) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

        // Mark each working day in the range as on_leave (mirrors the L2 path).
        // HALF-day leaves are EXCLUDED (2026-07-28): the leave pays only its
        // own half — the other half is a working half whose outcome (present /
        // half_day / half_day_lop from actual hours, judged by auto-LOP) must
        // survive the approval. Blanket on_leave + LOP refund used to wipe a
        // legitimate working-half penalty whenever the leave was approved late.
        // SHORT leaves are excluded too (2026-08-04): a 2h excuse must never
        // flip a worked day to on_leave — re-settle the day's real status.
        if (isShortLv) {
          await settleShortLeaveDay(application.userId, new Date(application.fromDate));
        } else if (!isHalfDay) {
        const from = new Date(application.fromDate);
        const to   = new Date(application.toDate);
        const cur  = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
        const end  = new Date(Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate()));
        while (cur.getTime() <= end.getTime()) {
          const dow = cur.getUTCDay();
          if (dow !== 0 && dow !== 6) {
            const dateOnly = new Date(cur);
            // Approving leave for a day that was auto-LOP'd cancels the penalty
            // → refund the LWP "used" balance before flipping it to on_leave.
            await refundLopLwp(prisma, application.userId, dateOnly);
            await prisma.attendance.upsert({
              where:  { userId_date: { userId: application.userId, date: dateOnly } },
              create: { userId: application.userId, date: dateOnly, status: "on_leave" },
              update: { status: "on_leave" },
            });
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
        } else {
          // Half-day approval: if this completes FULL leave coverage of the
          // date (other half already approved), settle the day as on_leave.
          await settleFullyCoveredHalfDay(application.userId, new Date(application.fromDate), application.reason, appId);
        }

        // Label reflects WHO finalised: CEO / HR Manager keep their named
        // roles; a YT Labs single-stage approver (e.g. the direct manager)
        // is logged generically so the audit trail stays truthful.
        const fastPathRole = isCeo ? "CEO" : isHrManager ? "HR Manager" : approverName;
        await writeAuditLog({
          req, actorId: myId, actorEmail: self?.email ?? null,
          action: isCeo ? "leave.approve_ceo_direct" : isHrManager ? "leave.approve_hr_direct" : "leave.approve_single_stage",
          entityType: "LeaveApplication", entityId: appId,
          before: { status: "pending" }, after: { status: "approved", approvalNote },
        });

        const extrasFast = application.notifyUserIds ?? [];
        await notifyUsers({
          actorId:  myId,
          userIds:  [application.userId, ...extrasFast],
          type:     "leave",
          entityId: appId,
          title:    `${application.user?.name || "An employee"}'s ${application.leaveType?.name || "leave"} is approved`,
          body:     `${rangeLabel} — approved directly by the ${fastPathRole}.${noteSuffix(approvalNote)}`,
          linkUrl:  "/dashboard/hr/leaves",
          emailData: { ...leaveEmailBase, approverName, stageLabel: `Approved by (${fastPathRole} direct)`, approvalNote: approvalNote ?? undefined },
        });
        return NextResponse.json({ success: true });
      }

      // Race-safe: only one stage-1 approval wins. Notifications only fire for the winner.
      const { count } = await prisma.leaveApplication.updateMany({
        where: { id: appId, status: "pending" },
        data:  {
          status:       "partially_approved",
          approvedById: myId,
          approvedAt:   new Date(),
          approvalNote,
        },
      });
      if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

      // Final approvers: Special Access + HR Manager (role). Drops
      // orgLevel="hr_manager"-only members (e.g. HR-team folks whose role
      // is "member") and role="admin" alone. Developer accounts gated by
      // the "Notify developers" toggle. The CEO is pinged for final
      // approval only when the applicant is their OWN direct report
      // (added below) — otherwise HR handles it.
      const finalApprovers = await brandScopedFinalApprovers(application.userId);
      // Brand-CEO routing: every YT Labs applicant pulls in the YT
      // Labs CEO (Kunal) at L2, and every NB Media applicant pulls in
      // the NB Media CEO. Wider than the direct-manager-only
      // `ceoRecipientIdForEmployee` we used before — was leaving e.g.
      // Riya Uppal's leaves out of Kunal's inbox because her direct
      // manager is Tanvi.
      const ceoFinalApprover = await brandCeoIdForEmployee(application.userId);
      const extras = application.notifyUserIds ?? [];
      await notifyUsers({
        actorId:  myId,
        userIds:  [...finalApprovers.map((u) => u.id), ...(ceoFinalApprover ? [ceoFinalApprover] : []), ...extras],
        type:     "leave",
        entityId: appId,
        title:    `${application.user?.name || "An employee"}'s ${application.leaveType?.name || "leave"} needs final approval`,
        body:     `${rangeLabel} — manager approved, awaiting CEO / HR.${noteSuffix(approvalNote)}`,
        linkUrl:  "/dashboard/hr/approvals",
        // L1-stage email: surface as "Manager Approved By" + note so the
        // row label matches the L2-stage layout downstream.
        emailData: { ...leaveEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
      });
      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId],
        type:     "leave",
        entityId: appId,
        title:    `Your ${application.leaveType?.name || "leave"} is partially approved`,
        body:     `${rangeLabel} — awaiting final approval from CEO / HR.${noteSuffix(approvalNote)}`,
        linkUrl:  "/dashboard/hr/leaves",
        emailData: { ...leaveEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
      });
      return NextResponse.json({ success: true });
    }

    // ── APPROVE — stage 2: CEO/HR finalises → balance debit + attendance marks ─
    // This is the most dangerous race: double-debit of leave balance. Guard
    // the status transition, then do the balance + attendance work only for
    // the winner inside the same transaction.
    if (application.status === "partially_approved") {
      if (!isFinalApprover) return NextResponse.json({ error: "Only CEO / HR can finalise" }, { status: 403 });

      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.leaveApplication.updateMany({
          where: { id: appId, status: "partially_approved" },
          data: {
            status:            "approved",
            finalApprovedById: myId,
            finalApprovedAt:   new Date(),
            finalApprovalNote: approvalNote,
          },
        });
        if (count === 0) return { raced: true as const };
        await tx.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: { pendingDays: { decrement: totalDays }, usedDays: { increment: totalDays } },
        });
        return { raced: false as const };
      });
      if (result.raced) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

      // Mark attendance as on_leave for each working day in the range.
      // Attendance.upsert is idempotent on the unique key, so even if two
      // callers reached this far (they can't, but belt-and-braces), the
      // second just re-writes status=on_leave to the same value.
      //
      // fromDate/toDate are `@db.Date` columns stored as UTC-midnight of the
      // IST calendar day, so we walk the range in UTC arithmetic only.
      // Using local getters/setters (getDay / setDate) leaks server wall-time
      // into the loop and can skip or duplicate a day around 18:30 UTC.
      // HALF-day leaves are EXCLUDED (2026-07-28) — same rule as the
      // fast-path above: the leave pays its own half only; the working
      // half's real outcome (incl. a half_day_lop for short hours) stays.
      // SHORT leaves re-settle the day's real status instead (2026-08-04).
      if (isShortLv) {
        await settleShortLeaveDay(application.userId, new Date(application.fromDate));
      } else if (!isHalfDay) {
      const from = new Date(application.fromDate);
      const to   = new Date(application.toDate);
      const cur  = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
      const end  = new Date(Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate()));
      while (cur.getTime() <= end.getTime()) {
        const dow = cur.getUTCDay(); // 0 = Sun, 6 = Sat
        if (dow !== 0 && dow !== 6) {
          const dateOnly = new Date(cur);
          // Approving leave for a day that was auto-LOP'd cancels the penalty
          // → refund the LWP "used" balance before flipping it to on_leave.
          await refundLopLwp(prisma, application.userId, dateOnly);
          await prisma.attendance.upsert({
            where: { userId_date: { userId: application.userId, date: dateOnly } },
            create: { userId: application.userId, date: dateOnly, status: "on_leave" },
            update: { status: "on_leave" },
          });
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      } else {
        // Half-day approval: if this completes FULL leave coverage of the
        // date (other half already approved), settle the day as on_leave.
        await settleFullyCoveredHalfDay(application.userId, new Date(application.fromDate), application.reason, appId);
      }

      const extras = application.notifyUserIds ?? [];
      // Look up the L1 manager's name so the final-approval email shows
      // both the manager AND the L2 finaliser. The L1 note lives on
      // application.approvalNote (set at the L1 stage above).
      let l1ApproverName: string | undefined;
      if (application.approvedById) {
        const l1 = await prisma.user.findUnique({
          where: { id: application.approvedById },
          select: { name: true },
        });
        l1ApproverName = l1?.name ?? undefined;
      }
      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId, ...extras, ...(application.approvedById ? [application.approvedById] : [])],
        type:     "leave",
        entityId: appId,
        title:    `${application.user?.name || "An employee"}'s ${application.leaveType?.name || "leave"} is approved`,
        body:     `${rangeLabel} — final approval granted.${noteSuffix(approvalNote)}`,
        linkUrl:  "/dashboard/hr/leaves",
        emailData: {
          ...leaveEmailBase,
          approverName,
          stageLabel:     "Final approval by",
          approvalNote:   approvalNote ?? undefined,
          l1ApproverName,
          l1ApprovalNote: application.approvalNote ?? undefined,
        },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "This request is no longer actionable" }, { status: 400 });
  } catch (e) { return serverError(e, "PUT /api/hr/leaves/[id]"); }
}

/** Delete a leave application outright. HR-admin only. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    // RBAC-designation-driven (policy 2026-07-14) — same gate as PUT above.
    const isFinalApprover = hasResolvedPermissions(self)
      ? can(self, "APPROVE_ALL_REQUESTS")
      : (self.orgLevel === "ceo" ||
         self.isDeveloper ||
         self.orgLevel === "hr_manager" ||
         self.orgLevel === "special_access" ||
         self.role === "admin" ||
         self.role === "hr_manager");
    if (!isFinalApprover) return NextResponse.json({ error: "Only HR admin can delete leaves" }, { status: 403 });

    const { id: idParam } = await params;
    const appId = Number(idParam);
    if (!Number.isInteger(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Refund the balance debit this leave still holds BEFORE deleting it.
    // A raw delete leaves usedDays (approved) / pendingDays (pending or
    // partially_approved) stranded on the LeaveBalance row — phantom usage
    // that no application backs. Mirror the cancel path's refund so the
    // counters stay correct. rejected/cancelled leaves already refunded, so
    // they get nothing. All atomic: refund + delete succeed or fail together.
    const application = await prisma.leaveApplication.findUnique({
      where: { id: appId },
      select: { userId: true, leaveTypeId: true, fromDate: true, totalDays: true, status: true },
    });
    if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const year = new Date(application.fromDate).getFullYear();
    const totalDays = parseFloat(application.totalDays.toString());

    await prisma.$transaction(async (tx) => {
      if (application.status === "approved") {
        await tx.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: { usedDays: { decrement: totalDays } },
        });
      } else if (application.status === "pending" || application.status === "partially_approved") {
        await tx.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: { pendingDays: { decrement: totalDays } },
        });
      }
      await tx.leaveApplication.delete({ where: { id: appId } });
    });
    return NextResponse.json({ success: true });
  } catch (e) { return serverError(e, "DELETE /api/hr/leaves/[id]"); }
}
