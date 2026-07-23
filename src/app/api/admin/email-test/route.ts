import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, serverError } from "@/lib/api-auth";
import { sendEmail } from "@/lib/email/sender";
import { announcementEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/email-test
 * Body: { to: "address@example.com" }
 *
 * Admin-only. Fires a test email to the given address using the same
 * sender that real notifications use, so you can confirm SMTP creds are
 * valid before relying on them in production.
 */
export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  try {
    const { to } = await req.json();
    if (!to || typeof to !== "string") {
      return NextResponse.json({ error: "Provide { to: 'email@…' }" }, { status: 400 });
    }
    await sendEmail({
      to,
      content: announcementEmail({
        title: "NB Media HR email test",
        body: "If you're reading this, the SMTP setup is working end-to-end.\n\nYou can ignore this message.",
        authorName: "NB Media HR Bot",
      }),
    });
    return NextResponse.json({
      ok: true,
      dryRun: isDryRun(),
      note: isDryRun()
        ? "Dry-run mode (EMAIL_DRY_RUN=true) — nothing was actually sent. Set EMAIL_DRY_RUN=false in .env to send for real."
        : `Test email dispatched to ${to}.`,
    });
  } catch (e) {
    return serverError(e, "POST /api/admin/email-test");
  }
}
