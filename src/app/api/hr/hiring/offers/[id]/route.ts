// Update an existing offer: send (draft→sent), mark accepted / declined,
// or revoke. Downloading the attachment is a separate GET.
//
// PATCH /api/hr/hiring/offers/[id]
//   body: { action: "send" | "accept" | "decline" | "revoke",
//           emailSubject?, emailBody?  // when action === "send"
//         }
//
// GET   /api/hr/hiring/offers/[id]?file=1
//   Streams the stored attachment back to the browser. HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { sendEmail } from "@/lib/email/sender";
import { renderOfferLetterDocxAttachment } from "@/lib/offer-letter-from-docx";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set(["send", "accept", "decline", "revoke"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const id = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
    const wantsFile = new URL(req.url).searchParams.get("file") === "1";

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "applicationId", status, "ctcAnnual", "joiningDate", "expiresAt",
              "attachmentFileName", "attachmentMime",
              ${wantsFile ? `"attachmentBlob",` : ``}
              "bodyHtml", "acceptedAt", "declinedAt", "revokedAt", "createdAt"
         FROM "OfferLetter"
        WHERE id = $1`,
      id,
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (wantsFile) {
      if (!row.attachmentBlob) return NextResponse.json({ error: "No attachment" }, { status: 404 });
      // SECURITY: serve as a download with a SAFE Content-Type +
      // nosniff so a tampered MIME (e.g. text/html disguised as a PDF
      // upload) can never be parsed as a script-executing document
      // on the dashboard origin. The browser still renders PDFs
      // inline when the user opens the download — they just can't be
      // loaded as a same-origin iframe target.
      const stored  = String(row.attachmentMime ?? "").toLowerCase();
      const allowed = stored === "application/pdf"
        || stored === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        || stored === "application/msword";
      const contentType = allowed ? stored : "application/octet-stream";
      const safeName    = (row.attachmentFileName ?? "offer.pdf")
        .replace(/[\r\n"]/g, "")     // strip CRLF + quote injection
        .slice(0, 200);
      return new NextResponse(row.attachmentBlob, {
        headers: {
          "Content-Type":           contentType,
          "Content-Disposition":    `attachment; filename="${safeName}"`,
          "Cache-Control":          "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":"sandbox; default-src 'none'",
        },
      });
    }
    return NextResponse.json({ offer: row });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/offers/[id]");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const id = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
    const actorId = await resolveUserId(session);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "applicationId", status, "ctcAnnual", "joiningDate", "expiresAt",
              "bodyHtml", "attachmentBlob", "attachmentFileName", "attachmentMime"
         FROM "OfferLetter" WHERE id = $1`,
      id,
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Map action → new state + activity entry + email side-effect.
    if (action === "send") {
      if (row.status !== "draft") {
        return NextResponse.json({ error: `Can only send drafts (status=${row.status})` }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "OfferLetter" SET status = 'sent', "updatedAt" = NOW() WHERE id = $1`, id,
      );
      // Optional email send
      if (body?.emailSubject && body?.emailBody) {
        const cand = await prisma.$queryRawUnsafe<any[]>(
          `SELECT a."email", a."fullName", a."createdAt", o."title" AS "roleTitle"
             FROM "JobApplication" a
             LEFT JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
            WHERE a."id" = $1`,
          row.applicationId,
        );
        const to              = cand[0]?.email;
        const fullName        = cand[0]?.fullName ?? "Candidate";
        const roleTtl         = cand[0]?.roleTitle ?? "the role";
        const applicationDate = body?.applicationDate ?? cand[0]?.createdAt ?? null;
        if (to) {
          // Attachment priority: HR-uploaded > auto-generated PDF.
          let attachments: { filename: string; contentType: string; contentBase64: string }[] = [];
          if (row.attachmentBlob && row.attachmentFileName) {
            attachments = [{
              filename:      row.attachmentFileName,
              contentType:   row.attachmentMime ?? "application/pdf",
              contentBase64: Buffer.from(row.attachmentBlob).toString("base64"),
            }];
          } else if (body?.autoGeneratePdf) {
            try {
              // Fill the official .docx template — see the POST
              // /offers handler for the rationale.
              const generated = await renderOfferLetterDocxAttachment({
                candidateName:      fullName,
                jobRole:            String(body?.jobRole ?? roleTtl),
                annualCtcINR:       row.ctcAnnual != null ? Number(row.ctcAnnual) : null,
                joiningDate:        row.joiningDate,
                acceptanceDeadline: row.expiresAt,
                applicationDate,
              });
              attachments = [{
                filename:      generated.filename,
                contentType:   generated.mime,
                contentBase64: generated.pdf.toString("base64"),
              }];
            } catch (e: any) {
              console.error("[offers] PDF generation failed:", e?.message ?? e);
            }
          }
          // CC — optional, sanitized so a stray space or typo doesn't
          // crash the SMTP send.
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
      await activity(row.applicationId, "offer_sent", "Offer letter sent", { offerId: id }, actorId);
    } else if (action === "accept") {
      await prisma.$executeRawUnsafe(
        `UPDATE "OfferLetter" SET status = 'accepted', "acceptedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, id,
      );
      await activity(row.applicationId, "offer_accepted", "Offer accepted", { offerId: id }, actorId);
      // Auto-move the candidate to the Preboarding stage so they show
      // up in the Preboarding tab with a "Proceed to Onboarding" CTA.
      // Soft-fail if the stage doesn't exist yet (e.g. fresh dev DB
      // without the migration) — the offer is still marked accepted.
      try {
        const stageRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM "HiringStage" WHERE "key" = 'preboarding' LIMIT 1`,
        );
        const preboardingStageId = stageRows[0]?.id ? Number(stageRows[0].id) : null;
        if (preboardingStageId) {
          await prisma.$transaction(async (tx) => {
            // Close the prior stage's history row + open a new one.
            const prev = await tx.$queryRawUnsafe<any[]>(
              `SELECT "currentStageId" FROM "JobApplication" WHERE "id" = $1`,
              row.applicationId,
            );
            const prevStageId: number | null = prev[0]?.currentStageId ?? null;
            if (prevStageId && prevStageId !== preboardingStageId) {
              await tx.$executeRawUnsafe(
                `UPDATE "JobApplicationStage" SET "exitedAt" = NOW()
                  WHERE "applicationId" = $1 AND "stageId" = $2 AND "exitedAt" IS NULL`,
                row.applicationId, prevStageId,
              );
            }
            if (prevStageId !== preboardingStageId) {
              await tx.$executeRawUnsafe(
                `INSERT INTO "JobApplicationStage" ("applicationId", "stageId", "movedById", "note")
                 VALUES ($1, $2, $3, 'Auto-moved on offer acceptance')`,
                row.applicationId, preboardingStageId, actorId,
              );
              await tx.$executeRawUnsafe(
                `UPDATE "JobApplication"
                    SET "currentStageId" = $1, "enteredStageAt" = NOW(), "updatedAt" = NOW()
                  WHERE "id" = $2`,
                preboardingStageId, row.applicationId,
              );
            }
          });
        }
      } catch (e: any) {
        console.error("[offers] preboarding stage move failed:", e?.message ?? e);
      }
    } else if (action === "decline") {
      await prisma.$executeRawUnsafe(
        `UPDATE "OfferLetter" SET status = 'declined', "declinedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, id,
      );
      await activity(row.applicationId, "offer_declined", "Offer declined", { offerId: id }, actorId);
    } else if (action === "revoke") {
      await prisma.$executeRawUnsafe(
        `UPDATE "OfferLetter" SET status = 'revoked', "revokedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, id,
      );
      await activity(row.applicationId, "offer_revoked", "Offer revoked", { offerId: id }, actorId);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/offers/[id]");
  }
}

async function activity(applicationId: number, kind: string, summary: string, meta: object, actorId: number | null) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      applicationId, kind, summary, JSON.stringify(meta), actorId,
    );
  } catch (e: any) {
    console.error("[offers] activity log failed:", e?.message ?? e);
  }
}
