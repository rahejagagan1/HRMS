import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const user = await prisma.user.findUnique({
      where: { id: myId },
      select: {
        id: true, name: true, email: true, profilePictureUrl: true,
        createdAt: true,
      },
    });
    // Fetch the EmployeeProfile via raw SQL so we get every column —
    // including the ones added after the typed Prisma client was last
    // generated (workPhone / personalEmail / maritalStatus). The page
    // hydrates its form from this object, so missing columns here =
    // empty fields in the UI even when the DB has them.
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "EmployeeProfile" WHERE "userId" = $1 LIMIT 1`,
      myId,
    );
    const employeeProfile = rows[0] ?? null;
    return NextResponse.json({ ...user, employeeProfile });
  } catch (e) { return serverError(e, "GET /api/hr/profile"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const body = await req.json();
    const {
      // User.name is the org-wide display name shown in the header /
      // sidebar / approval lists. Editable from the profile page.
      displayName,
      phone, workPhone, personalEmail,
      dateOfBirth, gender, bloodGroup, maritalStatus,
      emergencyPhone,
      address, city, state, profilePictureUrl,
      // Bank + identity fields — stored as plaintext.
      bankName, bankAccountNumber, bankIfsc, bankBranch, accountHolderName,
      panNumber, parentName, aadhaarNumber, aadhaarEnrollment,
      // ABOUT-tab bios — recently added columns, written via raw SQL
      // below so a stale Prisma client doesn't choke on unknown fields.
      about, jobLove, hobbies,
      // Family + emergency contact — used to be HR-onboarded but is
      // now self-edited from the ABOUT tab. Late-added columns, raw SQL.
      motherName, spouseName, childrenNames, physicallyHandicapped,
      emergencyRelationship,
    } = body;

    // EmployeeProfile is normally HR-onboarded via the Add Employee
    // wizard. If it's missing — auto-create a minimal one so the user
    // can still self-edit. Pulls first/last from User.name, claims an
    // ID from the first active EmployeeNumberSeries, and uses
    // sensible defaults for the other required fields. Falls back
    // gracefully when no number series exists (User.name save still
    // works, profile fields are skipped).
    let existing = await prisma.employeeProfile.findUnique({ where: { userId: myId } });
    if (!existing) {
      const me = await prisma.user.findUnique({
        where: { id: myId }, select: { name: true },
      });
      const series = await prisma.employeeNumberSeries.findFirst({
        where: { isActive: true }, select: { id: true },
      });
      if (series) {
        const fullName = (me?.name ?? "User").trim();
        const firstSpace = fullName.indexOf(" ");
        const fName = (firstSpace === -1 ? fullName : fullName.slice(0, firstSpace)).slice(0, 60) || "User";
        const lName = (firstSpace === -1 ? "—"      : fullName.slice(firstSpace + 1)).slice(0, 60) || "—";
        try {
          existing = await prisma.$transaction(async (tx) => {
            const bumped = await tx.employeeNumberSeries.update({
              where: { id: series.id },
              data:  { nextNumber: { increment: 1 } },
              select: { id: true, prefix: true, nextNumber: true },
            });
            const claimed     = bumped.nextNumber - 1;
            const employeeId  = `${bumped.prefix}${claimed}`;
            return tx.employeeProfile.create({
              data: {
                userId:         myId,
                employeeId,
                firstName:      fName,
                lastName:       lName,
                workCountry:    "India",
                nationality:    "Indian",
                numberSeriesId: bumped.id,
              },
            });
          });
        } catch (e) {
          // If allocation fails (race / unique conflict / etc.), fall
          // back to skipping profile updates and only save User.name.
          console.warn("[profile] auto-create EmployeeProfile failed:", e);
          existing = null as any;
        }
      }
    }

    // Build the EmployeeProfile patch. All columns store as plaintext.
    //
    // workPhone / personalEmail / maritalStatus are the most-recently
    // added columns; the typed Prisma client may not know them yet if
    // `prisma generate` hasn't been re-run after the schema change.
    // We hold them aside and write them via raw SQL afterwards so the
    // typed update doesn't blow up on unknown fields.
    const profileData: Record<string, unknown> = {
      phone, gender, bloodGroup,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      emergencyPhone, address, city, state,
      bankName, bankBranch, accountHolderName, parentName,
    };
    if (bankAccountNumber !== undefined) profileData.bankAccountNumber = bankAccountNumber ? String(bankAccountNumber).trim()              || null : null;
    if (bankIfsc          !== undefined) profileData.bankIfsc          = bankIfsc          ? String(bankIfsc).trim().toUpperCase()         || null : null;
    if (panNumber         !== undefined) profileData.panNumber         = panNumber         ? String(panNumber).trim().toUpperCase()        || null : null;
    if (aadhaarNumber     !== undefined) profileData.aadhaarNumber     = aadhaarNumber     ? String(aadhaarNumber).trim()                  || null : null;
    if (aadhaarEnrollment !== undefined) profileData.aadhaarEnrollment = aadhaarEnrollment ? String(aadhaarEnrollment).trim()              || null : null;

    // Only patch User.name when displayName is a non-empty string —
    // sending undefined would clear it via Prisma.
    const userPatch: Record<string, unknown> = {};
    if (profilePictureUrl) userPatch.profilePictureUrl = profilePictureUrl;
    if (typeof displayName === "string" && displayName.trim().length > 0) {
      userPatch.name = displayName.trim().slice(0, 120);
    }

    // Build the transaction op list — skip ops with no changes / missing
    // dependencies so we never call Prisma update on a row that doesn't
    // exist or with empty data.
    const txOps: any[] = [];
    if (Object.keys(userPatch).length > 0) {
      txOps.push(prisma.user.update({ where: { id: myId }, data: userPatch }));
    }
    if (existing && Object.values(profileData).some((v) => v !== undefined)) {
      txOps.push(prisma.employeeProfile.update({
        where: { userId: myId },
        data: profileData as any,
      }));
    }
    // Late-added columns (workPhone / personalEmail / maritalStatus / bios)
    // are written via the raw-SQL block below, not via the typed Prisma
    // update — so a body that only edits one of them would otherwise be
    // rejected here as "no changes". Treat those as valid edits too.
    const hasLateUpdates =
      workPhone !== undefined || personalEmail !== undefined || maritalStatus !== undefined ||
      about !== undefined || jobLove !== undefined || hobbies !== undefined ||
      motherName !== undefined || spouseName !== undefined || childrenNames !== undefined ||
      physicallyHandicapped !== undefined || emergencyRelationship !== undefined;
    if (txOps.length === 0 && !hasLateUpdates) {
      return NextResponse.json({ error: "No changes to save" }, { status: 400 });
    }
    if (txOps.length > 0) {
      try {
        await prisma.$transaction(txOps);
      } catch (e: any) {
        console.error("[profile PUT] main transaction failed:", e);
        return NextResponse.json({
          error: `Save failed: ${e?.message ?? "Unknown DB error"}`,
        }, { status: 500 });
      }
    }

    // Patch the new columns via raw SQL — works even when the typed
    // Prisma client wasn't regenerated after the schema migration.
    // We include each column conditionally so a stray null doesn't
    // overwrite stored data.
    if (existing) {
      const setParts: string[] = [];
      const args: unknown[] = [];
      let i = 1;
      if (workPhone !== undefined) {
        setParts.push(`"workPhone" = $${i++}`);
        args.push(workPhone || null);
      }
      if (personalEmail !== undefined) {
        setParts.push(`"personalEmail" = $${i++}`);
        args.push(personalEmail || null);
      }
      if (maritalStatus !== undefined) {
        setParts.push(`"maritalStatus" = $${i++}`);
        args.push(maritalStatus || null);
      }
      // ABOUT-tab bios — empty string clears the field (stored as NULL).
      if (about !== undefined) {
        setParts.push(`"about" = $${i++}`);
        args.push(typeof about === "string" && about.trim().length > 0 ? about : null);
      }
      if (jobLove !== undefined) {
        setParts.push(`"jobLove" = $${i++}`);
        args.push(typeof jobLove === "string" && jobLove.trim().length > 0 ? jobLove : null);
      }
      if (hobbies !== undefined) {
        setParts.push(`"hobbies" = $${i++}`);
        args.push(typeof hobbies === "string" && hobbies.trim().length > 0 ? hobbies : null);
      }
      // Family + emergency-contact columns (self-edited from the
      // ABOUT tab). Same null-on-blank convention as the bios.
      const nullable = (v: unknown) =>
        typeof v === "string" && v.trim().length > 0 ? v : null;
      if (motherName            !== undefined) { setParts.push(`"motherName" = $${i++}`);            args.push(nullable(motherName)); }
      if (spouseName            !== undefined) { setParts.push(`"spouseName" = $${i++}`);            args.push(nullable(spouseName)); }
      if (childrenNames         !== undefined) { setParts.push(`"childrenNames" = $${i++}`);         args.push(nullable(childrenNames)); }
      if (physicallyHandicapped !== undefined) { setParts.push(`"physicallyHandicapped" = $${i++}`); args.push(nullable(physicallyHandicapped)); }
      if (emergencyRelationship !== undefined) { setParts.push(`"emergencyRelationship" = $${i++}`); args.push(nullable(emergencyRelationship)); }
      if (setParts.length > 0) {
        args.push(myId);
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeProfile" SET ${setParts.join(", ")} WHERE "userId" = $${i}`,
            ...args,
          );
        } catch (e) {
          // Log but don't fail — these are non-critical extras.
          console.warn("[profile PUT] new-column raw update failed:", e);
        }
      }
    }

    // Read back the user via raw SQL too — `select: { employeeProfile: true }`
    // would generate SQL referencing every typed column, including the
    // 3 new ones, which crashes a stale Prisma client. We just return
    // the User row + a flag; the client refetches the full profile via
    // its own SWR call.
    const updated = await prisma.user.findUnique({
      where: { id: myId },
      select: { id: true, name: true, email: true, profilePictureUrl: true },
    });
    return NextResponse.json({ ...updated, ok: true });
  } catch (e: any) {
    console.error("[profile PUT] outer catch:", e);
    return NextResponse.json({
      error: `Save failed: ${e?.message ?? "Unknown error"}`,
    }, { status: 500 });
  }
}
