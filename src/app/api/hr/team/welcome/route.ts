// Team Welcome — sends the "Introducing X to the team" announcement
// to all active employees. Fired from the HR onboard success dialog
// (TeamWelcomeModal) with the new joiner's structured details + an
// optional photo.
//
// The email body is rendered server-side as formatted HTML (centered
// paragraphs, bold key terms, mailto link, and the photo embedded inline
// + centered) via teamWelcomeEmailHtml — NOT from a free-text body, so
// the layout is guaranteed. The photo rides the inline-CID pipeline
// (cid:joinerPhoto), the same mechanism the logo uses.
//
// Auth: HR Admin only (same gate as candidate-side hiring routes).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { sendEmail, emailsForAllActiveUsers } from "@/lib/email/sender";
import { teamWelcomeEmailHtml } from "@/lib/email/hr-templates";

export const dynamic = "force-dynamic";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
type Pronoun = "he" | "she" | "they";
const asPronoun = (v: unknown): Pronoun =>
  v === "he" || v === "she" || v === "they" ? v : "they";

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    const j = (body?.joiner ?? {}) as Record<string, any>;

    const fullName  = String(j.fullName ?? "").trim();
    const firstName = String(j.firstName ?? "").trim() || fullName.split(" ")[0] || "the new joiner";
    const jobRole   = String(j.jobRole ?? "").trim() || "Team member";
    const workEmail = String(j.workEmail ?? "").trim();
    if (!fullName) return NextResponse.json({ error: "New joiner name required" }, { status: 400 });

    const pronoun = asPronoun(j.pronoun);
    const title   = pronoun === "she" ? "Ms." : pronoun === "he" ? "Mr." : "";

    // Resolve the manager's pronoun from their gender so "collaborate
    // closely with him/her" reads correctly (FK id parsed defensively).
    let managerPronoun: Pronoun | undefined;
    const mid = Number(body?.managerId);
    if (Number.isInteger(mid) && mid > 0) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT gender FROM "EmployeeProfile" WHERE "userId" = $1 LIMIT 1`,
          mid,
        );
        const g = rows?.[0]?.gender;
        if (g === "female") managerPronoun = "she";
        else if (g === "male") managerPronoun = "he";
      } catch { /* gender lookup is best-effort — fall back to "them" */ }
    }

    // Validate the optional inline photo.
    const rawPhoto = body?.photo;
    let photo: { filename: string; contentType: string; contentBase64: string } | null = null;
    if (rawPhoto && typeof rawPhoto === "object" && typeof rawPhoto.contentBase64 === "string" && rawPhoto.contentBase64) {
      const approxBytes = Math.floor(rawPhoto.contentBase64.length * 0.75);
      if (approxBytes <= MAX_PHOTO_BYTES) {
        photo = {
          filename:      String(rawPhoto.filename ?? "photo.jpg"),
          contentType:   typeof rawPhoto.contentType === "string" ? rawPhoto.contentType : "image/jpeg",
          contentBase64: rawPhoto.contentBase64,
        };
      }
    }

    const built = teamWelcomeEmailHtml({
      newJoinerName:  fullName,
      firstName,
      homeCity:       j.homeCity || undefined,
      priorRole:      j.priorRole || undefined,
      jobRole,
      managerName:    j.managerName || undefined,
      officeLocation: j.officeLocation || undefined,
      phone:          j.phone || undefined,
      workEmail,
      pronoun,
      managerPronoun,
      title,
      photoSrc:       photo ? "cid:joinerPhoto" : undefined,
    });

    const subject = String(body?.subject ?? "").trim() || built.subject;
    const html    = built.html;

    // Safety net: never ship an email that still has unfilled
    // {{placeholders}} (shouldn't happen now we render from fields).
    const leftover = (subject + " " + html).match(/\{\{[^}]{0,60}\}\}/);
    if (leftover) {
      return NextResponse.json(
        { error: `The email still has an unfilled placeholder: ${leftover[0]}.` },
        { status: 400 },
      );
    }

    // Brand-scope the welcome to the joiner's brand — resolved from their work
    // email (their own profile), else their manager's brand. Falls back to
    // all-staff only when the brand can't be determined. NB Media bucket
    // includes null businessUnit / no profile; YT Labs is strict.
    let joinerBrand: string | null = null;
    if (workEmail) {
      const u = await prisma.user.findUnique({ where: { email: workEmail }, select: { employeeProfile: { select: { businessUnit: true } } } });
      joinerBrand = u?.employeeProfile?.businessUnit ?? null;
    }
    if (!joinerBrand && Number.isInteger(mid) && mid > 0) {
      const m = await prisma.user.findUnique({ where: { id: mid }, select: { employeeProfile: { select: { businessUnit: true } } } });
      joinerBrand = m?.employeeProfile?.businessUnit ?? null;
    }
    // BCC every active employee (in-brand) so the team list isn't exposed;
    // To = the sender (a single visible address).
    let recipients: string[];
    if (joinerBrand) {
      const brandWhere = joinerBrand === "YT Labs"
        ? { employeeProfile: { businessUnit: "YT Labs" } }
        : { OR: [ { employeeProfile: { businessUnit: "NB Media" } }, { employeeProfile: { businessUnit: null } }, { employeeProfile: null } ] };
      const rows = await prisma.user.findMany({ where: { isActive: true, ...brandWhere }, select: { email: true } });
      recipients = rows.map((u) => u.email).filter((e): e is string => !!e);
    } else {
      recipients = await emailsForAllActiveUsers();
    }
    if (recipients.length === 0) {
      return NextResponse.json({ error: "No active employees to email" }, { status: 400 });
    }
    const senderAddr = session!.user.email!;
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    await sendEmail({
      to:  senderAddr,
      bcc: recipients.filter((e) => e !== senderAddr),
      content: { subject, html, text } as any,
      attachments: photo
        ? [{ filename: photo.filename, contentType: photo.contentType, contentBase64: photo.contentBase64, cid: "joinerPhoto" }]
        : [],
    });

    return NextResponse.json({ ok: true, recipientCount: recipients.length });
  } catch (e) {
    return serverError(e, "POST /api/hr/team/welcome");
  }
}
