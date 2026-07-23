import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { normaliseBrandParam } from "@/lib/hr/brand-scope";
import { readBrandStatus, materializeBrandStatus } from "@/lib/hr/payroll-run-status";
import { getMonthSalary } from "@/lib/hr/salary-periods";

// POST /api/hr/payroll/generate — produce draft payslips for a payroll run.
// Math model:
//   workingDays  = calendar days in run.month (28 / 30 / 31)
//   lopDays      = absent + lop + 0.5 × (half_day + half_day_lop) + unpaid-leave weekdays in month
//   paidDays     = workingDays − lopDays
//   lopFactor    = paidDays / workingDays
//   gross        = (basic + hra + specialAllowance) / 12 × lopFactor
//                  + bonus + Σ AdhocLineItem(kind=payment)
//   deductions   = (pf + esi) × lopFactor
//                  + flat(pt) + tds/12
//                  + Σ AdhocLineItem(kind=deduction)
//   then TaxOverride rows replace the matching PT/ESI/TDS/LWF amounts.
//   SalaryHold (kind=processing) — skip payslip entirely.
//   SalaryHold (kind=payout)     — generate payslip but stamp status=on_hold.
//
// The bonus pull picks EmployeeBonus rows with paymentStatus='due_future'
// and effectiveDate inside the run month — paid_past rows are ledger-only.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  if (!canViewSalary(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { runId, brand } = await req.json();
    if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });

    // Per-brand status: generation is scoped to `brand`'s employees, so the
    // lock guard and the status writes act on that brand's slice only. A
    // null brand (whole-org generate) falls back to the legacy top-level
    // column, matching the old behaviour.
    const brandNorm = normaliseBrandParam(brand);
    const curStatus = readBrandStatus(run, brandNorm).status;
    if (curStatus === "locked" || curStatus === "paid")
      return NextResponse.json({ error: "Run is locked — re-open it before regenerating" }, { status: 409 });

    // Writes the run's status for the current brand slice (or the legacy
    // top-level column when no brand). Reuses/mutates `brandStatusMap` so
    // the two calls in this request don't need to re-read the row. When a
    // brand is set we seed BOTH brands' slices (materialize) so the other
    // brand freezes to its own status and never falls back to the legacy
    // column — generating one brand can't move the other's lock state.
    const brandStatusMap: Record<string, any> = brandNorm
      ? (materializeBrandStatus(run) as Record<string, any>)
      : { ...((run.brandStatus as Record<string, any>) ?? {}) };
    const setRunStatus = async (status: string, extra: Record<string, any> = {}) => {
      if (brandNorm) {
        brandStatusMap[brandNorm] = { ...(brandStatusMap[brandNorm] ?? {}), status };
        return prisma.payrollRun.update({ where: { id: runId }, data: { brandStatus: brandStatusMap, ...extra } });
      }
      return prisma.payrollRun.update({ where: { id: runId }, data: { status, ...extra } });
    };

    await setRunStatus("processing");

    const structures = await prisma.salaryStructure.findMany({
      include: { user: { select: { id: true, isActive: true, employeeProfile: { select: { businessUnit: true } } } } },
    });

    const firstDay = new Date(Date.UTC(run.year, run.month, 1));
    const lastDay  = new Date(Date.UTC(run.year, run.month + 1, 0));
    const daysInMonth = lastDay.getUTCDate();

    // Exited/offboarded employees (isActive=false) who still worked part of
    // this run month must be paid too. Pull their last working day so we can
    // (a) include them despite isActive=false and (b) prorate up to the LWD.
    const exitRows = await prisma.$queryRawUnsafe<{ userId: number; lastWorkingDay: Date }[]>(
      `SELECT "userId", "lastWorkingDay" FROM "EmployeeExit" WHERE "lastWorkingDay" IS NOT NULL`,
    );
    const exitLwdByUser = new Map<number, Date>(exitRows.map(r => [r.userId, new Date(r.lastWorkingDay)]));

    // Brand scope: when "NB Media" / "YT Labs" is passed (the Run Payroll brand
    // dropdown), only that brand's employees are processed — so each brand's
    // payroll runs independently. brandOf semantics: YT Labs is exact; NB Media
    // is everything else (incl. null / legacy), so no employee is silently
    // skipped. Payslips are upserted per-user, so generating one brand never
    // wipes the other's payslips in the same run.
    const activeStructures = structures.filter(s => {
      const bu = (s.user as any).employeeProfile?.businessUnit ?? null;
      const brandOk = brand === "YT Labs" ? bu === "YT Labs" : brand === "NB Media" ? bu !== "YT Labs" : true;
      if (!brandOk) return false;
      if (s.user.isActive) return true;
      // Inactive → include only if they exited in/after this run month, i.e.
      // their last working day is on/after the 1st (they worked part of it).
      const lwd = exitLwdByUser.get(s.userId);
      return !!lwd && lwd.getTime() >= firstDay.getTime();
    });

    // Bulk-fetch all cycle-scoped overrides once and bucket by userId so
    // the per-employee block stays a hash lookup, not N+1 queries.
    const bonusRows = await prisma.$queryRawUnsafe<{ userId: number; amount: string }[]>(
      `SELECT "userId", SUM(amount)::text AS amount
         FROM "EmployeeBonus"
        WHERE "paymentStatus" = 'due_future'
          AND "effectiveDate" >= $1::date
          AND "effectiveDate" <= $2::date
        GROUP BY "userId"`,
      firstDay, lastDay,
    );
    const bonusByUser = new Map<number, number>(
      bonusRows.map(r => [r.userId, parseFloat(r.amount) || 0]),
    );

    // Exclude the legacy "ff_settlement" lump adhoc: for an F&F-month
    // employee the settlement IS the component breakdown (base + advance +
    // leave encashment + other), so adding a separate F&F lump would
    // double-count. Advance Salary and other adhoc types are kept.
    const adhocRows = await prisma.$queryRawUnsafe<{ userId: number; kind: string; amount: string }[]>(
      `SELECT "userId", kind, SUM(amount)::text AS amount
         FROM "AdhocLineItem"
        WHERE month = $1 AND year = $2
          AND (type IS NULL OR type <> 'ff_settlement')
        GROUP BY "userId", kind`,
      run.month, run.year,
    );
    const adhocPayByUser = new Map<number, number>();
    const adhocDedByUser = new Map<number, number>();
    for (const r of adhocRows) {
      const v = parseFloat(r.amount) || 0;
      if (r.kind === "payment")        adhocPayByUser.set(r.userId, v);
      else if (r.kind === "deduction") adhocDedByUser.set(r.userId, v);
    }

    const holdRows = await prisma.$queryRawUnsafe<{ userId: number; kind: string }[]>(
      `SELECT "userId", kind FROM "SalaryHold" WHERE month = $1 AND year = $2`,
      run.month, run.year,
    );
    const holdByUser = new Map<number, string>(holdRows.map(h => [h.userId, h.kind]));

    const overrideRows = await prisma.$queryRawUnsafe<{
      userId: number; kind: string; employeeOverride: string | null; employerOverride: string | null;
    }[]>(
      `SELECT "userId", kind, "employeeOverride", "employerOverride"
         FROM "TaxOverride" WHERE month = $1 AND year = $2`,
      run.month, run.year,
    );
    const overrideByUserKind = new Map<string, { emp: number | null; empr: number | null }>();
    for (const o of overrideRows) {
      overrideByUserKind.set(`${o.userId}:${o.kind}`, {
        emp:  o.employeeOverride !== null ? parseFloat(o.employeeOverride) : null,
        empr: o.employerOverride !== null ? parseFloat(o.employerOverride) : null,
      });
    }

    // ── Batched per-employee reads ──────────────────────────────────
    // Previously the loop ran 4 attendance.count() + 1 leave findMany per
    // employee (5×N serial queries against a 5-connection pool). Replace
    // with one grouped attendance count and one batched leave fetch,
    // bucketed per user into Maps the loop reads as O(1) lookups.
    const userIds = activeStructures.map(s => s.userId);

    const attnGroups = userIds.length ? await prisma.attendance.groupBy({
      by: ["userId", "status"],
      where: {
        userId: { in: userIds },
        date:   { gte: firstDay, lte: lastDay },
        status: { in: ["absent", "lop", "half_day", "half_day_lop"] },
      },
      _count: { _all: true },
    }) : [];
    const attnByUser = new Map<number, { absent: number; lop: number; half_day: number; half_day_lop: number }>();
    for (const g of attnGroups) {
      const bucket = attnByUser.get(g.userId) ?? { absent: 0, lop: 0, half_day: 0, half_day_lop: 0 };
      (bucket as Record<string, number>)[g.status] = g._count._all;
      attnByUser.set(g.userId, bucket);
    }

    // Carry Over Leave balances → leave encashment for employees whose F&F
    // falls in this run month (part of "components ARE the F&F"). Remaining
    // days = total − used − pending; encashed at (Basic + DA) per day / 30.
    const carryByUser = new Map<number, number>();
    try {
      const carryType = await prisma.leaveType.findFirst({
        where: { name: { contains: "Carry Over", mode: "insensitive" } },
        select: { id: true },
      });
      if (carryType && userIds.length) {
        const balances = await prisma.leaveBalance.findMany({
          where: { leaveTypeId: carryType.id, userId: { in: userIds } },
          select: { userId: true, totalDays: true, usedDays: true, pendingDays: true },
        });
        for (const b of balances) {
          const days = Math.max(0, parseFloat(String(b.totalDays)) - parseFloat(String(b.usedDays)) - parseFloat(String(b.pendingDays)));
          if (days > 0) carryByUser.set(b.userId, (carryByUser.get(b.userId) ?? 0) + days);
        }
      }
    } catch { /* no carry-over leave type — skip encashment */ }

    const unpaidLeaveRows = userIds.length ? await prisma.leaveApplication.findMany({
      where: {
        userId:   { in: userIds },
        status:   "approved",
        fromDate: { lte: lastDay },
        toDate:   { gte: firstDay },
        leaveType: { isPaid: false },
      },
      select: { userId: true, fromDate: true, toDate: true },
    }) : [];
    const unpaidLeavesByUser = new Map<number, { fromDate: Date; toDate: Date }[]>();
    for (const lv of unpaidLeaveRows) {
      const arr = unpaidLeavesByUser.get(lv.userId) ?? [];
      arr.push({ fromDate: lv.fromDate, toDate: lv.toDate });
      unpaidLeavesByUser.set(lv.userId, arr);
    }

    let totalNetPay = 0, totalCTC = 0, skipped = 0;

    const payslipsData: any[] = [];

    // Which employees have a superseded salary structure? Only these can have a
    // mid-month split, so we blend earnings only for them — everyone else takes
    // the unchanged single-structure path (zero behaviour change).
    const historyUserIds = new Set(
      (await prisma.salaryStructureHistory.findMany({
        where: { userId: { in: userIds } }, select: { userId: true },
      })).map(h => h.userId),
    );

    for (const s of activeStructures) {
      // processing-hold employees skip payslip generation entirely.
      if (holdByUser.get(s.userId) === "processing") { skipped += 1; continue; }

      // LOP from attendance:
      //   absent       = 1.0   (no swipe at all)
      //   lop          = 1.0   (auto-LOP: missing day past the 48h grace)
      //   half_day     = 0.5   (worked only a half day)
      //   half_day_lop = 0.5   (auto-LOP: missed clock-out not regularized in time)
      // on_leave is paid here; unpaid leaves are netted out separately below.
      const attn = attnByUser.get(s.userId);
      const absentCount     = attn?.absent ?? 0;
      const lopCount        = attn?.lop ?? 0;
      const halfDayCount    = attn?.half_day ?? 0;
      const halfDayLopCount = attn?.half_day_lop ?? 0;

      const unpaidLeaves = unpaidLeavesByUser.get(s.userId) ?? [];
      let unpaidLeaveDays = 0;
      for (const lv of unpaidLeaves) {
        const start = lv.fromDate > firstDay ? lv.fromDate : firstDay;
        const end   = lv.toDate   < lastDay  ? lv.toDate   : lastDay;
        const cur   = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
        const stop  = new Date(Date.UTC(end.getUTCFullYear(),   end.getUTCMonth(),   end.getUTCDate()));
        while (cur.getTime() <= stop.getTime()) {
          const dow = cur.getUTCDay();
          if (dow !== 0 && dow !== 6) unpaidLeaveDays += 1;
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      const lopDays    = absentCount + lopCount + (halfDayCount + halfDayLopCount) * 0.5 + unpaidLeaveDays;
      // Cap the paid-day ceiling at the last working day for anyone exiting
      // this run month — days after the LWD are not worked, so they're unpaid.
      // (LWD in a later month → full month; no exit → full month.)
      const lwd = exitLwdByUser.get(s.userId) ?? null;
      const ceiling = (lwd && lwd.getTime() >= firstDay.getTime() && lwd.getTime() <= lastDay.getTime())
        ? lwd.getUTCDate()
        : daysInMonth;
      const paidDays   = Math.max(0, ceiling - lopDays);
      const lopFactor  = paidDays / daysInMonth;

      // All CTC components are stored as ANNUAL — divide by 12 for the
      // monthly gross. PF (Emp) is included in CTC under the company's
      // split formula (it's a CTC component that flows back out as a
      // statutory deduction below), so it's part of the gross too.
      const basic     = parseFloat(s.basic.toString());
      const hra       = parseFloat(s.hra.toString());
      const da        = parseFloat(s.dearnessAllowance.toString());
      const conv      = parseFloat(s.conveyanceAllowance.toString());
      const medical   = parseFloat(s.medicalAllowance.toString());
      const special   = parseFloat(s.specialAllowance.toString());
      const pfAnnual  = parseFloat(s.pfEmployee.toString());
      const monthlyEarnings = (basic + hra + da + conv + medical + special + pfAnnual) / 12;

      const bonus     = bonusByUser.get(s.userId) || 0;
      const adhocPay  = adhocPayByUser.get(s.userId) || 0;
      const adhocDed  = adhocDedByUser.get(s.userId) || 0;
      // Leave encashment — only for employees whose F&F is THIS month (last
      // working day in the run month). (Basic + DA) per day / 30 × carry-over
      // days. Part of "components ARE the F&F"; regular months add nothing.
      const isFnFMonth = !!lwd && lwd.getTime() >= firstDay.getTime() && lwd.getTime() <= lastDay.getTime();
      const carryDays  = isFnFMonth ? (carryByUser.get(s.userId) || 0) : 0;
      const leaveEncashment = carryDays > 0 ? ((basic + da) / 12 / 30) * carryDays : 0;

      // Mid-month salary revision: if a prior structure covered earlier days of
      // this run month, pay each day-range at its own rate (blended monthly
      // earnings). Only consulted for employees who actually have history, and
      // only overrides when the month is genuinely split — otherwise the
      // single-structure `monthlyEarnings` above is used unchanged.
      let effectiveMonthly = monthlyEarnings;
      if (historyUserIds.has(s.userId)) {
        const ms = await getMonthSalary(s.userId, run.year, run.month);
        if (ms?.hasSplit) effectiveMonthly = ms.blendedMonthlyEarnings;
      }
      const gross     = effectiveMonthly * lopFactor + bonus + adhocPay + leaveEncashment;

      // Computed statutory amounts, then per-(user,kind) override replaces.
      // pfEmployee / esiEmployee are stored ANNUAL (matching other CTC
      // components), so /12 to get the per-month amount before LOP scaling.
      const pfBase    = (pfAnnual / 12) * lopFactor;
      const esiCalc   = (parseFloat(s.esiEmployee.toString()) / 12) * lopFactor;
      const ptCalc    = lopDays > 5 ? 0 : parseFloat(s.professionalTax.toString());
      const tdsCalc   = parseFloat(s.tds.toString()) / 12;

      const ptOvr  = overrideByUserKind.get(`${s.userId}:PT`);
      const esiOvr = overrideByUserKind.get(`${s.userId}:ESI`);
      const tdsOvr = overrideByUserKind.get(`${s.userId}:TDS`);
      const lwfOvr = overrideByUserKind.get(`${s.userId}:LWF`);

      const pt   = ptOvr?.emp  ?? ptCalc;
      const esi  = esiOvr?.emp ?? esiCalc;
      const tds  = tdsOvr?.emp ?? tdsCalc;
      const lwf  = lwfOvr?.emp ?? 0;
      const pf   = pfBase;

      // Fixed ₹200/month tax deduction — applies to regular employees,
      // not interns. Flat amount regardless of LOP (unlike PT which is
      // waived when LOP > 5). Placeholder name pending HR confirming
      // the exact tax this maps to.
      const additionalTax = s.salaryType === "intern" ? 0 : 200;

      const totalDed  = pf + esi + pt + tds + lwf + additionalTax + adhocDed;
      const net       = gross - totalDed;

      // payout-hold rows still generate (so HR sees the math) but with
      // status=on_hold — payslip release endpoints check this flag.
      const isPayoutHold = holdByUser.get(s.userId) === "payout";

      totalCTC    += parseFloat(s.ctc.toString()) / 12;
      if (!isPayoutHold) totalNetPay += net;

      payslipsData.push({
        userId: s.userId,
        payrollRunId: runId,
        salaryStructureId: s.id,
        month: run.month,
        year: run.year,
        workingDays:     daysInMonth,
        presentDays:     paidDays.toFixed(1),
        lopDays:         lopDays.toFixed(1),
        grossEarnings:   gross.toFixed(2),
        totalDeductions: totalDed.toFixed(2),
        netPay:          net.toFixed(2),
        bonus:           bonus.toFixed(2),
        tds:             tds.toFixed(2),
        pfEmployee:      pf.toFixed(2),
        professionalTax: pt.toFixed(2),
        additionalTax:   additionalTax.toFixed(2),
        status:          isPayoutHold ? "on_hold" : "generated",
      });
    }

    // Upsert in small concurrency-bounded batches: a full-company run would
    // otherwise fire N upserts at once and exhaust the 5-connection pool
    // (surplus blocks on pool_timeout → P2024). 4-at-a-time keeps the pool
    // healthy while still parallelising.
    const UPSERT_CHUNK = 4;
    for (let i = 0; i < payslipsData.length; i += UPSERT_CHUNK) {
      const batch = payslipsData.slice(i, i + UPSERT_CHUNK);
      await Promise.all(batch.map(p =>
        prisma.payslip.upsert({
          where:  { userId_month_year: { userId: p.userId, month: p.month, year: p.year } },
          create: p as any,
          update: p as any,
        })
      ));
    }

    const updated = await setRunStatus("generated", {
      totalCTC: totalCTC.toFixed(2),
      totalNetPay: totalNetPay.toFixed(2),
    });

    return NextResponse.json({ run: updated, payslipsGenerated: payslipsData.length, skipped });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/generate"); }
}
