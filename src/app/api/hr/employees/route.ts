import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, isHRAdmin, serverError } from "@/lib/api-auth";
import { canViewExitBadge } from "@/lib/access";
import { brandScopeUserWhere } from "@/lib/hr/brand-scope";
import { serializeBigInt } from "@/lib/utils";
import { isDeveloperEmail } from "@/lib/hr/notification-policy";
import { probationWindow } from "@/lib/hr/probation";

// GET /api/hr/employees — list all employees with profiles
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const department = searchParams.get("department") || "";
    const employmentType = searchParams.get("employmentType") || "";
    const isActive = searchParams.get("isActive");
    // Multi-brand: callers can scope a list to "NB Media" or "YT Labs"
    // by passing ?businessUnit=… ; omitted = all brands.
    const businessUnit = searchParams.get("businessUnit") || "";
    // Brand scope (NB Media / YT Labs) — brandOf semantics: YT Labs is an exact
    // match; NB Media is everything else (incl. null / legacy / no profile), so
    // no employee is ever dropped from both brands.
    const brand = searchParams.get("brand") || "";

    // Developer invisibility: hide DEVELOPER_EMAILS rows from non-dev viewers.
    const viewer = session!.user as any;
    const viewerIsDev = isDeveloperEmail(viewer?.email ?? null);
    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const hideDevs = !viewerIsDev && devEmails.length > 0;

    // Exit-badge data is HR-confidential. Only include the
    // employeeExit relation when the viewer is HR team
    // (orgLevel=hr_manager) or a developer. Other viewers get the
    // row without it — their UI also gates on canViewExitBadge, but
    // stripping at the API is defense in depth (a curl can't pull
    // exit status either way).
    // Shared RBAC-aware gate (HR_CONFIDENTIAL via designation) — keeps the
    // API's defense-in-depth in sync with the client's canViewExitBadge.
    const canSeeExitBadge = canViewExitBadge(viewer, false);

    // Directory visibility policy: active employees are searchable by
    // everyone (global header search + home feed @-mention picker), but
    // EXITED / offboarded / inactive people are HR-only. For non-HR
    // callers we therefore (a) force active-only so a `member` can never
    // enumerate offboarded employees, and (b) narrow the profile include
    // to safe display fields (no PII / salary / personal contact).
    const viewerIsHR = isHRAdmin(viewer);

    const users = await prisma.user.findMany({
      where: {
        AND: [
          search ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          } : {},
          department ? { employeeProfile: { department: { contains: department, mode: "insensitive" } } } : {},
          employmentType ? { employeeProfile: { employmentType } } : {},
          businessUnit ? { employeeProfile: { businessUnit } } : {},
          // Org-wide brand isolation (2026-07-15): without VIEW_ALL_BRANDS
          // the caller only ever sees their OWN brand's employees, whatever
          // ?businessUnit= says. All-brands viewers pass through untouched.
          brandScopeUserWhere(viewer),
          brand === "YT Labs"  ? { employeeProfile: { businessUnit: "YT Labs" } } : {},
          brand === "NB Media" ? { NOT: { employeeProfile: { businessUnit: "YT Labs" } } } : {},
          // Non-HR can only ever see active employees — ignore any
          // isActive override they pass.
          !viewerIsHR
            ? { isActive: true }
            : (isActive !== null && isActive !== undefined ? { isActive: isActive === "true" } : {}),
          hideDevs ? { NOT: { email: { in: devEmails } } } : {},
        ],
      },
      include: {
        // Full profile (PII) for HR; non-HR get only the display fields the
        // @-mention picker / directory chips need.
        employeeProfile: viewerIsHR
          ? true
          : { select: { department: true, designation: true } },
        manager: { select: { id: true, name: true } },
        // RBAC designation (User.designationId → Designation.label) so pickers
        // can show the human-friendly designation instead of the raw role enum.
        designation: { select: { label: true } },
        // Conditional include — see canSeeExitBadge above.
        ...(canSeeExitBadge
          ? { employeeExit: { select: { id: true, status: true, lastWorkingDay: true } } }
          : {}),
      },
      orderBy: { name: "asc" },
    });

    // For non-HR / non-developer viewers, leave self-row badges
    // visible (an employee should still see their own exit state in
    // search results pointing back to themselves). Add it back via
    // a single lookup when applicable.
    if (!canSeeExitBadge) {
      const viewerId = Number(viewer?.dbId ?? 0);
      const selfRow = viewerId > 0 ? users.find((u: any) => u.id === viewerId) : null;
      if (selfRow) {
        try {
          const selfExit = await prisma.$queryRawUnsafe<Array<any>>(
            `SELECT id, status, "lastWorkingDay"
               FROM "EmployeeExit" WHERE "userId" = $1 LIMIT 1`,
            viewerId,
          );
          if (selfExit[0]) (selfRow as any).employeeExit = selfExit[0];
        } catch { /* ignore */ }
      }
    }

    // PIP fields aren't in the typed client yet — pull them via raw SQL and
    // merge onto each employeeProfile so the ON PIP badge can render in the
    // directory + search the same way the probation badge does.
    try {
      const ids = (users as any[]).map((u) => u.id).filter((n) => Number.isInteger(n));
      if (viewerIsHR && ids.length > 0) {
        const pipRows = await prisma.$queryRawUnsafe<Array<{ userId: number; pipStartedAt: Date | null; pipEndDate: Date | null }>>(
          `SELECT "userId", "pipStartedAt", "pipEndDate" FROM "EmployeeProfile" WHERE "userId" IN (${ids.join(",")})`,
        );
        const byUser = new Map(pipRows.map((r) => [r.userId, r]));
        for (const u of users as any[]) {
          const r = byUser.get(u.id);
          if (r && u.employeeProfile) {
            u.employeeProfile.pipStartedAt = r.pipStartedAt;
            u.employeeProfile.pipEndDate = r.pipEndDate;
          }
        }
      }
    } catch (e) {
      console.warn("[employees GET] pip fields merge failed:", e);
    }

    return NextResponse.json(serializeBigInt(users));
  } catch (e) {
    return serverError(e, "GET /api/hr/employees");
  }
}

