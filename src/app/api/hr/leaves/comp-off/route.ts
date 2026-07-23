import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";
import { notifyApprovers, notifyUsers, brandCeoIdForEmployee, brandScopedFinalApprovers } from "@/lib/notifications";
import { sendEmail } from "@/lib/email/sender";
import { pocAssignmentEmail } from "@/lib/email/templates";
import { assertSameBrandOrSuperAdmin } from "@/lib/hr/cross-brand-guard";
import { isSingleStageApprovalEmployee } from "@/lib/hr/single-stage-approval";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  const isAdmin = isHRAdmin(user);
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "my";

  try {
    const where =
      view === "team" && !isAdmin ? { user: { managerId: myId! } } :
      view === "all"  && isAdmin  ? {} :
                                    { userId: myId! };

    const reqs = await prisma.compOffRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approver: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reqs);
  } catch (e) { return serverError(e, "GET /api/hr/leaves/comp-off"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const body = await req.json();
    const { workedDate, creditDays, reason } = body;
    if (!workedDate || !reason) return NextResponse.json({ error: "workedDate and reason required" }, { status: 400 });

    // Handoff fields — workStatus required. POC is N/A-able: the form
    // can mark it N/A and send pocUserId=null. No past-date gate here:
    // workedDate is INHERENTLY in the past (you're claiming credit for
    // past extra work) so the today-floor doesn't apply.
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

    const expiry = new Date(workedDate);
    expiry.setMonth(expiry.getMonth() + 3);

    const rec = await prisma.compOffRequest.create({
      // pocUserId / workStatus may be unknown to the typed client until
      // `prisma generate` reruns. Runtime is fine — migration added both.
      data: ({
        userId: myId,
        workedDate: new Date(workedDate),
        creditDays: parseFloat(creditDays || "1"),
        reason,
        expiryDate: expiry,
        pocUserId, workStatus,
      } as any),
    });

    // Notify L1 (manager) + L2 (HR admins) so the request actually
    // surfaces — comp-off used to silently submit with no email at all.
    const requester = await prisma.user.findUnique({ where: { id: myId }, select: { name: true } });
    const workedLabel = new Date(workedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const compEmailBase = {
      applicantName: requester?.name || "An employee",
      workedDate:    new Date(workedDate),
      creditDays:    parseFloat(creditDays || "1"),
      reason:        String(reason || "").trim() || undefined,
    };
    await Promise.all([
      notifyApprovers({
        actorId:  myId,
        type:     "comp_off",
        entityId: rec.id,
        title:    `${requester?.name || "An employee"} requested comp-off`,
        body:     `Worked: ${workedLabel} · Credit: ${creditDays || "1"} day(s) — ${String(reason).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=comp_off",
        emailData: compEmailBase,
      }),
      notifyUsers({
        actorId:  null,
        userIds:  [myId],
        type:     "comp_off",
        entityId: rec.id,
        title:    `Comp-off request submitted`,
        body:     `Your request for ${workedLabel} is awaiting approval.`,
        linkUrl:  "/dashboard/hr/leaves",
        emailData: compEmailBase,
      }),
    ]);

    // POC heads-up — fire-and-forget so SMTP hiccups don't 500 the save.
    // Skipped when POC is N/A (pocUser null).
    if (pocUser && pocUser.email && pocUserId !== myId) {
      void sendEmail({
        to: pocUser.email,
        content: pocAssignmentEmail({
          pocName:       pocUser.name || "there",
          applicantName: requester?.name || "An employee",
          requestType:   "Comp-Off",
          dateLabel:     workedLabel,
          daysLabel:     `${parseFloat(creditDays || "1")} day(s) credit`,
          workStatus,
          reason:        String(reason || "").trim() || undefined,
        }),
      });
    }

    return NextResponse.json(rec, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/leaves/comp-off"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  const isAdmin = isHRAdmin(user);

  try {
    const { id, action, approvalNote } = await req.json();
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const record = await prisma.compOffRequest.findUnique({
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
    // other brand's comp-off request. Founder bypasses.
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

    // Shared payload used by every notification path below.
    const approver = await prisma.user.findUnique({ where: { id: myId! }, select: { name: true } });
    const approverName = approver?.name || "An approver";
    const workedLabel = new Date(record.workedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const compEmailBase = {
      applicantName: record.user?.name || "An employee",
      workedDate:    record.workedDate,
      creditDays:    Number(record.creditDays ?? 1),
      reason:        record.reason || undefined,
    };

    if (action === "reject") {
      const updated = await prisma.compOffRequest.update({
        where: { id },
        data: { status: "rejected", approvedById: record.approvedById ?? myId!, approvalNote: approvalNote ?? record.approvalNote },
      });
      await notifyUsers({
        actorId:  myId!,
        userIds:  [record.userId],
        type:     "comp_off",
        entityId: record.id,
        title:    `Your comp-off for ${workedLabel} was rejected`,
        body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
        linkUrl:  "/dashboard/hr/leaves",
        emailData: { ...compEmailBase, approverName, stageLabel: "Rejected by", approvalNote: approvalNote ?? undefined },
      });
      return NextResponse.json(updated);
    }

    // Stage 1 (manager) → partially_approved.
    // Skipped for YT Labs (single-stage): fall through to the finaliser.
    if (record.status === "pending" && !fastPath) {
      const updated = await prisma.compOffRequest.update({
        where: { id },
        data: { status: "partially_approved", approvedById: myId!, approvalNote },
      });
      // Brand-CEO L2 routing: HR/Special Access (CEO excluded) +
      // applicant's brand CEO. Each CEO sees only their brand.
      const [finalApprovers, brandCeoId] = await Promise.all([
        brandScopedFinalApprovers(record.userId),
        brandCeoIdForEmployee(record.userId),
      ]);
      await Promise.all([
        notifyUsers({
          actorId:  myId!,
          userIds:  [
            ...finalApprovers.map((u) => u.id),
            ...(brandCeoId ? [brandCeoId] : []),
          ].filter((uid) => uid !== record.userId),
          type:     "comp_off",
          entityId: record.id,
          title:    `${record.user?.name || "An employee"}'s comp-off for ${workedLabel} needs final approval`,
          body:     approvalNote ? `Manager approved · ${String(approvalNote).slice(0, 140)}` : "Manager approved — awaiting CEO / HR.",
          linkUrl:  "/dashboard/hr/approvals?tab=comp_off",
          emailData: { ...compEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
        }),
        notifyUsers({
          actorId:  myId!,
          userIds:  [record.userId],
          type:     "comp_off",
          entityId: record.id,
          title:    `Your comp-off for ${workedLabel} is partially approved`,
          body:     "Awaiting final approval from CEO / HR.",
          linkUrl:  "/dashboard/hr/leaves",
          emailData: { ...compEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
        }),
      ]);
      return NextResponse.json(updated);
    }

    // Stage 2 (HR/CEO/Dev) → final approval. For YT Labs (single-stage)
    // this finalises a still-"pending" row on the first approve.
    const updated = await prisma.compOffRequest.update({
      where: { id },
      data: { status: "approved", approvedById: record.approvedById ?? myId!, approvalNote: approvalNote ?? record.approvalNote },
    });
    const l1Approver = record.approvedById
      ? await prisma.user.findUnique({ where: { id: record.approvedById }, select: { name: true } })
      : null;
    await notifyUsers({
      actorId:  myId!,
      userIds:  [record.userId],
      type:     "comp_off",
      entityId: record.id,
      title:    `Your comp-off for ${workedLabel} was approved`,
      body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
      linkUrl:  "/dashboard/hr/leaves",
      emailData: {
        ...compEmailBase,
        l1ApproverName: l1Approver?.name,
        l1ApprovalNote: record.approvalNote ?? undefined,
        approverName,
        stageLabel:     "Approved by",
        approvalNote:   approvalNote ?? undefined,
      },
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/leaves/comp-off"); }
}
