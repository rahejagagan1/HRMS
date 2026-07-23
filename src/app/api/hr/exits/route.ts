// HR-side offboarding endpoint.
//   GET  → list every EmployeeExit row, joined to User basics.
//   POST → record a new exit. Side-effects: flips User.isActive=false,
//          fires goodbye email to the leaver + notification + email to
//          CEO / HR / admins / developers / their manager.
//
// Raw SQL throughout because the typed Prisma client may not know about
// the new EmployeeExit table until `prisma generate` reruns.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { sendEmail } from "@/lib/email/sender";
import { employeeFarewellEmail, exitNotificationEmail } from "@/lib/email/templates";
import { exitStakeholderEmails } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// RBAC-designation-driven (policy 2026-07-14): shared isHRAdmin resolves
// MANAGE_HR from the caller's designation. Replaced a local legacy copy.
import { isHRAdmin } from "@/lib/access";
import { brandScopeSqlClause } from "@/lib/hr/brand-scope";
function canManage(session: any): boolean {
  return isHRAdmin(session?.user);
}

const EXIT_TYPES = new Set(["resignation", "termination", "contract_end", "retirement", "other"]);

export async function GET(request: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    // ── Tab-driven brand filter ────────────────────────────────
    // The Offboarding UI has two brand tabs (NB Media | YT Labs).
    // canManage users (HR Manager / CEO / admin / developer) can
    // switch between tabs to view either brand's exits — visual
    // separation in the UI, no hard server-side wall.
    //
    // Query param semantics:
    //   ?brand=nb_media | "NB Media"  → only NB Media exits
    //   ?brand=yt_labs  | "YT Labs"   → only YT Labs exits
    //   ?brand=all                    → both brands (admin sweeps)
    //   ?brand=  (omitted)            → caller's own brand by
    //                                   default, so the first-load
    //                                   tab matches their badge
    //
    // The endpoint is already canManage-gated above, so any HR-tier
    // user can request any brand. Brand acts as a UI filter, not
    // an access control.
    const url = new URL(request.url);
    const user = session!.user as any;
    const isDev = user?.isDeveloper === true;
    const callerBu = user?.businessUnit ?? null;

    const brandParam = (url.searchParams.get("brand") ?? "").toLowerCase().trim();
    const NORMALIZE: Record<string, "NB Media" | "YT Labs" | "all" | null> = {
      "":          null,                  // → caller's own brand
      "nb_media":  "NB Media",
      "nb media":  "NB Media",
      "nbmedia":   "NB Media",
      "yt_labs":   "YT Labs",
      "yt labs":   "YT Labs",
      "ytlabs":    "YT Labs",
      "all":       "all",
    };
    const requestedBrand = brandParam in NORMALIZE ? NORMALIZE[brandParam] : null;

    // Authority check on ?brand=all — admin sweep view that drops
    // the WHERE clause entirely. Lock to developers only; an HR
    // Manager who needs to view both brands clicks the [NB Media]
    // and [YT Labs] tabs separately. (Per HR's brand-tab design,
    // each tab stays visually clean.)
    if (requestedBrand === "all" && !isDev) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Decide what to filter on:
    //   • ?brand=all (devs only) → no WHERE clause
    //   • ?brand=<explicit>      → that brand (HR can flip tabs;
    //                              canManage already gates this)
    //   • no ?brand= (default)   → caller's own brand
    let brandToShow: string | null;
    if (requestedBrand === "all") {
      brandToShow = null;
    } else if (requestedBrand) {
      brandToShow = requestedBrand;
    } else if (callerBu) {
      brandToShow = callerBu;
    } else if (isDev) {
      // Developer with no businessUnit + no ?brand= → see all (the
      // typical debug login case).
      brandToShow = null;
    } else {
      // Non-developer caller with no businessUnit AND no explicit
      // ?brand= → fail closed (return empty). Better than silently
      // showing every brand to a user whose own brand isn't set up
      // yet. HR fixes the user's EmployeeProfile.businessUnit, or
      // the user clicks an explicit brand tab.
      console.warn(`[GET /api/hr/exits] caller #${user?.dbId} has no businessUnit and didn't pass ?brand= — returning empty.`);
      return NextResponse.json([]);
    }

    const baseSql = `SELECT e.id, e."userId", u.name AS "userName", u.email AS "userEmail",
                            ep.designation, ep.department, ep."businessUnit",
                            e."exitType", e."resignationDate", e."lastWorkingDay",
                            e."noticePeriodDays", e.reason, e.notes, e.status,
                            e."assetsReturned", e."documentsHandled",
                            e."finalSettlementDone", e."exitInterviewDone",
                            e."okToRehire", e."createdAt"
                       FROM "EmployeeExit" e
                       JOIN "User" u ON u.id = e."userId"
                  LEFT JOIN "EmployeeProfile" ep ON ep."userId" = e."userId"`;

    // Org-wide brand isolation (2026-07-15): non-VIEW_ALL_BRANDS callers
    // only see their own brand's exits, whatever ?brand= says.
    const clamp = brandScopeSqlClause(session!.user, "u");
    const rows = brandToShow
      ? await prisma.$queryRawUnsafe<any[]>(
          `${baseSql} WHERE ep."businessUnit" = $1${clamp} ORDER BY e."createdAt" DESC`,
          brandToShow,
        )
      : await prisma.$queryRawUnsafe<any[]>(
          `${baseSql} WHERE 1=1${clamp} ORDER BY e."createdAt" DESC`,
        );

    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[GET /api/hr/exits] failed:", e);
    return NextResponse.json({ error: "Could not load exits" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const userId          = Number(body?.userId);
    const exitType        = String(body?.exitType || "resignation");
    const resignationDate = body?.resignationDate ? new Date(body.resignationDate) : null;
    const lastWorkingDay  = body?.lastWorkingDay  ? new Date(body.lastWorkingDay)  : null;
    const noticePeriodDays = Number.isFinite(Number(body?.noticePeriodDays)) ? Number(body.noticePeriodDays) : 30;
    const reason          = body?.reason ? String(body.reason) : null;
    const notes           = body?.notes  ? String(body.notes)  : null;
    const okToRehire      = body?.okToRehire === true;

    if (!Number.isFinite(userId)) return NextResponse.json({ error: "userId is required" }, { status: 400 });
    if (!EXIT_TYPES.has(exitType)) return NextResponse.json({ error: "Invalid exit type" }, { status: 400 });
    if (!resignationDate || isNaN(resignationDate.getTime()))
      return NextResponse.json({ error: "Resignation date is required" }, { status: 400 });
    if (!lastWorkingDay  || isNaN(lastWorkingDay.getTime()))
      return NextResponse.json({ error: "Last working day is required" }, { status: 400 });

    // Confirm the user exists + is currently active. Pulls manager and
    // employee profile in the same query for the notification step.
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, isActive: true, managerId: true,
        manager: { select: { id: true } },
      },
    });
    if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    if (!target.isActive)
      return NextResponse.json({ error: "Employee is already inactive" }, { status: 409 });

    const initiatedBy = (session!.user as any)?.dbId ?? null;

    // Create (or update) the exit row. The employee STAYS active through
    // the notice period — their account is fully usable until HR flips
    // the exit status to "offboarded" via PATCH /api/hr/exits/[id],
    // which then sets User.isActive=false. So search bars, the People
    // directory, and the @-mention picker still show them until then.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "EmployeeExit"
         ("userId", "exitType", "resignationDate", "lastWorkingDay", "noticePeriodDays",
          reason, notes, "okToRehire", "initiatedById", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT ("userId") DO UPDATE
          SET "exitType" = EXCLUDED."exitType",
              "resignationDate" = EXCLUDED."resignationDate",
              "lastWorkingDay" = EXCLUDED."lastWorkingDay",
              "noticePeriodDays" = EXCLUDED."noticePeriodDays",
              reason = EXCLUDED.reason,
              notes = EXCLUDED.notes,
              "okToRehire" = EXCLUDED."okToRehire",
              "updatedAt" = now()`,
      userId, exitType, resignationDate, lastWorkingDay, noticePeriodDays,
      reason, notes, okToRehire, initiatedBy,
    );

    // Fire emails — fire-and-forget so SMTP hiccups don't block save.
    if (target.email) {
      void sendEmail({
        to: target.email,
        content: employeeFarewellEmail({
          name: target.name,
          lastWorkingDay,
        }),
      });
    }

    try {
      // HR / Special Access / admin + toggle-gated developers + the
      // employee's direct manager + their brand CEO (brand-scoped).
      const recipientEmails = await exitStakeholderEmails({
        id: target.id,
        managerId: target.managerId,
      });
      if (recipientEmails.length > 0) {
        void sendEmail({
          to: recipientEmails,
          content: exitNotificationEmail({
            name: target.name,
            email: target.email,
            exitType,
            lastWorkingDay,
            reason,
          }),
        });
      }
    } catch (e) {
      console.error("[POST /api/hr/exits] notify-stakeholders failed:", e);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[POST /api/hr/exits] failed:", e);
    return NextResponse.json({ error: e?.message || "Could not record exit" }, { status: 500 });
  }
}
