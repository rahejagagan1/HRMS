import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { getBrandScope } from "@/lib/hr/brand-scope";
import { getMonthSalary } from "@/lib/hr/salary-periods";
import { regularSplit } from "@/lib/hr/salary-split";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const admin = canViewSalary(user);

  const { searchParams } = new URL(req.url);
  // Admins can target any userId; everyone else only their own. If a
  // non-admin asks for someone else's structure they get 403 — better
  // than silently swapping to their own (would mask UI bugs).
  let userId: number;
  const requested = searchParams.get("userId");
  if (requested) {
    const n = parseInt(requested);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ error: "Bad userId" }, { status: 400 });
    }
    if (!admin && n !== user.dbId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    userId = n;
  } else {
    userId = user.dbId;
  }

  try {
    // Brand-scope: even an admin who passes canViewSalary should
    // only see same-brand salary structures unless they're a
    // developer / in the cross-brand allowlist. Without this, a
    // YT Labs CEO could fetch ?userId=<NB Media employee> and see
    // their full salary structure.
    if (admin && userId !== user.dbId) {
      const scope = getBrandScope(user);
      if (!scope.allBrands) {
        const target = await prisma.employeeProfile.findUnique({
          where: { userId },
          select: { businessUnit: true },
        });
        const targetBu = target?.businessUnit ?? null;
        if (targetBu && targetBu !== scope.brand) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
    }

    const structure = await prisma.salaryStructure.findUnique({
      where: { userId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    // Never cache: it's salary PII AND it changes the moment HR sets/updates a
    // structure. Without this a browser/proxy can serve a stale copy — e.g. a
    // `null` cached before the structure was created keeps the profile's salary
    // section blank even after the salary is saved (until a hard refresh).
    return NextResponse.json(structure || null, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/salary-structure"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  if (!canViewSalary(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const {
      userId, ctc, basic, hra,
      dearnessAllowance, conveyanceAllowance, medicalAllowance,
      specialAllowance, pfEmployee, pfEmployer, esiEmployee, esiEmployer,
      tds, professionalTax, effectiveFrom,
      // Extended fields from the onboarding compensation step:
      salaryType, payGroup, bonusIncluded, taxRegime, structureType, pfEligible,
    } = body;
    if (!userId || ctc == null || basic == null || !effectiveFrom) {
      return NextResponse.json({ error: "userId, ctc, basic, effectiveFrom required" }, { status: 400 });
    }

    // Capture the previous structure (if any) for the audit trail.
    const before = await prisma.salaryStructure.findUnique({ where: { userId: parseInt(userId) } });

    const data = {
      ctc, basic, hra: hra ?? 0,
      dearnessAllowance:   dearnessAllowance   ?? 0,
      conveyanceAllowance: conveyanceAllowance ?? 0,
      medicalAllowance:    medicalAllowance    ?? 0,
      specialAllowance:    specialAllowance    ?? 0,
      pfEmployee: pfEmployee ?? 0, pfEmployer: pfEmployer ?? 0,
      esiEmployee: esiEmployee ?? 0, esiEmployer: esiEmployer ?? 0,
      tds: tds ?? 0, professionalTax: professionalTax ?? 0,
      effectiveFrom: new Date(effectiveFrom),
      salaryType:    salaryType    ?? "regular",
      payGroup:      payGroup      ?? null,
      bonusIncluded: bonusIncluded ?? false,
      taxRegime:     taxRegime     ?? null,
      structureType: structureType ?? null,
      pfEligible:    pfEligible    ?? false,
    };

    // SAFETY NET — server owns the component split for REGULAR employees.
    // Every regular structure is (re)derived from CTC via the shared
    // regularSplit(), so no caller can ever store an incomplete/monthly
    // breakdown. The profile salary form already sends these exact values (so
    // this is a no-op for it); the Payroll-admin "Assign Structure" form omits
    // DA/Conveyance/Medical and doesn't auto-split — this fills them in. CTC is
    // the single input; PF eligibility is honoured whether it arrived as the
    // pfEligible flag or as a non-zero PF amount. Interns keep their flat
    // stipend shape untouched.
    if ((data.salaryType ?? "regular") === "regular" && Number(data.ctc) > 0) {
      const pfElig = data.pfEligible === true || Number(pfEmployee) > 0 || Number(pfEmployer) > 0;
      const s = regularSplit(Number(data.ctc), pfElig);
      data.basic = s.basic;
      data.hra = s.hra;
      data.dearnessAllowance = s.da;
      data.conveyanceAllowance = s.conv;
      data.medicalAllowance = s.medical;
      data.specialAllowance = s.special;
      data.pfEmployee = s.pfEmp;
      data.pfEmployer = s.pfEmpr;
      data.pfEligible = pfElig;
    }

    // Snapshot the OLD structure into history BEFORE overwriting it, so the
    // prior rate survives for mid-month proration (see lib/hr/salary-periods).
    // Its window is [old effectiveFrom, new effectiveFrom). Only when the
    // effective date actually moves forward (a real revision) — re-saving with
    // the same date isn't a new period, so skip it to avoid zero-width rows.
    if (before && new Date(effectiveFrom).getTime() > new Date(before.effectiveFrom).getTime()) {
      await prisma.salaryStructureHistory.create({
        data: {
          userId: parseInt(userId),
          salaryType:          before.salaryType,
          ctc:                 before.ctc,
          basic:               before.basic,
          hra:                 before.hra,
          dearnessAllowance:   before.dearnessAllowance,
          conveyanceAllowance: before.conveyanceAllowance,
          medicalAllowance:    before.medicalAllowance,
          specialAllowance:    before.specialAllowance,
          pfEmployee:          before.pfEmployee,
          pfEligible:          before.pfEligible,
          professionalTax:     before.professionalTax,
          effectiveFrom:       before.effectiveFrom,
          effectiveTo:         new Date(effectiveFrom),
        },
      });
    }

    const structure = await prisma.salaryStructure.upsert({
      where: { userId: parseInt(userId) },
      create: { userId: parseInt(userId), ...data },
      update: data,
      include: { user: { select: { id: true, name: true } } },
    });

    // Audit trail — admin assigns / updates a salary structure for an employee.
    await writeAuditLog({
      req,
      actorId: user.dbId ?? null,
      actorEmail: user.email ?? null,
      action: before ? "payroll.structure.update" : "payroll.structure.assign",
      entityType: "SalaryStructure",
      entityId: structure.id,
      before: before ? {
        ctc: String(before.ctc), basic: String(before.basic), hra: String(before.hra),
        effectiveFrom: before.effectiveFrom,
      } : null,
      after: {
        userId: structure.userId,
        ctc: String(structure.ctc), basic: String(structure.basic), hra: String(structure.hra),
        effectiveFrom: structure.effectiveFrom,
      },
    });

    // ── Auto-arrears for a retroactive revision ──────────────────────────
    // When this revision's effectiveFrom lands in a PAST (already-paid) month,
    // top up the shortfall: for every already-generated payslip from the
    // effective month up to last month, pay (new base × that month's paid
    // factor − what was actually paid as base) as an "arrears" Adhoc Payment
    // in the CURRENT month. It lands as a reviewable line in Run Payroll →
    // Adhoc Payments (not paid silently). Best-effort + idempotent: the
    // current-month arrears line for this user is rebuilt on every save, and
    // finalised/locked payroll runs are never re-paid (the run lock guards
    // re-generation).
    try {
      const uid = parseInt(userId);
      const eff = new Date(effectiveFrom);
      const effM = eff.getUTCMonth(), effY = eff.getUTCFullYear();
      const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const curM = istNow.getMonth(), curY = istNow.getFullYear();
      const ymIndex = (m: number, y: number) => y * 12 + m;
      const num = (v: any) => parseFloat(String(v ?? 0)) || 0;
      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

      // Only a retroactive revision (effective strictly before the current
      // month) can produce arrears.
      if (ymIndex(effM, effY) < ymIndex(curM, curY)) {
        // New structure's monthly base earnings (same components generate uses;
        // the regular-split components sum to CTC, so this is CTC / 12).
        const newMonthlyBase = (num(data.basic) + num(data.hra) + num(data.dearnessAllowance)
          + num(data.conveyanceAllowance) + num(data.medicalAllowance) + num(data.specialAllowance)
          + num(data.pfEmployee)) / 12;

        // The already-paid months in [effective month .. last month).
        const range: { month: number; year: number }[] = [];
        for (let i = ymIndex(effM, effY); i < ymIndex(curM, curY); i++) {
          range.push({ month: ((i % 12) + 12) % 12, year: Math.floor(i / 12) });
        }
        const slips = range.length === 0 ? [] : await prisma.payslip.findMany({
          where: { userId: uid, OR: range.map((r) => ({ month: r.month, year: r.year })) },
          select: { month: true, year: true, workingDays: true, presentDays: true, grossEarnings: true, bonus: true },
        });

        if (slips.length > 0) {
          // Adhoc payments already in those months, so we compare the BASE pay
          // (excluding bonus + any prior adhoc/arrears).
          const adhoc = await prisma.$queryRawUnsafe<{ month: number; year: number; amt: string }[]>(
            `SELECT month, year, COALESCE(SUM(amount),0)::text AS amt
               FROM "AdhocLineItem"
              WHERE "userId" = $1 AND kind = 'payment'
              GROUP BY month, year`, uid);
          const adhocByYm = new Map(adhoc.map((a) => [ymIndex(a.month, a.year), num(a.amt)]));

          let total = 0;
          const parts: string[] = [];
          for (const p of slips) {
            const wd = num(p.workingDays) || 1;
            const factor = num(p.presentDays) / wd;          // = that month's lopFactor
            // For the EFFECTIVE month itself, "correct" pay is the MID-MONTH
            // blend (old rate before the effective date + new rate after), not
            // the full new rate — otherwise arrears would undo the mid-month
            // split. Later, fully-post-revision months use the full new base.
            let baseMonthly = newMonthlyBase;
            if (p.month === effM && p.year === effY) {
              const ms = await getMonthSalary(uid, p.year, p.month);
              if (ms?.hasSplit) baseMonthly = ms.blendedMonthlyEarnings;
            }
            const correctBase = baseMonthly * factor;
            const paidBase = num(p.grossEarnings) - num(p.bonus) - (adhocByYm.get(ymIndex(p.month, p.year)) || 0);
            const diff = Math.round((correctBase - paidBase) * 100) / 100;
            if (diff > 0) { total += diff; parts.push(`${MONTHS[p.month]} ${p.year}: +₹${Math.round(diff)}`); }
          }
          total = Math.round(total * 100) / 100;

          // Rebuild this user's current-month arrears line (idempotent).
          await prisma.$executeRawUnsafe(
            `DELETE FROM "AdhocLineItem" WHERE "userId" = $1 AND month = $2 AND year = $3 AND kind = 'payment' AND type = 'arrears'`,
            uid, curM, curY);
          if (total > 0) {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "AdhocLineItem" ("userId", month, year, kind, type, amount, comment, "createdBy")
               VALUES ($1, $2, $3, 'payment', 'arrears', $4, $5, $6)`,
              uid, curM, curY, total.toFixed(2),
              `Salary arrears (auto): ${parts.join("; ")} — revised to CTC ₹${Math.round(num(data.ctc))} effective ${MONTHS[effM]} ${effY}`,
              user.dbId ?? null);
          }
        }
      }
    } catch (arrErr) {
      // Arrears is best-effort — the structure save itself already succeeded.
      console.error("[salary-structure] auto-arrears failed (structure still saved):", arrErr);
    }

    return NextResponse.json(structure, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/salary-structure"); }
}
