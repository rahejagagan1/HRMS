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

    // ── EDIT (HR admin only) ─────────────────────────────────────────
    // Lets HR admins fix mistakes after a leave is filed — change the
    // dates, type, reason, or override the status. Balance/attendance
    // sync only triggers when status crosses the approved boundary.
    if (action === "edit") {
      if (!isFinalApprover) return NextResponse.json({ error: "Only HR admin can edit leaves" }, { status: 403 });

      const newFromRaw   = body?.fromDate;
      const newToRaw     = body?.toDate;
      const newReason    = typeof body?.reason === "string" ? body.reason : undefined;
      const newTypeIdRaw = body?.leaveTypeId;
      const newStatusRaw = typeof body?.status === "string" ? body.status : undefined;

      const data: any = {};
      if (newFromRaw)        data.fromDate    = new Date(newFromRaw);
      if (newToRaw)          data.toDate      = new Date(newToRaw);
      if (newReason !== undefined) data.reason = newReason;
      if (Number.isInteger(newTypeIdRaw)) data.leaveTypeId = newTypeIdRaw;

      // Recompute totalDays if either date changed. Uses the same UTC-safe
      // counter as the POST flow so weekend / holiday handling stays
      // identical across "apply" and "edit".
      if (data.fromDate || data.toDate) {
        const f = data.fromDate ?? new Date(application.fromDate);
        const t = data.toDate   ?? new Date(application.toDate);
        // Count against the leave subject's own shift calendar (mirrors the
        // POST flow) so alternate-Saturday shifts re-count correctly when HR
        // edits the dates. Falls back to Mon–Fri when no shift is assigned.
        const subjectShift = await prisma.userShift.findUnique({
          where: { userId: application.user!.id },
          include: { shift: true },
        });
        data.totalDays = await countWorkingDays(f, t, subjectShift?.shift, subjectShift?.effectiveFrom);
      }

      const validStatuses = ["pending", "partially_approved", "approved", "rejected", "cancelled"];
      if (newStatusRaw && validStatuses.includes(newStatusRaw)) {
        data.status = newStatusRaw;
      }

      // When the leave TYPE changes on a leave that currently holds a balance
      // debit (approved → usedDays, pending/partially → pendingDays), move that
      // debit from the old type's balance to the new type's, so the buckets
      // stay correct. Upsert the new-type row if the employee has none yet.
      const typeChanging = Number.isInteger(newTypeIdRaw) && newTypeIdRaw !== application.leaveTypeId;
      const debitDays = parseFloat(application.totalDays.toString()) || 0;
      const isApproved = application.status === "approved";
      const isPending  = application.status === "pending" || application.status === "partially_approved";

      await prisma.$transaction(async (tx) => {
        if (typeChanging && debitDays > 0 && (isApproved || isPending)) {
          const dec = isApproved ? { usedDays: { decrement: debitDays } } : { pendingDays: { decrement: debitDays } };
          const inc = isApproved ? { usedDays: { increment: debitDays } } : { pendingDays: { increment: debitDays } };
          await tx.leaveBalance.updateMany({
            where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
            data:  dec,
          });
          await tx.leaveBalance.upsert({
            where:  { userId_leaveTypeId_year: { userId: application.userId, leaveTypeId: newTypeIdRaw, year } },
            create: { userId: application.userId, leaveTypeId: newTypeIdRaw, year, totalDays: 0, usedDays: isApproved ? debitDays : 0, pendingDays: isPending ? debitDays : 0 },
            update: inc,
          });
        }
        await tx.leaveApplication.update({ where: { id: appId }, data });
      });
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
