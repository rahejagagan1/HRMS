import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers, notifyUsers, brandCeoIdForEmployee, brandScopedFinalApprovers } from "@/lib/notifications";
import { checkPastDateAllowed } from "@/lib/hr/leave-date-rules";
import { istMonthRange } from "@/lib/ist-date";
import { sendEmail } from "@/lib/email/sender";
import { pocAssignmentEmail } from "@/lib/email/templates";
import { assertSameBrandOrSuperAdmin } from "@/lib/hr/cross-brand-guard";
import { isSingleStageApprovalEmployee } from "@/lib/hr/single-stage-approval";
import { isHRAdmin } from "@/lib/access";
import { brandScopeUserWhere } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  // HR access is RBAC-designation-driven (policy 2026-07-14): the shared
  // isHRAdmin resolves MANAGE_HR from the caller's designation permissions.
  // Replaces a local orgLevel/role-only copy.
  const isAdmin = isHRAdmin(user);
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "my";

  try {
    if (!myId && view !== "all") return NextResponse.json([]);
    if (!myId && view === "all" && !isAdmin) return NextResponse.json([]);

    // Org-wide brand isolation (2026-07-15): admin "all" views only show
    // the caller's own brand unless they hold VIEW_ALL_BRANDS.
    const where =
      view === "team" && !isAdmin ? { user: { managerId: myId! } } :
      view === "all"  && isAdmin  ? { user: brandScopeUserWhere(user) } :
                                    { userId: myId! };

    const reqs = await prisma.onDutyRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approver: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reqs);
  } catch (e) { return serverError(e, "GET /api/hr/attendance/on-duty"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const body = await req.json();
    const { date, fromTime, toTime, purpose, location, notifyUserIds, toDate, targetUserId } = body;
    if (!date || !purpose) return NextResponse.json({ error: "date and purpose required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    // Past-date gate: same rule as Leave/WFH. CEO / role=hr_manager /
    // isDeveloper can back-date, everyone else can't.
    const selfUser = session!.user as any;
    const pastErr = checkPastDateAllowed(date, selfUser);
    if (pastErr) return NextResponse.json({ error: pastErr }, { status: 400 });

    // Handoff fields — workStatus required. POC is N/A-able (no Time
    // of Unavailability since OD means the employee IS working, just
    // off-site).
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

    // HR-on-behalf: when targetUserId is set and the caller is HR-admin,
    // the on-duty is created for that user instead of the caller.
    const callerUser = session!.user as any;
    // Shared RBAC-aware gate (MANAGE_HR via designation) — see GET above.
    const callerIsHRAdmin = isHRAdmin(callerUser);
    const tid = typeof targetUserId === "number" ? targetUserId : null;
    const onBehalf = tid !== null && tid !== myId && callerIsHRAdmin;
    const subjectUserId = onBehalf ? tid! : myId;

    // Date range: only HR-on-behalf can grant a multi-day on-duty.
    // Self-apply ignores `toDate`. Weekends are INCLUDED — On Duty
    // explicitly supports Saturday / Sunday work (client visits,
    // weekend events, etc.). The previous Mon–Fri filter has been
    // removed so HR can drop a range that spans a weekend and every
    // day gets a row.
    const fromDate = new Date(date);
    const toDateObj = toDate ? new Date(toDate) : fromDate;
    if (toDateObj.getTime() < fromDate.getTime()) {
      return NextResponse.json({ error: "toDate must be on or after date" }, { status: 400 });
    }
    if (!onBehalf && toDateObj.getTime() !== fromDate.getTime()) {
      return NextResponse.json({ error: "Date ranges are only available when HR applies on behalf." }, { status: 400 });
    }

    // Self-apply monthly cap: a user may file at most MAX_SELF_OD_PER_MONTH
    // On-Duty requests in a given calendar month (counted in the month of the
    // requested date, IST). HR applying on behalf (onBehalf) is exempt — that
    // path stays unlimited. Cancelled / rejected requests don't burn quota, so
    // a turned-down request doesn't cost the employee one of their two.
    const MAX_SELF_OD_PER_MONTH = 2;
    if (!onBehalf) {
      const { start, end } = istMonthRange(fromDate);
      const usedThisMonth = await prisma.onDutyRequest.count({
        where: {
          userId: subjectUserId,
          date: { gte: start, lte: end },
          status: { notIn: ["rejected", "cancelled"] },
        },
      });
      if (usedThisMonth >= MAX_SELF_OD_PER_MONTH) {
        return NextResponse.json(
          {
            error: `You can apply for at most ${MAX_SELF_OD_PER_MONTH} On-Duty requests per month. Ask HR to file any additional ones on your behalf.`,
            code: "od_monthly_limit",
          },
          { status: 400 },
        );
      }
    }

    const targetDays: Date[] = [];
    for (let cur = new Date(fromDate.getTime()); cur.getTime() <= toDateObj.getTime(); cur.setUTCDate(cur.getUTCDate() + 1)) {
      targetDays.push(new Date(cur));
    }
    if (targetDays.length === 0) {
      // Defensive: only reachable if the date params were malformed
      // past the validation above. Kept as a safety net.
      return NextResponse.json({ error: "No valid dates in the selected range." }, { status: 400 });
    }
    const created = await prisma.$transaction(
      targetDays.map((d) => prisma.onDutyRequest.create({
        // pocUserId / workStatus may be unknown to the typed client
        // until `prisma generate` reruns. Runtime is fine — migration
        // added both columns. `as any` keeps TypeScript happy.
        data: ({
          userId:   subjectUserId,
          date:     d,
          fromTime: fromTime ? new Date(`${d.toISOString().slice(0,10)}T${fromTime}:00`) : null,
          toTime:   toTime   ? new Date(`${d.toISOString().slice(0,10)}T${toTime}:00`)   : null,
          purpose,
          location,
          pocUserId, workStatus,
        } as any),
      })),
    );
    const rec = created[0];
    const isRange = created.length > 1;
    const requester = await prisma.user.findUnique({ where: { id: subjectUserId }, select: { name: true } });
    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    const dateLabel = isRange ? `${fmt(fromDate)} – ${fmt(toDateObj)} (${created.length} day${created.length === 1 ? "" : "s"})` : new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    // Structured emailData so the on-duty email mirrors leave —
    // Reason block shows just the user-typed purpose; the structured
    // rows below the body show Request Type / From / To / Total Days
    // (range), or a single Date when self-applied. Time + Location
    // appear when set. Mirrors leaveRequestEmail's row layout.
    const odEmailBase = {
      applicantName: requester?.name || "An employee",
      date,
      // Forward the chosen range for HR-on-behalf submissions so the
      // email's FROM / TO / TOTAL DAYS rows render correctly. Single-
      // day self-apply leaves toDate / totalDays undefined and the
      // template falls back to a single DATE row.
      toDate:    isRange ? toDateObj : undefined,
      totalDays: isRange ? created.length : undefined,
      fromTime:  fromTime || undefined,
      toTime:    toTime   || undefined,
      location:  location || undefined,
      reason:    String(purpose || "").trim() || undefined,
    };
    await Promise.all([
      notifyApprovers({
        actorId:  myId,
        type:     "on_duty",
        entityId: rec.id,
        title:    `${requester?.name || "An employee"} requested On Duty`,
        body:     `Date: ${dateLabel}${location ? ` @ ${location}` : ""} — ${String(purpose).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=wfh",
        extraUserIds: extras,
        emailData: odEmailBase,
      }),
      notifyUsers({
        actorId:  null,
        userIds:  [myId],
        type:     "on_duty",
        entityId: rec.id,
        title:    `On Duty request submitted`,
        body:     `Your request for ${dateLabel}${location ? ` @ ${location}` : ""} is awaiting approval.`,
        linkUrl:  "/dashboard/hr/attendance",
        emailData: odEmailBase,
      }),
    ]);

    // POC heads-up — fire-and-forget so SMTP hiccups don't 500 the save.
    if (pocUser && pocUser.email && pocUserId !== subjectUserId) {
      void sendEmail({
        to: pocUser.email,
        content: pocAssignmentEmail({
          pocName:       pocUser.name || "there",
          applicantName: requester?.name || "An employee",
          requestType:   "On Duty",
          dateLabel,
          daysLabel:     `${created.length} day${created.length === 1 ? "" : "s"}`,
          workStatus,
          reason:        String(purpose || "").trim() || undefined,
        }),
      });
    }

    return NextResponse.json(rec, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/attendance/on-duty"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Shared RBAC-aware gate (MANAGE_HR via designation) — see GET above.
  const isAdmin = isHRAdmin(user);

  try {
    const body = await req.json();
    const id = Number(body.id);
    const action = body.action;
    const approvalNote = typeof body.approvalNote === "string" ? body.approvalNote : null;
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const record = await prisma.onDutyRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, managerId: true } } },
    });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (record.status !== "pending" && record.status !== "partially_approved") {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }

    // Two-stage approval: pending (L1 manager) → partially_approved (L2 HR/CEO/Dev) → approved.
    const isDirectManager = record.user?.managerId === myId;
    if (record.status === "pending" && !isDirectManager && !isAdmin) {
      return NextResponse.json({ error: "Forbidden — only the L1 manager or HR/CEO can act at stage 1." }, { status: 403 });
    }
    if (record.status === "partially_approved" && !isAdmin) {
      return NextResponse.json({ error: "Forbidden — only HR / CEO / Developer can give final approval." }, { status: 403 });
    }

    // Cross-brand approval guard — single-brand HR can't action the
    // other brand's on-duty request. Founder bypasses.
    if (record.user?.id != null) {
      const crossBrand = await assertSameBrandOrSuperAdmin(session, record.user.id);
      if (crossBrand) return crossBrand;
    }

    // Single-stage policy check — false for all brands since 2026-07-21
    // (YT Labs re-joined the NB two-stage flow); see single-stage-approval.ts.
    const singleStage = await isSingleStageApprovalEmployee(record.userId);
    // Fast-path: only the CEO approving at L1 collapses straight to approved
    // instead of parking at partially_approved. HR Managers still finalise at L2.
    const isCeo = user.orgLevel === "ceo";
    const fastPath = singleStage || isCeo;

    const dateLabel = new Date(record.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const requesterName = record.user?.name || "An employee";
    const approver = await prisma.user.findUnique({ where: { id: myId }, select: { name: true } });
    const approverName = approver?.name || "An approver";

    // Reused across every branch so the approval email matches the
    // leave email's row layout — Reason = original purpose, Date /
    // From-To-Total-Days surface via the same template fields. Each
    // OD record is per-day, so approval emails always render the
    // single-DATE variant (ranges only matter on the initial submit).
    // Time + Location forward when set.
    const isoTime = (d: Date | null | undefined) =>
      d ? `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : undefined;
    const odEmailBase = {
      applicantName: requesterName,
      date:          record.date,
      fromTime:      isoTime(record.fromTime),
      toTime:        isoTime(record.toTime),
      location:      record.location ?? undefined,
      reason:        record.purpose || undefined,
    };

    // ── REJECT (any open stage) ────────────────────────────────────
    if (action === "reject") {
      const { count } = await prisma.onDutyRequest.updateMany({
        where: { id, status: { in: ["pending", "partially_approved"] } },
        data:  { status: "rejected", approvedById: record.approvedById ?? myId, approvalNote: approvalNote ?? record.approvalNote },
      });
      if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
      await notifyUsers({
        actorId:  myId,
        userIds:  [record.userId],
        type:     "on_duty",
        entityId: record.id,
        title:    `Your On Duty request for ${dateLabel} was rejected`,
        body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
        linkUrl:  "/dashboard/hr/attendance",
        emailData: { ...odEmailBase, approverName, stageLabel: "Rejected by", approvalNote: approvalNote ?? undefined },
      });
      return NextResponse.json(await prisma.onDutyRequest.findUnique({ where: { id } }));
    }

    // ── APPROVE STAGE 1 — manager → partially_approved ─────────────
    // Skipped for YT Labs (single-stage): fall through to the finaliser.
    if (record.status === "pending" && !fastPath) {
      const { count } = await prisma.onDutyRequest.updateMany({
        where: { id, status: "pending" },
        data:  { status: "partially_approved", approvedById: myId, approvalNote },
      });
      if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

      // Brand-CEO L2 routing: HR/Special Access (CEO excluded) +
      // the applicant's brand CEO. Keeps each CEO inside their brand.
      const [finalApprovers, brandCeoId] = await Promise.all([
        brandScopedFinalApprovers(record.userId),
        brandCeoIdForEmployee(record.userId),
      ]);
      await Promise.all([
        notifyUsers({
          actorId:  myId,
          userIds:  [...finalApprovers.map((u) => u.id), ...(brandCeoId ? [brandCeoId] : [])],
          type:     "on_duty",
          entityId: record.id,
          title:    `${requesterName}'s On Duty for ${dateLabel} needs final approval`,
          body:     `Manager approved — awaiting CEO / HR.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
          linkUrl:  "/dashboard/hr/approvals?tab=wfh",
          emailData: { ...odEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
        }),
        notifyUsers({
          actorId:  myId,
          userIds:  [record.userId],
          type:     "on_duty",
          entityId: record.id,
          title:    `Your On Duty for ${dateLabel} is partially approved`,
          body:     `Awaiting final approval from CEO / HR.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
          linkUrl:  "/dashboard/hr/attendance",
          emailData: { ...odEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
        }),
      ]);
      return NextResponse.json(await prisma.onDutyRequest.findUnique({ where: { id } }));
    }

    // ── APPROVE STAGE 2 — HR/CEO/Dev → approved (final) ────────────
    // For YT Labs (single-stage) this also finalises a still-"pending" row
    // on the first approve, stamping the actor as approver.
    const { count } = await prisma.onDutyRequest.updateMany({
      where: { id, status: fastPath ? { in: ["pending", "partially_approved"] } : "partially_approved" },
      data:  { status: "approved", approvedById: record.approvedById ?? myId, approvalNote: approvalNote ?? record.approvalNote },
    });
    if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

    // Look up the L1 manager so the final email lists them alongside the
    // CEO/HR finaliser (mirrors the leave email's two-row chain).
    const l1Approver = record.approvedById
      ? await prisma.user.findUnique({ where: { id: record.approvedById }, select: { name: true } })
      : null;

    await notifyUsers({
      actorId:  myId,
      userIds:  [record.userId],
      type:     "on_duty",
      entityId: record.id,
      title:    `Your On Duty for ${dateLabel} is approved`,
      body:     `Final approval granted.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
      linkUrl:  "/dashboard/hr/attendance",
      emailData: {
        ...odEmailBase,
        l1ApproverName: l1Approver?.name,
        l1ApprovalNote: record.approvalNote ?? undefined,
        approverName,
        stageLabel:     "Approved by",
        approvalNote:   approvalNote ?? undefined,
      },
    });
    return NextResponse.json(await prisma.onDutyRequest.findUnique({ where: { id } }));
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/on-duty"); }
}