// POST /api/hr/employees — create an employee via the Add Employee wizard (Page 1).
// Creates the User row if missing, allocates an employeeId from the chosen number
// series atomically, and writes the EmployeeProfile. Requires HR admin.
export async function POST(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const {
      workCountry,
      firstName,
      middleName,
      lastName,
      displayName,
      gender,
      dateOfBirth,
      nationality,
      numberSeriesId,
      workEmail,
      mobileNumber,
    } = body || {};

    const required: Record<string, unknown> = {
      workCountry, firstName, lastName, displayName, gender, dateOfBirth,
      nationality, numberSeriesId, workEmail, mobileNumber,
    };
    const missing = Object.entries(required).filter(([, v]) => v === undefined || v === null || v === "").map(([k]) => k);
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
    }

    const email = String(workEmail).trim().toLowerCase();
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) {
      return NextResponse.json({ error: "Invalid dateOfBirth" }, { status: 400 });
    }

    // Reject up front if this email already has an employee profile.
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, employeeProfile: { select: { id: true, employeeId: true } } },
    });
    if (existing?.employeeProfile) {
      return NextResponse.json(
        { error: `An employee already exists for ${email} (ID ${existing.employeeProfile.employeeId})` },
        { status: 409 },
      );
    }

    const seriesId = Number(numberSeriesId);
    const result = await prisma.$transaction(async (tx) => {
      // Lock the series row so concurrent adds serialize — FOR UPDATE holds
      // the lock for the rest of the transaction, so two simultaneous
      // callers can't claim the same number.
      const locked = await tx.$queryRawUnsafe<Array<{ prefix: string; nextNumber: number; isActive: boolean }>>(
        `SELECT prefix, "nextNumber", "isActive" FROM "EmployeeNumberSeries" WHERE id = $1 FOR UPDATE`,
        seriesId,
      );
      if (!locked[0]) throw new Error("Number series not found");
      if (!locked[0].isActive) throw new Error("Selected number series is inactive");
      const prefix = locked[0].prefix;

      // HRM numbers are issued strictly serially and are NEVER recycled.
      // Start from the higher of (the series counter) and (one past the
      // highest number ever used under this prefix). Exited / offboarded
      // employees keep their EmployeeProfile row — and thus their number —
      // so they are counted here and can never be handed to a new joiner.
      // Counting padded tails too (HRM01 -> 1) so the "max" is always the
      // true highest, then we skip forward over anything already taken.
      const used = await tx.$queryRawUnsafe<Array<{ employeeId: string }>>(
        `SELECT "employeeId" FROM "EmployeeProfile" WHERE "employeeId" LIKE $1`,
        `${prefix}%`,
      );
      let maxTail = 0;
      for (const r of used) {
        const tail = (r.employeeId ?? "").slice(prefix.length);
        if (/^\d+$/.test(tail)) {
          const t = Number.parseInt(tail, 10);
          if (t > maxTail) maxTail = t;
        }
      }
      let n = Math.max(Number(locked[0].nextNumber), maxTail + 1);
      // Belt-and-braces: skip any exact id that somehow already exists.
      for (let guard = 0; guard < 100000; guard++) {
        const taken = await tx.employeeProfile.findFirst({ where: { employeeId: `${prefix}${n}` }, select: { id: true } });
        if (!taken) break;
        n++;
      }
      const employeeId = `${prefix}${n}`;
      // Advance the counter past the number we just claimed.
      await tx.$executeRawUnsafe(
        `UPDATE "EmployeeNumberSeries" SET "nextNumber" = $1 WHERE id = $2`,
        n + 1, seriesId,
      );

      // Find or create the User — HR-first identity; clickupUserId stays null and
      // is backfilled by the ClickUp sync on email match.
      const user = await tx.user.upsert({
        where: { email },
        create: {
          email,
          name: String(displayName).trim(),
          role: "member",
          orgLevel: "member",
        },
        update: { name: String(displayName).trim() },
      });

      // Auto-probation: every new hire starts on a 3-month probation from
      // their joining date (falls back to today when the quick-add form
      // doesn't collect one). HR can extend it later.
      const pw = probationWindow(body?.joiningDate ? new Date(body.joiningDate) : null);
      const profile = await tx.employeeProfile.create({
        data: {
          userId: user.id,
          employeeId,
          firstName: String(firstName).trim(),
          middleName: middleName ? String(middleName).trim() : null,
          lastName: String(lastName).trim(),
          workCountry: String(workCountry).trim(),
          nationality: String(nationality).trim(),
          numberSeriesId: seriesId,
          gender: String(gender),
          dateOfBirth: dob,
          phone: String(mobileNumber).trim(),
          joiningDate: body?.joiningDate ? new Date(body.joiningDate) : null,
          probationStartDate: pw.start,
          probationEndDate: pw.end,
          probationPolicy: "Regular Employees",
        } as any,
      });

      return { user, profile };
    });

    // The joiner now exists — auto-attach any documents (offer letter,
    // etc.) generated for their email while they were still off-system.
    try {
      const { attachPendingDocuments } = await import("@/lib/hr/pending-documents");
      await attachPendingDocuments(result.user.id, email);
    } catch { /* never block employee creation on a parked-doc attach */ }

    return NextResponse.json(serializeBigInt(result));
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json(
        { error: "Duplicate email or employee ID — please try again" },
        { status: 409 },
      );
    }
    if (e?.code === "P2025" || e?.message === "Number series not found") {
      return NextResponse.json({ error: "Number series not found" }, { status: 400 });
    }
    if (e?.message === "Selected number series is inactive") {
      return NextResponse.json({ error: "Selected number series is inactive" }, { status: 400 });
    }
    return serverError(e, "POST /api/hr/employees");
  }
}
