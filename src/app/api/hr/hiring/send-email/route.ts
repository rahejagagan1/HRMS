// Resolve + send an email from a template against a candidate /
// interview / offer / new-hire context. Used by:
//   • Candidate drawer's "Send" button
//   • Auto-send on stage change (called from moveStage handler)
//   • Manual one-off sends from Settings tab
//
// POST /api/hr/hiring/send-email
//   body: {
//     templateId, applicationId?, interviewId?, offerLetterId?,
//     newHireUserId?, overrides?, to?, dryRun?
//   }
//
// When dryRun=true, the resolver runs and returns the rendered
// subject/body/to without actually sending — used by the preview pane
// in the candidate drawer.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { resolveTemplate } from "@/lib/hr/email-merge";
import { sendEmail } from "@/lib/email/sender";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const templateId = Number(body?.templateId);
    if (!Number.isInteger(templateId)) {
      return NextResponse.json({ error: "templateId required" }, { status: 400 });
    }
    const actorId = await resolveUserId(session);

    // 1. Resolve the template against the supplied context.
    const resolved = await resolveTemplate({
      templateId,
      applicationId: body?.applicationId ? Number(body.applicationId) : undefined,
      interviewId:   body?.interviewId   ? Number(body.interviewId)   : undefined,
      offerLetterId: body?.offerLetterId ? Number(body.offerLetterId) : undefined,
      newHireUserId: body?.newHireUserId ? Number(body.newHireUserId) : undefined,
      overrides:     body?.overrides,
    });

    const to = body?.to || resolved.to;
    if (!to && !body?.dryRun) {
      return NextResponse.json({ error: "No recipient email resolved — pass `to` explicitly" }, { status: 400 });
    }

    // 2. Dry run — return the rendered output without sending.
    if (body?.dryRun) {
      return NextResponse.json({
        ok: true,
        preview: {
          to,
          subject:  resolved.subject,
          bodyHtml: resolved.bodyHtml,
          templateKey: resolved.templateKey,
        },
      });
    }

    // 3. Real send.
    await sendEmail({
      to: to!,
      content: {
        subject: resolved.subject,
        html: resolved.bodyHtml,
        text: resolved.bodyHtml.replace(/<[^>]+>/g, ""),
      } as any,
    });

    // 4. Activity log against the candidate, if applicable. Wrapped
    // because the email has already gone out by this point — a log
    // failure must NOT show as a failed send to HR. CandidateActivity
    // may not exist pre-migration; we log + swallow.
    if (body?.applicationId) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
           VALUES ($1, 'email_sent', $2, $3::jsonb, $4)`,
          Number(body.applicationId),
          `Sent: ${resolved.subject}`,
          JSON.stringify({ templateKey: resolved.templateKey, to }),
          actorId,
        );
      } catch (e: any) {
        const code = e?.meta?.code || e?.code;
        const msg = String(e?.meta?.message || e?.message || "");
        if (code !== "42P01" && !/does not exist/i.test(msg)) {
          // Non-schema error — log but don't fail the send response.
          console.warn("[send-email] activity log failed:", msg);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/send-email");
  }
}
