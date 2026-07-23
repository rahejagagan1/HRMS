// POST /api/hr/letter-templates/:key/generate
//   body: { employeeId, customFields, action: "preview" | "pdf" }
//
// preview → returns { html, missing } so the editor can show a live
//           rendered view in the right-hand pane.
// pdf     → renders the substituted body to HTML, hands it to
//           docx-to-pdf via a tiny HTML→PDF helper, saves the
//           result under EmployeeDocument as a "employee_letter"
//           category, and streams the bytes back so HR can also
//           download it immediately.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isLeadershipOrHR, resolveUserId, serverError } from "@/lib/api-auth";
import { renderLetterHtml, wrapLetterPreviewHtml } from "@/lib/hr/letter-render";
import { htmlToPdf } from "@/lib/hr/html-to-pdf";
import { savePendingDocument } from "@/lib/hr/pending-documents";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { key } = await params;
    const body = await req.json().catch(() => ({}));
    const action: "preview" | "pdf" = body.action === "pdf" ? "pdf" : "preview";

    // Two modes: existing employee (employeeId) OR new joiner (manual
    // typed-in fields — the person isn't in the DB yet).
    const manual = body.manual && typeof body.manual === "object" ? {
      name:              String(body.manual.name ?? "").trim(),
      email:             String(body.manual.email ?? "").trim(),
      designation:       String(body.manual.designation ?? "").trim(),
      department:        String(body.manual.department ?? "").trim(),
      employeeNumber:    String(body.manual.employeeNumber ?? "").trim(),
      joiningDate:       String(body.manual.joiningDate ?? "").trim(),
      applicationDate:   String(body.manual.applicationDate ?? "").trim(),
      probationEndDate:  String(body.manual.probationEndDate ?? "").trim(),
      internshipEndDate: String(body.manual.internshipEndDate ?? "").trim(),
      gender:            String(body.manual.gender ?? "").trim(),
      brand:             body.manual.brand === "YT Labs" ? "YT Labs" : "NB Media",
    } : null;
    const isManual = !!manual;

    const employeeId = Number(body.employeeId);
    if (!isManual && (!Number.isInteger(employeeId) || employeeId <= 0)) {
      return NextResponse.json({ error: "employeeId or a manual recipient is required" }, { status: 400 });
    }
    // A new-joiner PDF MUST carry an email — that's how the parked
    // document later finds the person once they're added to the system.
    if (isManual && action === "pdf" && !manual!.email) {
      return NextResponse.json({ error: "Email is required to save a new-joiner document." }, { status: 400 });
    }
    const customFields: Record<string, string> = body.customFields && typeof body.customFields === "object"
      ? Object.fromEntries(Object.entries(body.customFields).map(([k, v]) => [k, String(v ?? "")]))
      : {};
    // Optional letter-issue date override (YYYY-MM-DD). HR uses this to
    // backdate letters (or post-date them) instead of always stamping
    // today. Ignored if absent or unparseable — the renderer falls back
    // to today's date.
    const letterDate: string | null = typeof body.letterDate === "string" && body.letterDate.trim()
      ? body.letterDate.trim()
      : null;

    // Look up the employee's business unit so we can pick the
    // matching template variant. NULL businessUnit on the
    // EmployeeProfile defaults to "NB Media" (the parent brand).
    let employeeBrand: string = "NB Media";
    if (isManual) {
      employeeBrand = manual!.brand;
    } else {
      try {
        const brandRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT COALESCE(p."businessUnit", 'NB Media') AS bu
             FROM "EmployeeProfile" p WHERE p."userId" = $1 LIMIT 1`,
          employeeId,
        );
        if (brandRows[0]?.bu) employeeBrand = brandRows[0].bu;
      } catch { /* keep default */ }
    }

    // Picker: prefer the brand-specific row; fall back to a NULL-
    // tagged "universal" row. ORDER BY puts the brand-specific
    // match first via the NULLS LAST quirk on a CASE expression.
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, key, title, "bodyHtml", "businessUnit"
         FROM "LetterTemplate"
        WHERE key = $1
          AND ("businessUnit" = $2 OR "businessUnit" IS NULL)
          AND "isActive" = true
        ORDER BY CASE WHEN "businessUnit" = $2 THEN 0 ELSE 1 END
        LIMIT 1`,
      key, employeeBrand,
    );
    if (!rows[0]) {
      // Common case while we wait for YT Labs templates — the
      // employee is YT Labs but only NB Media rows exist.
      return NextResponse.json({
        error: `No "${key}" template configured for ${employeeBrand} yet. Upload a ${employeeBrand} version from Admin → Templates.`,
      }, { status: 404 });
    }
    const tpl = rows[0];

    const { html, missing } = await renderLetterHtml(
      tpl.bodyHtml,
      isManual
        ? { manual: manual!, customFields, letterDate }
        : { employeeId, customFields, letterDate },
    );

    if (action === "preview") {
      // Wrap the body in a full A4-shaped preview HTML doc. The
      // wrapper picks the right brand chrome (letterhead text +
      // logo + watermark) from the matched template's businessUnit:
      // NB Media → YT Money Productions letterhead with nb-media
      // logo; YT Labs → BILLION FILMS letterhead with the YT Labs
      // hash icon.
      const fullHtml = await wrapLetterPreviewHtml(html, tpl.title, tpl.businessUnit);
      return NextResponse.json({ html: fullHtml, missing, title: tpl.title });
    }

    // PDF flow — render the SAME brand-aware preview HTML the
    // editor's preview pane uses, then convert it to PDF via
    // LibreOffice. This guarantees preview === PDF for both brands:
    //
    //   NB Media → YT Money Productions letterhead + nb-media logo
    //              + Nikit Bassi signature
    //   YT Labs  → BILLION FILMS letterhead + YT Labs hash logo
    //              + Kunal Lall signature
    //
    // The earlier per-template DOCX pipeline was retired because it
    // used jd-template.docx as the canvas — which only carries the
    // NB Media chrome. YT Labs letters previewed correctly but
    // generated with NB Media branding. HTML→PDF via LibreOffice
    // unifies the two outputs and removes the brand-divergence bug.
    // Render the SAME HTML the in-app preview iframe uses, then
    // hand it to headless Chromium. Because Chrome is rendering
    // both surfaces (in-iframe preview AND server-side PDF), the
    // two outputs are guaranteed to match byte-for-byte — no more
    // "preview looks fine but PDF is broken" divergence.
    //
    // Previously we used LibreOffice's HTML→PDF importer which
    // mangled modern CSS (position:absolute, flex, mm widths,
    // display:block on inline elements). That forced us into a
    // separate stripped-down wrapLetterForPdf wrapper plus a
    // pdf-lib watermark stamp — clunky and never quite matched
    // the preview. Chrome handles all of it natively.
    const fullHtml = await wrapLetterPreviewHtml(html, tpl.title, tpl.businessUnit);
    let pdfBytes: Buffer | null = null;
    try {
      pdfBytes = await htmlToPdf(fullHtml);
    } catch (e) {
      console.warn("[letter generate] HTML→PDF (Chromium) failed:", (e as any)?.message);
    }

    if (!pdfBytes) {
      // Dev fallback (LibreOffice missing on local machines) —
      // serve the substituted HTML so HR can preview / browser-
      // print. Production always hits the PDF path.
      //
      // SECURITY: stream through the same hardened preview envelope
      // (CSP default-src 'none' + img-src data: + style-src
      // 'unsafe-inline', sandbox-equivalent at the document level)
      // so even a malicious template body that somehow slipped past
      // the parser-based sanitiser can't execute scripts on the
      // app origin. Add nosniff + frame DENY headers as
      // belt-and-braces against MIME-confusion / clickjacking.
      // Already-built brand-aware HTML — reuse instead of re-wrapping.
      return new NextResponse(fullHtml, {
        headers: {
          "Content-Type":             "text/html; charset=utf-8",
          "Content-Security-Policy":  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options":   "nosniff",
          "X-Frame-Options":          "DENY",
          "Referrer-Policy":          "no-referrer",
          "Cache-Control":            "private, no-store",
        },
      });
    }

    // Persist the generated PDF.
    //   • Existing employee → EmployeeDocument (shows in Documents now).
    //   • New joiner        → PendingDocument, parked by email until the
    //                         person is added to the system, then
    //                         auto-attached to their Documents tab.
    const myId = await resolveUserId(session);
    const recipientSlug = isManual
      ? (manual!.name || manual!.email || "new-joiner").replace(/[^A-Za-z0-9]+/g, "-")
      : String(employeeId);
    const fileName = `${tpl.title.replace(/[^A-Za-z0-9]+/g, "-")}-${recipientSlug}.pdf`;
    if (isManual) {
      await savePendingDocument({
        email:       manual!.email,
        fullName:    manual!.name || null,
        category:    "employee_letter",
        templateKey: key,
        fileName,
        fileBlob:    pdfBytes,
        fileMime:    "application/pdf",
        brand:       employeeBrand,
        createdById: myId ?? null,
      });
    } else {
      try {
        const inserted = await prisma.$queryRawUnsafe<any[]>(
          `INSERT INTO "EmployeeDocument"
             ("userId","category","fileName","fileUrl","fileBlob","fileMime",
              "uploadedById","isVerified","createdAt")
           VALUES ($1,$2,$3,'',$4::bytea,$5,$6,false,NOW())
           RETURNING id`,
          employeeId, "employee_letter", fileName, pdfBytes, "application/pdf", myId ?? null,
        );
        const docId = inserted[0]?.id;
        if (docId) {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeDocument" SET "fileUrl" = $1 WHERE id = $2`,
            `/api/hr/documents/${docId}/file`, docId,
          );
        }
      } catch (e) {
        console.warn("[letter generate] document persist failed:", (e as any)?.message);
      }
    }

    return new NextResponse(new Uint8Array(pdfBytes), {
      headers: {
        "Content-Type":             "application/pdf",
        "Content-Disposition":      `inline; filename="${fileName}"`,
        "Cache-Control":            "private, no-store",
        "X-Content-Type-Options":   "nosniff",
        "X-Frame-Options":          "SAMEORIGIN",
        "Content-Security-Policy":  "frame-ancestors 'self'",
      },
    });
  } catch (e) {
    return serverError(e, "POST /api/hr/letter-templates/[key]/generate");
  }
}
