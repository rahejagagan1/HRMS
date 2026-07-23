// Create an OfferLetter for a candidate.
//
// POST /api/hr/hiring/candidates/[id]/offers
//   body: {
//     ctcAnnual?:          number,          // ₹ annual CTC
//     joiningDate?:        string (ISO),
//     expiresAt?:          string (ISO),    // when the offer auto-expires
//     bodyHtml?:           string,          // rendered offer letter body
//     attachmentFileName?: string,
//     attachmentMime?:     string,
//     attachmentBase64?:   string,          // PDF / DOCX bytes (≤ 4MB)
//     sendNow?:            boolean,         // true → status='sent' + email
//     emailSubject?:       string,          // required when sendNow
//     emailBody?:          string,          // required when sendNow
//   }
//
// Creates the row with status='draft' (or 'sent' if sendNow). When
// sendNow is true and emailSubject/emailBody are set, also fires an
// email to the candidate with the offer letter PDF attached.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { sendEmail } from "@/lib/email/sender";
import { renderOfferLetterDocxAttachment } from "@/lib/offer-letter-from-docx";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function approxBase64Bytes(b64: string): number {
  return Math.floor(b64.length * 0.75);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const applicationId = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(applicationId)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    const actorId = await resolveUserId(session);
    const body = await req.json().catch(() => ({}));

    // Numeric parsing
    const ctcAnnual    = body?.ctcAnnual != null && body.ctcAnnual !== "" ? Number(body.ctcAnnual)    : null;
    const joiningDate  = body?.joiningDate  ? new Date(body.joiningDate)  : null;
    const expiresAt    = body?.expiresAt    ? new Date(body.expiresAt)    : null;
    if (ctcAnnual != null && !Number.isFinite(ctcAnnual)) {
      return NextResponse.json({ error: "ctcAnnual must be a number" }, { status: 400 });
    }
    if (joiningDate && isNaN(joiningDate.getTime())) {
      return NextResponse.json({ error: "Invalid joiningDate" }, { status: 400 });
    }
    if (expiresAt && isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: "Invalid expiresAt" }, { status: 400 });
    }

    // Optional attachment (PDF / DOCX bytes).
    let attachmentBlob: Buffer | null = null;
    const attachmentFileName = body?.attachmentFileName ? String(body.attachmentFileName).slice(0, 200) : null;
    const attachmentMime     = body?.attachmentMime     ? String(body.attachmentMime).slice(0, 100)     : null;
    if (typeof body?.attachmentBase64 === "string" && body.attachmentBase64) {
      if (approxBase64Bytes(body.attachmentBase64) > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: "Attachment exceeds 4 MB" }, { status: 400 });
      }
      attachmentBlob = Buffer.from(body.attachmentBase64, "base64");
    }

    const bodyHtml = body?.bodyHtml ? String(body.bodyHtml) : null;
    const sendNow  = !!body?.sendNow;
    const status   = sendNow ? "sent" : "draft";

    // Insert + return id. Soft-failure when the table isn't migrated.
    let offerId: number | null = null;
    try {
      const inserted = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "OfferLetter"
           ("applicationId", "status", "ctcAnnual", "joiningDate", "expiresAt",
            "bodyHtml", "attachmentFileName", "attachmentMime", "attachmentBlob",
            "createdById", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         RETURNING "id"`,
        applicationId, status, ctcAnnual, joiningDate, expiresAt,
        bodyHtml, attachmentFileName, attachmentMime, attachmentBlob,
        actorId,
      );
      offerId = inserted[0]?.id ?? null;
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      const msg = String(e?.meta?.message || e?.message || "");
      if (code === "42P01" || /does not exist/i.test(msg)) {
        return NextResponse.json(
          { error: "OfferLetter table not migrated yet." },
          { status: 503 },
        );
      }
      throw e;
    }

    // Activity log entry — always.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      applicationId,
      sendNow ? "offer_sent" : "offer_drafted",
      sendNow ? "Offer letter sent" : "Offer letter drafted",
      JSON.stringify({ offerId, ctcAnnual, joiningDate, expiresAt }),
      actorId,
    );

    // Fire the email when sendNow + subject/body present.
    if (sendNow && body?.emailSubject && body?.emailBody) {
      const cand = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "email", "fullName", "createdAt" FROM "JobApplication" WHERE "id" = $1`,
        applicationId,
      );
      const to              = cand[0]?.email;
      const fullName        = cand[0]?.fullName ?? "Candidate";
      const applicationDate = body?.applicationDate ?? cand[0]?.createdAt ?? null;
      if (to) {
        // Attachment priority:
        //   1. HR's uploaded PDF (already in attachmentBlob)
        //   2. Auto-generated PDF rendered from buildOfferLetterHTML
        //      so the candidate gets the official multi-page document
        //      regardless of whether HR pre-made one.
        let attachments: { filename: string; contentType: string; contentBase64: string }[] = [];
        if (attachmentBlob && attachmentFileName) {
          attachments = [{
            filename:      attachmentFileName,
            contentType:   attachmentMime ?? "application/pdf",
            contentBase64: attachmentBlob.toString("base64"),
          }];
        } else if (body?.autoGeneratePdf) {
          try {
            // Render by filling placeholders directly inside the
            // official NB Media offer letter .docx template. Text
            // reflows naturally because Word/Google Docs handles
            // layout — no overlay artifacts, no coordinate math, no
            // bleeding into surrounding text. Attachment is .docx,
            // which every candidate can open in Word / Google Docs /
            // LibreOffice and (if needed) print to PDF themselves.
            const generated = await renderOfferLetterDocxAttachment({
              candidateName:      fullName,
              jobRole:            String(body?.jobRole ?? ""),
              annualCtcINR:       ctcAnnual,
              joiningDate,
              acceptanceDeadline: expiresAt,
              applicationDate,
            });
            attachments = [{
              filename:      generated.filename,
              contentType:   generated.mime,
              contentBase64: generated.pdf.toString("base64"),
            }];
          } catch (e: any) {
            console.error("[offers] PDF generation failed:", e?.message ?? e);
            // Falls back to no attachment — email still goes out so
            // HR doesn't have a silent black hole.
          }
        }
        // CC — optional. Filtered to valid-looking addresses so we
        // never hand the SMTP layer junk. Caller already validated
        // client-side; this is belt-and-braces.
        const ccList = Array.isArray(body?.emailCc)
          ? (body.emailCc as unknown[])
              .map((e) => String(e ?? "").trim())
              .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
          : undefined;
        try {
          await sendEmail({
            to,
            cc: ccList && ccList.length > 0 ? ccList : undefined,
            content: {
              subject: String(body.emailSubject),
              html:    String(body.emailBody),
              text:    String(body.emailBody).replace(/<[^>]+>/g, ""),
            } as any,
            attachments,
          });
        } catch (e: any) {
          console.error("[offers] send email failed:", e?.message ?? e);
        }
      }
    }

    return NextResponse.json({ ok: true, offerId });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/candidates/[id]/offers");
  }
}
