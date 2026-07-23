import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, isSalaryDeveloper, resolveUserId, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { normaliseBrandParam } from "@/lib/hr/brand-scope";
import { readBrandStatus, materializeBrandStatus } from "@/lib/hr/payroll-run-status";

// POST /api/hr/payroll/runs/:id/transition
//   { action: "lock" | "mark_paid" | "reopen", brand?: "NB Media" | "YT Labs" }
//
//   lock      generated → locked   (HR finalises, sends batch to finance)
//   mark_paid locked    → paid     (finance confirms, employees see payslips)
//   reopen    generated → draft    (HR found a mistake before locking)
//             locked    → generated (admin-only — unlocks for re-edit)
//
// PER-BRAND: a PayrollRun row is shared by both brands, so a transition
// applies to the caller's `brand` slice only (PayrollRun.brandStatus) —
// locking NB Media no longer touches YT Labs. When `brand` is omitted (the
// legacy brand-agnostic admin table), the action is applied to BOTH brand
// slices AND the legacy top-level columns as a whole-run operation.
//
// All transitions are guarded by the brand's current status so a stale UI
// tab can't race a run from "paid" back to "draft". Every transition writes
// to AuditLog with before/after snapshots so finance disputes can be traced.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  if (!canViewSalary(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const runId = parseInt(id);
    if (!Number.isFinite(runId)) return NextResponse.json({ error: "Bad runId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!["lock", "mark_paid", "reopen"].includes(action)) {
      return NextResponse.json({ error: "action must be lock | mark_paid | reopen" }, { status: 400 });
    }
    // brand = which brand's slice to act on. null => legacy whole-run action.
    const brand = normaliseBrandParam(body?.brand);

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });

    const myId = await resolveUserId(session);
    const now  = new Date();
    const nowIso = now.toISOString();

    // Current status is read from the brand's slice (or the legacy columns
    // when brand is omitted / the slice is absent).
    const cur = readBrandStatus(run, brand);

    // Each branch validates the source status and builds the full slice
    // object we'll store. Anything else is rejected — no implicit multi-hop.
    let next: string;
    let slice: { status: string; lockedAt: string | null; lockedBy: number | null; paidAt: string | null; paidBy: number | null };
    let auditAction: string;
    switch (action) {
      case "lock":
        if (cur.status !== "generated")
          return NextResponse.json({ error: `Cannot lock a run in status '${cur.status}'` }, { status: 409 });
        next = "locked";
        slice = { status: next, lockedAt: nowIso, lockedBy: myId ?? null, paidAt: null, paidBy: null };
        auditAction = "payroll.run.lock";
        break;
      case "mark_paid":
        if (cur.status !== "locked")
          return NextResponse.json({ error: `Cannot mark paid: run is '${cur.status}', not 'locked'` }, { status: 409 });
        next = "paid";
        slice = { status: next, lockedAt: cur.lockedAt, lockedBy: cur.lockedBy, paidAt: nowIso, paidBy: myId ?? null };
        auditAction = "payroll.run.mark_paid";
        break;
      case "reopen":
        if (cur.status === "generated") {
          next = "draft";
          // Clear any stale lock/paid stamps if a previous lifecycle left them.
          slice = { status: next, lockedAt: null, lockedBy: null, paidAt: null, paidBy: null };
          auditAction = "payroll.run.reopen_from_generated";
        } else if (cur.status === "locked") {
          // Unlocking a LOCKED payroll is restricted to the salary-trusted
          // developer (gagan) — HR / CEO can lock & pay but not reopen a
          // finalised run. (Reopening a not-yet-locked 'generated' run above
          // stays open to all salary admins — it's a normal pre-lock fix.)
          if (!isSalaryDeveloper(user))
            return NextResponse.json({ error: "Only the developer can unlock a locked payroll." }, { status: 403 });
          next = "generated";
          slice = { status: next, lockedAt: null, lockedBy: null, paidAt: null, paidBy: null };
          auditAction = "payroll.run.unlock";
        } else {
          return NextResponse.json({ error: `Cannot re-open a run in status '${cur.status}'` }, { status: 409 });
        }
        break;
      default:
        // Unreachable — the whitelist above guards us, but TypeScript
        // can't see that without an exhaustive check.
        return NextResponse.json({ error: "action must be lock | mark_paid | reopen" }, { status: 400 });
    }

    // Merge the new slice into brandStatus. With a brand, only that brand's
    // slice changes. Without a brand (legacy whole-run action), write both
    // brands' slices AND the legacy top-level columns so every surface agrees.
    const data: any = {};
    if (brand) {
      // Seed BOTH brands from their current effective status first, so the
      // untouched brand gets an explicit frozen slice and never falls back
      // to the (mutable) legacy column again. Then apply this brand's change.
      const brandStatus = materializeBrandStatus(run) as Record<string, any>;
      brandStatus[brand] = slice;
      data.brandStatus = brandStatus;
    } else {
      const brandStatus: Record<string, any> = { ...((run.brandStatus as Record<string, any>) ?? {}) };
      brandStatus["NB Media"] = slice;
      brandStatus["YT Labs"]  = slice;
      data.brandStatus = brandStatus;
      data.status   = next;
      data.lockedAt = slice.lockedAt ? new Date(slice.lockedAt) : null;
      data.lockedBy = slice.lockedBy;
      data.paidAt   = slice.paidAt ? new Date(slice.paidAt) : null;
      data.paidBy   = slice.paidBy;
    }

    const updated = await prisma.payrollRun.update({ where: { id: runId }, data });

    await writeAuditLog({
      req,
      actorId: myId ?? null,
      actorEmail: user.email ?? null,
      action: auditAction,
      entityType: "PayrollRun",
      entityId: runId,
      before: { status: cur.status, brand: brand ?? "all" },
      after:  { status: next, brand: brand ?? "all" },
    });

    // Releasing to employees (locked → paid) auto-emails each one their
    // payslip PDF. Fire-and-forget: a slow/failed mail run must never block
    // or fail the status transition. Dynamic import keeps puppeteer/email
    // out of the hot path for lock/reopen.
    if (action === "mark_paid") {
      // Scope the mailout to the brand just marked paid — otherwise marking
      // NB Media paid would email YT Labs employees their (unreleased) slips.
      import("@/lib/hr/payslip-email")
        .then(({ emailPayslipsForRun }) => emailPayslipsForRun(runId, brand ?? undefined))
        .catch((e) => console.error("[payslip-email] dispatch failed:", e));
    }

    return NextResponse.json({ run: updated });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/runs/[id]/transition"); }
}
