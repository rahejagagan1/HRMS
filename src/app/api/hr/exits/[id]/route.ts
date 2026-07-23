// HR-side single-exit endpoint. Drives the offboarding detail drawer.
//
//   GET   → full hydrated payload (exit + user + settlement + tasks +
//           survey + notes) so the drawer renders in one round-trip.
//   PATCH → tick off clearance items, flip status, edit notes.
//
// Legacy clients may still send the old status vocab (notice_period /
// cleared / offboarded); we normalise those to the new 3-state values
// so a stale browser tab doesn't 400 after deploy.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/** SECURITY MODEL — read this before tightening.
 *
 *  Per-row brand restriction is INTENTIONALLY OFF on the
 *  offboarding [id] endpoint, per HR's explicit design choice:
 *  the UI exposes brand tabs (NB Media | YT Labs) and HR
 *  Managers can click into any exit from either tab. So this
 *  endpoint trusts the canManage(session) gate above as the
 *  authorisation boundary, not the row's businessUnit.
 *
 *  Threat model:
 *    • The endpoint is canManage-gated (HR Manager / orgLevel=
 *      hr_manager / role=admin / CEO / developer). A regular
 *      employee can never reach this function.
 *    • Brand is a UI filter on the list view, not an access
 *      boundary on individual rows. The list endpoint
 *      (/api/hr/exits) accepts ?brand= for the same reason.
 *
 *  If you later want to re-tighten (e.g. brand=NB Media for the
 *  per-brand HR Manager only), restore a real check here. The
 *  function signature is preserved so call sites don't need to
 *  be edited at that point. */
async function brandGate(_session: any, _exitId: number): Promise<"allow"> {
  return "allow";
}

// Use canonical isHRAdmin helper. Inline copy omitted
// special_access — drift restored by routing through the helper.
const canManage = (session: any) => isHRAdmin(session?.user);

const STATUS_VALUES = new Set(["under_review", "in_progress", "exited"]);

type ExitDetail = {
  id: number; userId: number; status: string; exitType: string;
  resignationDate: Date; lastWorkingDay: Date; noticePeriodDays: number;
  reason: string | null; notes: string | null;
  assetsReturned: boolean; documentsHandled: boolean;
  finalSettlementDone: boolean; exitInterviewDone: boolean;
  okToRehire: boolean; createdAt: Date;
  userName: string; userEmail: string;
  designation: string | null; department: string | null;
  managerName: string | null;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Brand-scope: per-brand HR Managers can only read exits for
    // employees in their own brand. Returns 404 on cross-brand
    // access (not 403) to avoid leaking the existence of IDs in
    // the other brand's pipeline.
    // brandGate is currently a no-op — keeping the call site for
    // future re-introduction of per-row brand restrictions.
    await brandGate(session, id);

    const exitRows = await prisma.$queryRawUnsafe<ExitDetail[]>(
      `SELECT e.id, e."userId", e.status, e."exitType",
              e."resignationDate", e."lastWorkingDay", e."noticePeriodDays",
              e.reason, e.notes,
              e."assetsReturned", e."documentsHandled",
              e."finalSettlementDone", e."exitInterviewDone",
              e."okToRehire", e."createdAt",
              u.name AS "userName", u.email AS "userEmail",
              ep.designation, ep.department,
              m.name AS "managerName"
         FROM "EmployeeExit" e
         JOIN "User" u ON u.id = e."userId"
    LEFT JOIN "EmployeeProfile" ep ON ep."userId" = e."userId"
    LEFT JOIN "User" m ON m.id = u."managerId"
        WHERE e.id = $1`,
      id,
    );
    if (exitRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const exit = exitRows[0];

    const [settlement, lines, tasks, survey, notes] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ExitSettlement" WHERE "exitId" = $1`, id),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT esl.* FROM "ExitSettlementLine" esl
           JOIN "ExitSettlement" es ON es.id = esl."settlementId"
          WHERE es."exitId" = $1
          ORDER BY esl.id ASC`,
        id,
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT t.*, u.name AS "assigneeName", u."profilePictureUrl" AS "assigneePicture"
           FROM "ExitTask" t
      LEFT JOIN "User" u ON u.id = t."assigneeId"
          WHERE t."exitId" = $1
          ORDER BY t."createdAt" ASC`,
        id,
      ),
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "ExitSurvey" WHERE "exitId" = $1`, id),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT n.id, n."exitId", n."authorId",
                u.name AS "authorName",
                u."profilePictureUrl" AS "authorPicture",
                n.body, n."createdAt"
           FROM "ExitNote" n
      LEFT JOIN "User" u ON u.id = n."authorId"
          WHERE n."exitId" = $1
          ORDER BY n."createdAt" DESC`,
        id,
      ),
    ]);

    return NextResponse.json({
      exit,
      settlement: settlement[0] ?? null,
      settlementLines: lines,
      tasks,
      survey: survey[0] ?? null,
      notes,
    });
  } catch (e: any) {
    console.error("[GET /api/hr/exits/:id] failed:", e);
    return NextResponse.json({ error: "Could not load exit" }, { status: 500 });
  }
}

/**
 * Forgiving status normaliser. Accepts both the new 3-state vocab and
 * the legacy notice_period / cleared / offboarded so an old browser
 * tab whose JS hasn't reloaded after deploy doesn't error out.
 */
