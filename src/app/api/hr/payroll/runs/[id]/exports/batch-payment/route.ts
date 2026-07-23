// BatchPayment_Monthly_Statement_{Mon_YYYY}.xlsx
//
// Workbook layout mirrors the customer's existing Keka export byte-for-byte:
//   • Sheet 1: "Payment Summary" — company name + month + 3-col bank summary
//     (BANK NAME | HEAD COUNT | TOTAL NET PAY), one row per bank UPPERCASED.
//   • Sheets 2..N: one sheet per bank (sheet name lowercased) with a per-
//     employee transfer slip — S NO / Empno / Name / Department / Bank /
//     IFSCCode / Bank Account No / Amount.
//
// Bank columns start at column B in both sheet types (column A intentionally
// empty to match the source). Title rows on each sheet are MERGED — the
// downstream tooling at the bank renders them as a heading band.

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { loadExportRows, monShort, monYearUnderscore, safeSheetName,
  brandParam, filterRowsByBrand, COMPANY_BY_BRAND, BRAND_SLUG } from "@/lib/payroll-exports";
import { readBrandStatus } from "@/lib/hr/payroll-run-status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const runId = parseInt(id);
    if (!Number.isFinite(runId)) return NextResponse.json({ error: "Bad runId" }, { status: 400 });

    const { run, rows } = await loadExportRows(runId);
    // Brand split: ?brand= exports only that brand's employees; no brand => all.
    const brand = brandParam(req);
    // Gate downloads until HR has locked THIS BRAND's run — draft / generated
    // runs can still change, and the bank should never see a half-final batch.
    const runStatus = readBrandStatus(run, brand).status;
    if (runStatus !== "locked" && runStatus !== "paid") {
      return NextResponse.json({ error: `Lock the run first — currently '${runStatus}'` }, { status: 409 });
    }
    const scoped = filterRowsByBrand(rows, brand);
    if (brand && scoped.length === 0) {
      return NextResponse.json({ error: `No ${brand} employees in this payroll run.` }, { status: 422 });
    }

    // Skip on-hold payslips entirely. Hold means HR isn't paying them
    // this cycle, so they shouldn't appear in the bank transfer file.
    const payable = scoped.filter(r => r.status !== "on_hold");

    // Reject the download if any payable row is missing bank info —
    // dumping a half-filled file to the bank would bounce the batch.
    const missing = payable.filter(r => !r.bankName || !r.bankAccountNumber || !r.bankIfsc);
    if (missing.length > 0) {
      return NextResponse.json({
        error: "Cannot export — bank details missing for some employees",
        missing: missing.map(m => ({ name: m.name, employeeId: m.employeeId })),
      }, { status: 422 });
    }

    // Bucket by bank, CASE-INSENSITIVELY — different capitalisations of the
    // same bank ("Punjab National Bank" vs "Punjab national bank") must merge
    // into one bucket, otherwise they'd produce two sheets whose lowercased
    // names collide and ExcelJS throws "duplicate worksheet name". Keep the
    // first-seen spelling as the display label.
    const byBank = new Map<string, { display: string; items: typeof payable }>();
    for (const r of payable) {
      const key = r.bankName!.trim().toLowerCase();
      const entry = byBank.get(key) ?? { display: r.bankName!.trim(), items: [] as typeof payable };
      entry.items.push(r);
      byBank.set(key, entry);
    }
    const bankList = Array.from(byBank.values()).sort((a, b) => a.display.localeCompare(b.display));

    const monthYearTitle = `${monShort(run.month)}, ${run.year}`;

    const wb = new ExcelJS.Workbook();

    // ── Sheet 1: Payment Summary ────────────────────────────────────
    const summary = wb.addWorksheet("Payment Summary");
    summary.mergeCells("A1:D1");
    summary.getCell("A1").value = brand === "YT Labs"
      ? COMPANY_BY_BRAND["YT Labs"].toUpperCase()
      : "YT MONEY PRODUCTIONS PRIVATE LIMITED";
    summary.getCell("A1").font = { bold: true };
    summary.mergeCells("A2:D2");
    summary.getCell("A2").value = `Bank Transfer Statement for the month of ${monthYearTitle}`;
    summary.getCell("A2").font = { bold: true };
    summary.mergeCells("B3:D3");
    summary.getCell("B3").value = "Currency : INR";

    summary.getCell("B4").value = "BANK NAME";
    summary.getCell("C4").value = "HEAD COUNT";
    summary.getCell("D4").value = "TOTAL NET PAY";
    summary.getRow(4).font = { bold: true };

    let r = 5;
    for (const bank of bankList) {
      const items = bank.items;
      const sum = items.reduce((s, i) => s + i.netPay, 0);
      summary.getCell(`B${r}`).value = bank.display.toUpperCase();
      summary.getCell(`C${r}`).value = items.length;
      summary.getCell(`D${r}`).value = Math.round(sum * 100) / 100; // actual value, with paise
      r += 1;
    }

    summary.getColumn(2).width = 32;
    summary.getColumn(3).width = 14;
    summary.getColumn(4).width = 16;

    // ── Sheets 2..N: one per bank ───────────────────────────────────
    const usedSheetNames = new Set<string>(["payment summary"]);
    for (const bank of bankList) {
      const items = bank.items;
      // Guard the rare case where two distinct banks sanitize/truncate to the
      // same 31-char sheet name — append a counter so addWorksheet is unique.
      let sheetName = safeSheetName(bank.display.toLowerCase());
      if (usedSheetNames.has(sheetName.toLowerCase())) {
        let n = 2;
        while (usedSheetNames.has(`${safeSheetName(bank.display.toLowerCase()).slice(0, 28)} ${n}`.toLowerCase())) n++;
        sheetName = `${safeSheetName(bank.display.toLowerCase()).slice(0, 28)} ${n}`;
      }
      usedSheetNames.add(sheetName.toLowerCase());
      const ws = wb.addWorksheet(sheetName);

      ws.mergeCells("B1:H1");
      ws.getCell("B1").value = `Bank Transfer Statement for the month of ${monthYearTitle}`;
      ws.getCell("B1").font = { bold: true };
      ws.mergeCells("B2:I2");
      ws.getCell("B2").value = "Currency : INR";

      const headers = ["S NO", "Empno", "Name", "Department", "Bank", "IFSCCode", "Bank Account No", "Amount"];
      headers.forEach((h, i) => {
        const cell = ws.getCell(3, i + 2); // start at column B
        cell.value = h;
        cell.font = { bold: true };
      });

      items.forEach((r, idx) => {
        const row = idx + 4;
        ws.getCell(row, 2).value = idx + 1;             // S NO
        ws.getCell(row, 3).value = r.employeeId ?? "";
        ws.getCell(row, 4).value = r.name;
        ws.getCell(row, 5).value = r.department ?? "";
        ws.getCell(row, 6).value = r.bankName ?? "";    // Title Case as stored
        ws.getCell(row, 7).value = r.bankIfsc ?? "";
        ws.getCell(row, 8).value = r.bankAccountNumber ?? "";
        ws.getCell(row, 9).value = Math.round(r.netPay * 100) / 100; // actual value, with paise
      });

      ws.getColumn(2).width = 6;
      ws.getColumn(3).width = 10;
      ws.getColumn(4).width = 28;
      ws.getColumn(5).width = 28;
      ws.getColumn(6).width = 28;
      ws.getColumn(7).width = 16;
      ws.getColumn(8).width = 22;
      ws.getColumn(9).width = 12;
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `BatchPayment_Monthly_Statement_${monYearUnderscore(run.month, run.year)}${brand ? `_${BRAND_SLUG[brand]}` : ""}.xlsx`;
    return new NextResponse(buf as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/runs/[id]/exports/batch-payment"); }
}
