// HR-side offboarding — ExitSettlement endpoints (the "Review & Finalise
// Payables" wizard state).
//
//   GET  /api/hr/exits/:id/settlement  → settlement header + lines
//   PUT  /api/hr/exits/:id/settlement  → upsert header + replace lines
//
// We store a single ExitSettlement row per exit (1:1) plus N
// ExitSettlementLine rows (one per payable / deduction). The PUT
// route's contract is: "here is the current state of the wizard,
// please persist it." Lines are diffed by replacement — simpler than
// per-row patching and the line set is tiny (<30 in practice).
//
// Raw SQL because the typed Prisma client may not yet know about the
// new tables (consistent with the rest of the offboarding routes).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// Use canonical isHRAdmin helper.
const canManage = (session: any) => isHRAdmin(session?.user);

const PAY_ACTIONS = new Set(["pay", "recover", "carryover", "hold"]);
const PAYMENT_MODES = new Set(["pay", "hold", "recover"]);
const SETTLEMENT_MODES = new Set(["at_once", "multi_month"]);

type SettlementRow = {
  id: number; exitId: number;
  paymentMode: string; settlementMode: string;
  settlementDate: Date | null; settlementNotes: string | null;
  actualNoticeDays: number; noticeServingDays: number;
  buyoutEligible: boolean; buyoutAmount: string | null;
  gratuityEligible: boolean; gratuityAmount: string | null;
  finalised: boolean; finalisedAt: Date | null; finalisedById: number | null;
};

type LineRow = {
  id: number; settlementId: number;
  section: string; subsection: string; label: string;
  amount: string; payAction: string;
  days: string | null; comment: string | null;
};

async function loadSettlement(exitId: number) {
  const rows = await prisma.$queryRawUnsafe<SettlementRow[]>(
    `SELECT * FROM "ExitSettlement" WHERE "exitId" = $1`, exitId,
  );
  if (rows.length === 0) return { settlement: null, lines: [] as LineRow[] };
  const lines = await prisma.$queryRawUnsafe<LineRow[]>(
    `SELECT * FROM "ExitSettlementLine" WHERE "settlementId" = $1 ORDER BY id ASC`,
    rows[0].id,
  );
  return { settlement: rows[0], lines };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const data = await loadSettlement(id);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("[GET /api/hr/exits/:id/settlement] failed:", e);
    return NextResponse.json({ error: "Could not load settlement" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Reject edits to a finalised settlement — once HR clicks "Pay & Mark
    // as Settled" the figures are frozen. They can reactivate the exit
    // (which clears the finalised flag) to make changes.
    const existing = await prisma.$queryRawUnsafe<SettlementRow[]>(
      `SELECT id, finalised FROM "ExitSettlement" WHERE "exitId" = $1`, id,
    );
    if (existing[0]?.finalised) {
      return NextResponse.json(
        { error: "Settlement already finalised — reactivate the exit to edit." },
        { status: 409 },
      );
    }

    const body = await req.json();
    const paymentMode = PAYMENT_MODES.has(String(body?.paymentMode)) ? String(body.paymentMode) : "pay";
    const settlementMode = SETTLEMENT_MODES.has(String(body?.settlementMode)) ? String(body.settlementMode) : "at_once";
    const settlementDate = body?.settlementDate ? new Date(body.settlementDate) : null;
    const settlementNotes = body?.settlementNotes ? String(body.settlementNotes) : null;
    const actualNoticeDays = Number.isFinite(Number(body?.actualNoticeDays)) ? Math.max(0, Math.floor(Number(body.actualNoticeDays))) : 0;
    const noticeServingDays = Number.isFinite(Number(body?.noticeServingDays)) ? Math.max(0, Math.floor(Number(body.noticeServingDays))) : 0;
    const buyoutEligible = body?.buyoutEligible === true;
    const buyoutAmount = body?.buyoutAmount != null && body.buyoutAmount !== "" ? Number(body.buyoutAmount) : null;
    const gratuityEligible = body?.gratuityEligible === true;
    const gratuityAmount = body?.gratuityAmount != null && body.gratuityAmount !== "" ? Number(body.gratuityAmount) : null;

    const linesIn: Array<{
      section: string; subsection: string; label: string;
      amount: number; payAction: string; days: number | null; comment: string | null;
    }> = Array.isArray(body?.lines) ? body.lines
      .map((l: any) => ({
        section: String(l?.section || "").slice(0, 64),
        subsection: String(l?.subsection || "").slice(0, 64),
        label: String(l?.label || "").slice(0, 200),
        amount: Number(l?.amount ?? 0),
        payAction: PAY_ACTIONS.has(String(l?.payAction)) ? String(l.payAction) : "pay",
        days: Number.isFinite(Number(l?.days)) ? Number(l.days) : null,
        comment: l?.comment ? String(l.comment) : null,
      }))
      .filter((l: any) => l.section && l.subsection && l.label && Number.isFinite(l.amount))
      : [];

    // Confirm exit exists before upsert so we 404 cleanly.
    const exists = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "EmployeeExit" WHERE id = $1`, id,
    );
    if (exists.length === 0) return NextResponse.json({ error: "Exit not found" }, { status: 404 });

    // Upsert the header — keep finalised flags untouched on update.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ExitSettlement"
         ("exitId", "paymentMode", "settlementMode", "settlementDate", "settlementNotes",
          "actualNoticeDays", "noticeServingDays",
          "buyoutEligible", "buyoutAmount",
          "gratuityEligible", "gratuityAmount", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT ("exitId") DO UPDATE
          SET "paymentMode" = EXCLUDED."paymentMode",
              "settlementMode" = EXCLUDED."settlementMode",
              "settlementDate" = EXCLUDED."settlementDate",
              "settlementNotes" = EXCLUDED."settlementNotes",
              "actualNoticeDays" = EXCLUDED."actualNoticeDays",
              "noticeServingDays" = EXCLUDED."noticeServingDays",
              "buyoutEligible" = EXCLUDED."buyoutEligible",
              "buyoutAmount" = EXCLUDED."buyoutAmount",
              "gratuityEligible" = EXCLUDED."gratuityEligible",
              "gratuityAmount" = EXCLUDED."gratuityAmount",
              "updatedAt" = now()`,
      id, paymentMode, settlementMode, settlementDate, settlementNotes,
      actualNoticeDays, noticeServingDays,
      buyoutEligible, buyoutAmount, gratuityEligible, gratuityAmount,
    );

    // Fetch the freshly upserted settlement id for the lines table.
    const headerRow = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "ExitSettlement" WHERE "exitId" = $1`, id,
    );
    const settlementId = headerRow[0]!.id;

    // Replace lines wholesale — the wizard always sends the full set.
    // Done in a transaction so the user never sees a half-deleted state.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        `DELETE FROM "ExitSettlementLine" WHERE "settlementId" = $1`, settlementId,
      ),
      ...linesIn.map(l =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "ExitSettlementLine"
             ("settlementId", section, subsection, label, amount, "payAction", days, comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          settlementId, l.section, l.subsection, l.label, l.amount, l.payAction, l.days, l.comment,
        )
      ),
    ]);

    const data = await loadSettlement(id);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("[PUT /api/hr/exits/:id/settlement] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