function normaliseStatus(raw: unknown): string | null {
  const s = String(raw || "").trim();
  if (STATUS_VALUES.has(s)) return s;
  if (s === "notice_period" || s === "cleared") return "in_progress";
  if (s === "offboarded") return "exited";
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Brand-scope mutations the same way GET does. A cross-brand
    // HR Manager shouldn't be able to flip another brand's exit
    // status or tick clearance items.
    // brandGate is currently a no-op — keeping the call site for
    // future re-introduction of per-row brand restrictions.
    await brandGate(session, id);

    const body = await req.json();

    const sets: string[] = [];
    const args: any[] = [];
    let i = 1;
    let resolvedStatus: string | null = null;
    if (body.status !== undefined) {
      resolvedStatus = normaliseStatus(body.status);
      if (!resolvedStatus) {
        return NextResponse.json(
          { error: "Invalid status — must be one of under_review, in_progress, exited." },
          { status: 400 },
        );
      }
      sets.push(`status = $${i++}`); args.push(resolvedStatus);
    }
    for (const k of ["assetsReturned", "documentsHandled", "finalSettlementDone", "exitInterviewDone", "okToRehire"]) {
      if (body[k] !== undefined) { sets.push(`"${k}" = $${i++}`); args.push(!!body[k]); }
    }
    if (body.notes !== undefined) { sets.push(`notes = $${i++}`); args.push(body.notes || null); }

    // Summary-card editable fields. exitType is validated against the
    // documented set; the two dates land via ::date casts so anything
    // beyond a valid YYYY-MM-DD throws at the DB layer; noticePeriodDays
    // requires a positive integer.
    if (body.exitType !== undefined) {
      const VALID_EXIT_TYPES = new Set(["resignation","termination","contract_end","retirement","other"]);
      const v = String(body.exitType || "").toLowerCase().trim();
      if (!VALID_EXIT_TYPES.has(v)) {
        return NextResponse.json({ error: "Invalid exitType" }, { status: 400 });
      }
      sets.push(`"exitType" = $${i++}`); args.push(v);
    }
    if (body.resignationDate !== undefined) {
      const v = String(body.resignationDate || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json({ error: "Invalid resignationDate (expected YYYY-MM-DD)" }, { status: 400 });
      }
      sets.push(`"resignationDate" = $${i++}::date`); args.push(v);
    }
    if (body.lastWorkingDay !== undefined) {
      const v = String(body.lastWorkingDay || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json({ error: "Invalid lastWorkingDay (expected YYYY-MM-DD)" }, { status: 400 });
      }
      sets.push(`"lastWorkingDay" = $${i++}::date`); args.push(v);
    }
    if (body.noticePeriodDays !== undefined) {
      const n = Number(body.noticePeriodDays);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        return NextResponse.json({ error: "Invalid noticePeriodDays (0–365)" }, { status: 400 });
      }
      sets.push(`"noticePeriodDays" = $${i++}`); args.push(n);
    }
    if (body.reason !== undefined) {
      const r = typeof body.reason === "string" ? body.reason.trim() : "";
      sets.push(`reason = $${i++}`); args.push(r || null);
    }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    sets.push(`"updatedAt" = now()`);
    args.push(id);

    // Status drives User.isActive — the employee stays active through
    // under_review + in_progress so they remain visible in search /
    // directory / mention pickers. Only when HR flips status to
    // "exited" do we deactivate the account. Flipping back to an
    // earlier status reactivates them. Done in one transaction so the
    // exit row and the user flag never get out of sync.
    const ops: any[] = [
      prisma.$executeRawUnsafe(
        `UPDATE "EmployeeExit" SET ${sets.join(", ")} WHERE id = $${i}`,
        ...args,
      ),
    ];
    if (resolvedStatus !== null) {
      const shouldDeactivate = resolvedStatus === "exited";
      ops.push(prisma.$executeRawUnsafe(
        `UPDATE "User" SET "isActive" = $1
           WHERE id = (SELECT "userId" FROM "EmployeeExit" WHERE id = $2)`,
        !shouldDeactivate, id,
      ));
      // Finalising an exit voids any still-pending probation — a person
      // who has left can't be "on probation", so the open window and its
      // reminder stamps are cleared (confirmed probations keep their
      // history), and any pending manager recommendation is dropped from
      // the HR queue. NOT restored on reactivation / flipping the status
      // back — HR re-sets the probation end date manually if the person
      // returns mid-probation.
      if (shouldDeactivate) {
        ops.push(prisma.$executeRawUnsafe(
          `UPDATE "EmployeeProfile"
              SET "probationEndDate" = NULL,
                  "probationReminderSentAt" = NULL,
                  "probationManagerNotifiedAt" = NULL
            WHERE "userId" = (SELECT "userId" FROM "EmployeeExit" WHERE id = $1)
              AND "probationConfirmedAt" IS NULL
              AND "probationEndDate" IS NOT NULL`,
          id,
        ));
        ops.push(prisma.$executeRawUnsafe(
          `DELETE FROM "ProbationReview"
            WHERE "employeeUserId" = (SELECT "userId" FROM "EmployeeExit" WHERE id = $1)
              AND status = 'pending'`,
          id,
        ));
      }
    }
    await prisma.$transaction(ops);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[PATCH /api/hr/exits/:id] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
