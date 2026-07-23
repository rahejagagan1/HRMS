import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";
import { istTodayDateOnly } from "@/lib/ist-date";
import { isHRAdmin, isLeadershipOrHR, canViewExitBadge } from "@/lib/access";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";

// Editing other employees' profiles is reserved for HR ops + admins.
// HR access is RBAC-designation-driven (policy 2026-07-14): the shared
// isHRAdmin resolves MANAGE_HR from the caller's designation, so HR staff
// provisioned by designation alone (role/orgLevel still "member") pass.
// EDIT_EMPLOYEE_PROFILES additionally lets a non-HR designation be
// delegated just this power. Replaced a local orgLevel/role-only copy.
function canEditOthers(session: any): boolean {
  const u = session?.user;
  if (!u) return false;
  if (isHRAdmin(u)) return true;
  return hasResolvedPermissions(u) && can(u, "EDIT_EMPLOYEE_PROFILES");
}

// GET /api/hr/people/:id
// Returns the shape expected by /dashboard/hr/people/[id]/page.tsx:
//   { id, name, email, role, orgLevel, profilePictureUrl, profile, documents, assets, directReports, manager, shift, leaveBalances }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        employeeProfile: true,
        // SalaryStructure pulled in so HR-facing flows (Exit
        // Statement template auto-fill, payroll exports, etc.)
        // get CTC + PF eligibility + salary type (intern vs
        // regular) without a second roundtrip.
        salaryStructure: { select: { ctc: true, pfEligible: true, salaryType: true, professionalTax: true } },
        manager: { select: { id: true, name: true, profilePictureUrl: true, role: true, employeeProfile: { select: { designation: true } } } },
        // Reporting team excludes deactivated / exited / offboarded reports
        // (isActive=false) — only currently-active direct reports show.
        teamMembers: { where: { isActive: true }, select: { id: true, name: true, profilePictureUrl: true, role: true, employeeProfile: { select: { designation: true } } } },
        userShift: { include: { shift: true } },
        leaveBalances: { include: { leaveType: true } },
        leavePolicy: { select: { id: true, name: true, isActive: true } },
        heldAssets: { where: { returnedAt: null }, include: { asset: true } },
        ownedDocuments: true,
      },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Access gate: ACTIVE employees are viewable by any authenticated
    // user (org directory). EXITED / offboarded / otherwise-deactivated
    // employees are confidential — only HR / CEO / developer / special-
    // access (canEditOthers), the profile owner, or the target's direct
    // manager may open them. This is what stops a plain `member` from
    // pulling up an ex-employee via global search. (Salary / documents /
    // assets are additionally stripped for non-HR further down.)
    const callerId = await resolveUserId(session);
    const isSelfRequest = callerId != null && callerId === id;
    const isManagerOfTarget =
      callerId != null &&
      ((((user as any).managerId ?? null) === callerId) ||
        (((user as any).inlineManagerId ?? null) === callerId));
    const isPrivilegedViewer = canEditOthers(session) || isSelfRequest || isManagerOfTarget;
    const targetIsActive = (user as any).isActive !== false;
    if (!targetIsActive && !isPrivilegedViewer) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // These auxiliary lookups are all keyed only by `id` and independent of
    // each other, so they run in ONE parallel batch instead of ~6 serial
    // round-trips (this is a hot profile page). Each keeps its own fallback
    // so a stale typed client on the VPS (missing a recent column) can't
    // fail the others. Raw SQL is used where `prisma generate` may be stale.
    const sUserBadge = session?.user as any;
    // Reuse callerId (resolved above) instead of a second resolveUserId call.
    const isSelfForBadge = callerId === id;
    // Shared RBAC-aware gate (HR_CONFIDENTIAL via designation) — replaces
    // the inline orgLevel-only check.
    const canSeeExitBadge = canViewExitBadge(sUserBadge, isSelfForBadge);

    const today = istTodayDateOnly();

    type DesignationRow = { designationId: number | null; designationLabel: string | null };
    type ExitRow = {
      id: number; status: string; exitType: string;
      resignationDate: string | null; lastWorkingDay: string | null; noticePeriodDays: number | null;
    };

    const [inlineManager, designationRow, extended, pip, todayAtt, activeExit] = await Promise.all([
      // Inline manager.
      prisma.$queryRawUnsafe<Array<{ id: number; name: string; profilePictureUrl: string | null; role: string }>>(
        `SELECT m.id, m.name, m."profilePictureUrl", m.role::text AS role
           FROM "User" u
           LEFT JOIN "User" m ON m.id = u."inlineManagerId"
          WHERE u.id = $1 AND m.id IS NOT NULL`,
        id,
      ).then(rows => rows[0] ?? null).catch(e => { console.warn("[people GET] inlineManager lookup failed:", e); return null; }),

      // designationId + its RBAC designation label (header label).
      prisma.$queryRawUnsafe<Array<DesignationRow>>(
        `SELECT u."designationId", d."label" AS "designationLabel"
           FROM "User" u LEFT JOIN "Designation" d ON d."id" = u."designationId"
          WHERE u."id" = $1`, id,
      ).then(rows => rows[0] ?? null).catch(() => null),

      // Extended onboarding fields (merged onto profile below).
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "secondaryJobTitle", "legalEntity", "jobLocation",
                "probationPolicy", "probationStartDate", "probationEndDate", "probationReminderSentAt", "probationConfirmedAt",
                "educationDetails",
                "internshipEndDate",
                "leavePlan", "holidayList", "weeklyOff",
                "attendanceNumber", "timeTrackingPolicy", "penalizationPolicy",
                "workCountry", "nationality",
                -- Keka-parity additions
                "homePhone", "physicallyHandicapped",
                "addressLine2", "addressPincode", "addressCountry",
                "permanentLine1", "permanentLine2", "permanentCity",
                "permanentState", "permanentPincode", "permanentCountry",
                "motherName", "spouseName", "childrenNames",
                "emergencyRelationship",
                "attendanceCaptureScheme", "costCenter",
                "pfNumber", "uanNumber", "biometricId"
           FROM "EmployeeProfile"
          WHERE "userId" = $1`,
        id,
      ).then(rows => rows[0] ?? {}).catch(e => { console.warn("[people GET] extended fields lookup failed:", e); return {} as Record<string, unknown>; }),

      // PIP fields — SEPARATE query so a missing column (pre performance_plan
      // migration) can't take down the extended fields above.
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "pipStartedAt", "pipEndDate", "pipReason", "pipReportedById"
           FROM "EmployeeProfile" WHERE "userId" = $1`,
        id,
      ).then(rows => rows[0] ?? {}).catch(e => { console.warn("[people GET] pip fields lookup failed:", e); return {} as Record<string, unknown>; }),

      // Today's attendance — drives the IN / OUT / OFFLINE presence badge.
      prisma.attendance.findUnique({
        where: { userId_date: { userId: id, date: today } },
        select: { status: true, clockIn: true, clockOut: true, totalMinutes: true },
      }).catch(() => null),

      // Exit row (notice-period / exited badge) — only for HR team,
      // developers, and the profile owner (mirrors canViewExitBadge).
      canSeeExitBadge
        ? prisma.$queryRawUnsafe<Array<ExitRow>>(
            `SELECT id, status, "exitType",
                    to_char("resignationDate", 'YYYY-MM-DD') AS "resignationDate",
                    to_char("lastWorkingDay",  'YYYY-MM-DD') AS "lastWorkingDay",
                    "noticePeriodDays"
               FROM "EmployeeExit"
              WHERE "userId" = $1
              LIMIT 1`,
            id,
          ).then(rows => rows[0] ?? null).catch(e => { console.warn("[people GET] activeExit lookup failed:", e); return null; })
        : Promise.resolve(null as ExitRow | null),
    ]);

    const designationId: number | null = designationRow?.designationId ?? null;
    const designationLabel: string | null = designationRow?.designationLabel ?? null;

    // Open-session check depends on todayAtt, so it stays after the batch.
    let hasOpenSession = false;
    if (todayAtt) {
      const open = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT s.id FROM "AttendanceSession" s
           JOIN "Attendance" a ON a.id = s."attendanceId"
          WHERE a."userId" = $1 AND a."date" = $2 AND s."clockOut" IS NULL
          LIMIT 1`,
        id, today,
      ).catch(() => []);
      hasOpenSession = open.length > 0;
    }

    // Reshape to what the detail page reads.
    const { employeeProfile, heldAssets, ownedDocuments, teamMembers, userShift, ...rest } = user;
    // Documents are PII (PAN / Aadhaar / education / employee letters)
    // — strict policy: only the profile owner, HR team
    // (orgLevel=hr_manager), CEO, and developers. Excludes
    // special_access and role=admin (which pass canEditOthers for
    // most other things). Mirrors canViewEmployeeDocuments in
    // src/lib/access.ts and the GET /api/hr/documents gate below.
    const sUser = session?.user as any;
    // Shared RBAC-aware tier (HR_CONFIDENTIAL via designation).
    const isDocViewer = isLeadershipOrHR(sUser);
    const docsAllowed = isSelfRequest || isDocViewer;
    // Identity + bank PII (PAN / Aadhaar / bank account) is as sensitive as
    // documents — visible only to the owner, HR (hr_manager), CEO and
    // developers. Redact it from the response for any other viewer (e.g. a
    // colleague browsing the directory) so it never reaches the client at
    // all — not even masked.
    const mergedProfile = employeeProfile ? { ...employeeProfile, ...extended, ...pip } : null;
    if (mergedProfile && !docsAllowed) {
      for (const k of ["panNumber", "aadhaarNumber", "aadhaarEnrollment", "bankName", "bankAccountNumber", "bankIfsc", "bankBranch", "accountHolderName"]) {
        delete (mergedProfile as any)[k];
      }
    }
    // Advance Salary (adhoc, type='Advance Salary') already paid to the
    // employee in payroll — summed for the Exit Statement (amount adds to
    // earnings; days are shown for reference). Days live in the comment
    // ("N/M day(s) advance salary …"), so parse the leading number.
    let advanceSalary = { days: 0, amount: 0 };
    try {
      const asRows = await prisma.$queryRawUnsafe<Array<{ amount: string; comment: string | null }>>(
        `SELECT amount::text AS amount, comment FROM "AdhocLineItem" WHERE "userId" = $1 AND type = 'Advance Salary'`,
        id,
      );
      for (const r of asRows) {
        advanceSalary.amount += parseFloat(r.amount) || 0;
        const m = /(\d+(?:\.\d+)?)/.exec(String(r.comment ?? ""));
        if (m) advanceSalary.days += parseFloat(m[1]) || 0;
      }
    } catch { /* older DB / no adhoc rows — leave zeros */ }

    const payload = {
      ...rest,
      advanceSalary,
      // Salary (CTC) is the most sensitive field — HR / CEO / developer
      // only. Stripped for a direct manager or the employee themselves on
      // this route. `...rest` carries salaryStructure, so override after.
      salaryStructure: isDocViewer ? ((rest as any).salaryStructure ?? null) : null,
      profile:       mergedProfile,
      documents:     docsAllowed ? ownedDocuments : [],
      // Asset assignments (serial numbers etc.) follow the same gate as
      // documents — self or HR only, never an arbitrary viewer.
      assets:        docsAllowed ? heldAssets.map((a) => ({ ...a.asset, assignedAt: a.assignedAt })) : [],
      directReports: teamMembers,
      shift:         userShift?.shift ?? null,
      inlineManager,
      designationId,
      designationLabel,
      todayAttendance: todayAtt
        ? { ...todayAtt, hasOpenSession }
        : null,
      activeExit,
    };
    // Never cache this employee payload (it's PII and changes on every
    // document add/delete, profile edit, etc.). Without this, a browser or
    // upstream proxy can serve a stale copy to SWR's revalidation, so changes
    // only appear after a hard refresh. no-store makes the mutate() after an
    // upload/delete fetch fresh data and the UI update on its own.
    return NextResponse.json(serializeBigInt(payload), {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/people/[id]");
  }
}

// PUT /api/hr/people/:id
// Lets HR / CEO / admin / developer edit any employee's User row + EmployeeProfile.
// Mirrors /api/hr/profile PUT (own-edit) but targets the path-param userId.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canEditOthers(session)) {
    return NextResponse.json(
      { error: "Only HR / CEO / admins / developers can edit other employees" },
      { status: 403 },
    );
  }

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json();
    const {
      displayName,
      employeeId,
      firstName, middleName, lastName,
      phone, workPhone, personalEmail, workEmail,
      dateOfBirth, gender, bloodGroup, maritalStatus,
      emergencyPhone,
      address, city, state, profilePictureUrl,
      // Identity documents — stored as plaintext.
      panNumber, parentName, aadhaarNumber, aadhaarEnrollment,
      // Bank details — stored as plaintext (no column-level encryption).
      bankName, bankAccountNumber, bankIfsc, bankBranch, accountHolderName,
      // Job + work details (Edit Profile → Job & Work section).
      designation, department, businessUnit, employmentType, workLocation, joiningDate,
      noticePeriodDays,
      // Extended onboarding fields — every wizard input is now editable.
      workCountry, nationality,
      secondaryJobTitle, legalEntity, jobLocation, probationPolicy, probationStartDate, probationEndDate, educationDetails, internshipEndDate,
      leavePlan, holidayList, weeklyOff, attendanceNumber, timeTrackingPolicy, penalizationPolicy,
      // ── Keka-parity additions (extended profile) ──
      homePhone, physicallyHandicapped,
      addressLine2, addressPincode, addressCountry,
      permanentLine1, permanentLine2, permanentCity, permanentState, permanentPincode, permanentCountry,
      motherName, spouseName, childrenNames,
      emergencyRelationship,
      attendanceCaptureScheme, costCenter,
      pfNumber, uanNumber, biometricId,
      // ── Statutory: PF + PT (Edit Statutory Information modal) ──
      pfEstablishmentId, pfEpsMember, pfNotEligible, pfJoinDate, pfAccountName,
      ptEstablishmentId,
      // ABOUT-tab bios — used to be self-edit-only via /api/hr/profile.
      // Now HR-admin can edit them on any user's profile too.
      about, jobLove, hobbies,
      // User row fields — role / orgLevel / manager / team membership.
      // designationId is the new RBAC field; role/orgLevel are sent derived
      // from it (compat shim) until the columns are dropped.
      role: newRole, orgLevel, designationId, managerId, inlineManagerId, teamCapsule,
      // Leave policy assignment — drives accrual + "Apply policy" balances.
      leavePolicyId,
    } = body;

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
    if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    let existing = await prisma.employeeProfile.findUnique({ where: { userId: id } });
    // Tracks whether we just allocated an HRM on this request — so the
    // "HRM No. cannot be empty" guard below doesn't reject a save that
    // came in with a blank HRM field but already got one assigned here.
    let justAutoCreated = false;

    // Auto-create a minimal EmployeeProfile when the user has none.
    // Users imported via ClickUp sync (and other non-wizard / legacy
    // sources) start without a profile row, so every save below used
    // to silently no-op — the route returned ok but no row existed to
    // UPDATE, which is why HR's edits "disappeared on reload." Mint a
    // profile on first edit using whatever the form sent, falling back
    // to splitting user.name and finally the email local-part.
    if (!existing) {
      const series = await prisma.employeeNumberSeries.findFirst({
        where: { isActive: true },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      if (!series) {
        return NextResponse.json(
          { error: "No active EmployeeNumberSeries — ask HR to create one before editing this profile." },
          { status: 409 },
        );
      }

      // Name fallbacks: form firstName/lastName win; else split user.name;
      // else use email local-part for first and "—" for last.
      const fullName = (target.name ?? "").trim();
      const firstSpace = fullName.indexOf(" ");
      const splitFirst = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
      const splitLast  = firstSpace === -1 ? "—"      : fullName.slice(firstSpace + 1);
      const fNameSeed = (typeof firstName === "string" && firstName.trim())
        || splitFirst
        || target.email?.split("@")[0]
        || "Employee";
      const lNameSeed = (typeof lastName === "string" && lastName.trim())
        || splitLast
        || "—";

      try {
        existing = await prisma.$transaction(async (tx) => {
          const bumped = await tx.employeeNumberSeries.update({
            where: { id: series.id },
            data:  { nextNumber: { increment: 1 } },
            select: { id: true, prefix: true, nextNumber: true },
          });
          const claimed = bumped.nextNumber - 1;
          const allocatedEmployeeId =
            (typeof employeeId === "string" && employeeId.trim())
              ? employeeId.trim()
              : `${bumped.prefix}${claimed}`;

          return tx.employeeProfile.create({
            data: {
              userId:         id,
              employeeId:     allocatedEmployeeId,
              firstName:      fNameSeed.trim().slice(0, 60),
              middleName:     typeof middleName === "string" && middleName.trim() ? middleName.trim().slice(0, 60) : null,
              lastName:       lNameSeed.trim().slice(0, 60),
              workCountry:    typeof workCountry === "string" && workCountry.trim() ? workCountry.trim() : "India",
              nationality:    typeof nationality === "string" && nationality.trim() ? nationality.trim() : "Indian",
              numberSeriesId: bumped.id,
            },
          });
        });
        justAutoCreated = true;
      } catch (e: any) {
        console.error("[people PUT] auto-create EmployeeProfile failed:", e);
        if (e?.code === "P2002") {
          return NextResponse.json(
            { error: "Could not allocate a new HRM No. — try again." },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: `Could not create profile: ${e?.message ?? "Unknown DB error"}` },
          { status: 500 },
        );
      }
    }

    // Build the EmployeeProfile patch using only the typed columns.
    // Each field is only included when explicitly sent (not undefined) so
    // partial section saves don't overwrite untouched fields with null.
    const profileData: Record<string, unknown> = {};
    // HRM No. — editable. Uniqueness is enforced by Prisma's @unique;
    // we pre-check so we can return a clean 409 instead of a raw P2002.
    let employeeIdNew: string | null = null;
    if (employeeId !== undefined) {
      const trimmed = String(employeeId ?? "").trim();
      if (!trimmed) {
        // If we just allocated an HRM during auto-create, accept the
        // blank submission — the profile already has its assigned number.
        if (justAutoCreated) {
          // fall through; profileData.employeeId stays unset
        } else {
          return NextResponse.json({ error: "HRM No. cannot be empty." }, { status: 400 });
        }
      } else if (existing && trimmed !== existing.employeeId) {
        const clash = await prisma.employeeProfile.findUnique({
          where: { employeeId: trimmed },
          select: { userId: true },
        });
        if (clash && clash.userId !== id) {
          return NextResponse.json(
            { error: `HRM No. "${trimmed}" is already used by another employee.` },
            { status: 409 },
          );
        }
        profileData.employeeId = trimmed;
        employeeIdNew = trimmed;
      }
    }
    // First / Last name are NOT NULL in the schema — only write when the
    // submitted value is non-empty. Middle name is optional and may be null.
    if (firstName  !== undefined) {
      const trimmed = String(firstName ?? "").trim();
      if (trimmed) profileData.firstName = trimmed;
    }
    if (lastName   !== undefined) {
      const trimmed = String(lastName ?? "").trim();
      if (trimmed) profileData.lastName  = trimmed;
    }
    if (middleName !== undefined) {
      const trimmed = String(middleName ?? "").trim();
      profileData.middleName = trimmed || null;
    }
    if (phone             !== undefined) profileData.phone             = phone;
    if (gender            !== undefined) profileData.gender            = gender;
    if (bloodGroup        !== undefined) profileData.bloodGroup        = bloodGroup;
    if (dateOfBirth       !== undefined) profileData.dateOfBirth       = dateOfBirth ? new Date(dateOfBirth) : null;
    if (emergencyPhone    !== undefined) profileData.emergencyPhone    = emergencyPhone;
    if (address           !== undefined) profileData.address           = address;
    if (city              !== undefined) profileData.city              = city;
    if (state             !== undefined) profileData.state             = state;
    if (parentName        !== undefined) profileData.parentName        = parentName;
    if (designation       !== undefined) profileData.designation       = designation || null;
    if (department        !== undefined) profileData.department        = department || null;
    if (employmentType    !== undefined) profileData.employmentType    = employmentType || "fulltime";
    if (workLocation      !== undefined) profileData.workLocation      = workLocation || "office";
    if (joiningDate       !== undefined) profileData.joiningDate       = joiningDate ? new Date(joiningDate) : null;
    if (noticePeriodDays  !== undefined) profileData.noticePeriodDays  = noticePeriodDays === null || noticePeriodDays === ""
                                                                          ? 30
                                                                          : Math.max(0, parseInt(String(noticePeriodDays), 10) || 0);
    if (workCountry       !== undefined) profileData.workCountry       = workCountry || "India";
    if (nationality       !== undefined) profileData.nationality       = nationality || "India";
    // Identity + bank PII may only be WRITTEN by doc-viewers (HR / CEO /
    // developer) — the same gate that lets them SEE it on GET. Editors who
    // can change the rest of a profile but can't see PII (special_access /
    // admin) receive it redacted, so writing here would silently wipe the
    // stored PAN / Aadhaar / bank. Skip those writes entirely for them.
    const putUser = session?.user as any;
    // Shared RBAC-aware tier (HR_CONFIDENTIAL via designation) — same gate
    // that governs SEEING the PII on GET.
    const putIsDocViewer = isLeadershipOrHR(putUser);
    if (putIsDocViewer) {
      if (panNumber         !== undefined) profileData.panNumber         = panNumber         ? String(panNumber).trim().toUpperCase() || null : null;
      if (aadhaarNumber     !== undefined) profileData.aadhaarNumber     = aadhaarNumber     ? String(aadhaarNumber).trim()           || null : null;
      if (aadhaarEnrollment !== undefined) profileData.aadhaarEnrollment = aadhaarEnrollment ? String(aadhaarEnrollment).trim()       || null : null;
      // Bank details — plaintext. IFSC is upper-cased for consistency.
      if (bankName          !== undefined) profileData.bankName          = bankName          ? String(bankName).trim()                       || null : null;
      if (bankBranch        !== undefined) profileData.bankBranch        = bankBranch        ? String(bankBranch).trim()                     || null : null;
      if (accountHolderName !== undefined) profileData.accountHolderName = accountHolderName ? String(accountHolderName).trim()              || null : null;
      if (bankAccountNumber !== undefined) profileData.bankAccountNumber = bankAccountNumber ? String(bankAccountNumber).trim()              || null : null;
      if (bankIfsc          !== undefined) profileData.bankIfsc          = bankIfsc          ? String(bankIfsc).trim().toUpperCase()         || null : null;
    }

    const userPatch: Record<string, unknown> = {};
    if (profilePictureUrl) userPatch.profilePictureUrl = profilePictureUrl;
    if (typeof displayName === "string" && displayName.trim().length > 0) {
      userPatch.name = displayName.trim().slice(0, 120);
    }
    if (newRole   !== undefined) userPatch.role     = newRole;
    if (orgLevel  !== undefined) userPatch.orgLevel = orgLevel;
    if (designationId !== undefined) {
      userPatch.designationId = designationId === null ? null : parseInt(String(designationId), 10);
      // Keep the DISPLAYED job-title designation in sync with the RBAC
      // designation's label, so the profile header, people list, org-tree,
      // search and pickers all show the chosen designation everywhere.
      if (userPatch.designationId != null) {
        try {
          const drow = await prisma.$queryRawUnsafe<Array<{ label: string }>>(
            `SELECT "label" FROM "Designation" WHERE "id" = $1`,
            userPatch.designationId,
          );
          if (drow[0]?.label) profileData.designation = drow[0].label;
        } catch { /* designation table missing → leave job title as-is */ }
      }
    }
    if (managerId !== undefined) {
      userPatch.managerId = managerId === null || managerId === "" ? null : parseInt(String(managerId), 10);
    }
    if (teamCapsule !== undefined) userPatch.teamCapsule = teamCapsule || null;
    if (leavePolicyId !== undefined) {
      userPatch.leavePolicyId = leavePolicyId === null || leavePolicyId === ""
        ? null
        : parseInt(String(leavePolicyId), 10);
    }

    // Login (official work) email — the address Google OAuth matches on to
    // sign the user in. Only doc-viewers (HR / CEO / developer) may change a
    // login credential. A BLANK value is a deliberate no-op: we never wipe an
    // account's email, since that would lock them out of sign-in. On change we
    // normalise (trim + lowercase) and pre-check uniqueness for a clean 409.
    if (workEmail !== undefined && workEmail !== null && String(workEmail).trim()) {
      if (!putIsDocViewer) {
        return NextResponse.json(
          { error: "Only HR / CEO / developers can change an employee's login email." },
          { status: 403 },
        );
      }
      const normalised = String(workEmail).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
        return NextResponse.json({ error: "Enter a valid login email address." }, { status: 400 });
      }
      if (normalised !== (target?.email ?? "").toLowerCase()) {
        const clash = await prisma.user.findUnique({
          where: { email: normalised },
          select: { id: true },
        });
        if (clash && clash.id !== id) {
          return NextResponse.json(
            { error: `Login email "${normalised}" already belongs to another account.` },
            { status: 409 },
          );
        }
        userPatch.email = normalised;
      }
    }

    const txOps: any[] = [];
    if (Object.keys(userPatch).length > 0) {
      txOps.push(prisma.user.update({ where: { id }, data: userPatch }));
    }
    if (existing && Object.values(profileData).some((v) => v !== undefined)) {
      txOps.push(prisma.employeeProfile.update({
        where: { userId: id },
        data: profileData as any,
      }));
    }
    if (txOps.length > 0) {
      try {
        await prisma.$transaction(txOps);
      } catch (e: any) {
        console.error("[people PUT] main transaction failed:", e);
        if (e?.code === "P2002" && Array.isArray(e?.meta?.target) && e.meta.target.includes("employeeId")) {
          return NextResponse.json(
            { error: `HRM No. is already used by another employee.` },
            { status: 409 },
          );
        }
        if (e?.code === "P2002" && Array.isArray(e?.meta?.target) && e.meta.target.includes("email")) {
          return NextResponse.json(
            { error: `Login email already belongs to another account.` },
            { status: 409 },
          );
        }
        return NextResponse.json({
          error: `Save failed: ${e?.message ?? "Unknown DB error"}`,
        }, { status: 500 });
      }
    }

    // Patch the columns the typed client may not know about yet (workPhone /
    // personalEmail / maritalStatus). Same pattern used in /api/hr/profile.
    if (existing) {
      const setParts: string[] = [];
      const args: unknown[] = [];
      let i = 1;
      if (workPhone     !== undefined) { setParts.push(`"workPhone" = $${i++}`);     args.push(workPhone     || null); }
      if (personalEmail !== undefined) { setParts.push(`"personalEmail" = $${i++}`); args.push(personalEmail || null); }
      if (maritalStatus !== undefined) { setParts.push(`"maritalStatus" = $${i++}`); args.push(maritalStatus || null); }
      if (businessUnit  !== undefined) { setParts.push(`"businessUnit" = $${i++}`);  args.push(businessUnit  || "NB Media"); }
      // ── Extended onboarding fields — written via raw SQL so the
      //    route doesn't need a fresh `prisma generate` cycle on the
      //    VPS to start accepting edits to these columns. ──
      if (secondaryJobTitle  !== undefined) { setParts.push(`"secondaryJobTitle" = $${i++}`);  args.push(secondaryJobTitle  || null); }
      if (legalEntity        !== undefined) { setParts.push(`"legalEntity" = $${i++}`);        args.push(legalEntity        || null); }
      if (jobLocation        !== undefined) { setParts.push(`"jobLocation" = $${i++}`);        args.push(jobLocation        || null); }
      if (probationPolicy    !== undefined) { setParts.push(`"probationPolicy" = $${i++}`);    args.push(probationPolicy    || null); }
      if (probationStartDate !== undefined) { setParts.push(`"probationStartDate" = $${i++}`); args.push(probationStartDate ? new Date(probationStartDate) : null); }
      // probationEndDate — either explicitly sent by HR (override) OR
      // auto-derived from joiningDate when this is the first time the
      // joining date is being set and probationEndDate is still NULL
      // on the row. The 3-month default mirrors the policy the user
      // confirmed; HR can edit it later from the same field. Clearing
      // probationEndDate also clears probationReminderSentAt so the
      // 7-day reminder re-arms cleanly when probation gets extended.
      const fetchProbationCurrent = async (): Promise<{ probationEndDate: Date | null } | null> => {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT "probationEndDate" FROM "EmployeeProfile" WHERE "userId" = $1`, id,
        );
        return rows[0] ?? null;
      };
      let probationEndToWrite: Date | null | undefined = undefined; // tri-state: skip / set / clear
      if (probationEndDate !== undefined) {
        probationEndToWrite = probationEndDate ? new Date(probationEndDate) : null;
      } else if (joiningDate !== undefined && joiningDate) {
        // Auto-set only when the row has no probationEndDate yet.
        // Avoids stomping an HR-edited value when joiningDate is
        // changed later.
        const cur = await fetchProbationCurrent();
        if (!cur?.probationEndDate) {
          const jd = new Date(joiningDate);
          const ed = new Date(jd);
          ed.setMonth(ed.getMonth() + 3);
          probationEndToWrite = ed;
        }
      }
      if (probationEndToWrite !== undefined) {
        setParts.push(`"probationEndDate" = $${i++}`);
        args.push(probationEndToWrite);
        // Re-arm BOTH probation reminder channels whenever probationEndDate is
        // rewritten — covers "cleared" (no reminder needed) and "extended" (a
        // fresh end date deserves a fresh window). Both dedupe stamps must
        // clear together: probationReminderSentAt gates the email reminder,
        // probationManagerNotifiedAt gates the in-app manager-review nudge.
        setParts.push(`"probationReminderSentAt" = $${i++}`);
        args.push(null);
        setParts.push(`"probationManagerNotifiedAt" = $${i++}`);
        args.push(null);
      }
      if (internshipEndDate  !== undefined) {
        setParts.push(`"internshipEndDate" = $${i++}`);
        args.push(internshipEndDate ? new Date(internshipEndDate) : null);
      }
      // educationDetails — JSON array on EmployeeProfile mirroring
      // the JobApplication.educationDetails shape. Accepts an array
      // verbatim, or a JSON-encoded string from older clients. Empty
      // array / null clears the field. Used by the compliance cron
      // (at least one entry with degree + institution required).
      if (educationDetails !== undefined) {
        let val: any = educationDetails;
        if (typeof val === "string") {
          try { val = JSON.parse(val); } catch { val = null; }
        }
        if (!Array.isArray(val)) val = null;
        setParts.push(`"educationDetails" = $${i++}::jsonb`);
        args.push(val === null ? null : JSON.stringify(val));
      }
      if (leavePlan          !== undefined) { setParts.push(`"leavePlan" = $${i++}`);          args.push(leavePlan          || null); }
      if (holidayList        !== undefined) { setParts.push(`"holidayList" = $${i++}`);        args.push(holidayList        || null); }
      if (weeklyOff          !== undefined) { setParts.push(`"weeklyOff" = $${i++}`);          args.push(weeklyOff          || null); }
      // Convention: Attendance Number == HRM (employeeId). When HR
      // submits the field empty we backfill with employeeId so the
      // two stay in sync without forcing them to retype it.
      if (attendanceNumber   !== undefined) {
        const an = (attendanceNumber && String(attendanceNumber).trim()) || existing?.employeeId || null;
        setParts.push(`"attendanceNumber" = $${i++}`); args.push(an);
      }
      if (timeTrackingPolicy !== undefined) { setParts.push(`"timeTrackingPolicy" = $${i++}`); args.push(timeTrackingPolicy || null); }
      if (penalizationPolicy !== undefined) { setParts.push(`"penalizationPolicy" = $${i++}`); args.push(penalizationPolicy || null); }
      // ── Keka-parity additions ──
      if (homePhone               !== undefined) { setParts.push(`"homePhone" = $${i++}`);               args.push(homePhone               || null); }
      if (physicallyHandicapped   !== undefined) { setParts.push(`"physicallyHandicapped" = $${i++}`);   args.push(physicallyHandicapped   || null); }
      if (addressLine2            !== undefined) { setParts.push(`"addressLine2" = $${i++}`);            args.push(addressLine2            || null); }
      if (addressPincode          !== undefined) { setParts.push(`"addressPincode" = $${i++}`);          args.push(addressPincode          || null); }
      if (addressCountry          !== undefined) { setParts.push(`"addressCountry" = $${i++}`);          args.push(addressCountry          || null); }
      if (permanentLine1          !== undefined) { setParts.push(`"permanentLine1" = $${i++}`);          args.push(permanentLine1          || null); }
      if (permanentLine2          !== undefined) { setParts.push(`"permanentLine2" = $${i++}`);          args.push(permanentLine2          || null); }
      if (permanentCity           !== undefined) { setParts.push(`"permanentCity" = $${i++}`);           args.push(permanentCity           || null); }
      if (permanentState          !== undefined) { setParts.push(`"permanentState" = $${i++}`);          args.push(permanentState          || null); }
      if (permanentPincode        !== undefined) { setParts.push(`"permanentPincode" = $${i++}`);        args.push(permanentPincode        || null); }
      if (permanentCountry        !== undefined) { setParts.push(`"permanentCountry" = $${i++}`);        args.push(permanentCountry        || null); }
      if (motherName              !== undefined) { setParts.push(`"motherName" = $${i++}`);              args.push(motherName              || null); }
      if (spouseName              !== undefined) { setParts.push(`"spouseName" = $${i++}`);              args.push(spouseName              || null); }
      if (childrenNames           !== undefined) { setParts.push(`"childrenNames" = $${i++}`);           args.push(childrenNames           || null); }
      if (emergencyRelationship   !== undefined) { setParts.push(`"emergencyRelationship" = $${i++}`);   args.push(emergencyRelationship   || null); }
      if (attendanceCaptureScheme !== undefined) { setParts.push(`"attendanceCaptureScheme" = $${i++}`); args.push(attendanceCaptureScheme || null); }
      if (costCenter              !== undefined) { setParts.push(`"costCenter" = $${i++}`);              args.push(costCenter              || null); }
      if (pfNumber                !== undefined) { setParts.push(`"pfNumber" = $${i++}`);                args.push(pfNumber                || null); }
      if (uanNumber               !== undefined) { setParts.push(`"uanNumber" = $${i++}`);               args.push(uanNumber               || null); }
      if (biometricId             !== undefined) { setParts.push(`"biometricId" = $${i++}`);             args.push(biometricId             || null); }
      // ── Statutory: PF + PT ──
      if (pfEstablishmentId       !== undefined) { setParts.push(`"pfEstablishmentId" = $${i++}`);       args.push(pfEstablishmentId       || null); }
      if (pfEpsMember             !== undefined) { setParts.push(`"pfEpsMember" = $${i++}`);             args.push(Boolean(pfEpsMember)); }
      if (pfNotEligible           !== undefined) { setParts.push(`"pfNotEligible" = $${i++}`);           args.push(Boolean(pfNotEligible)); }
      if (pfJoinDate              !== undefined) { setParts.push(`"pfJoinDate" = $${i++}`);              args.push(pfJoinDate ? new Date(pfJoinDate) : null); }
      if (pfAccountName           !== undefined) { setParts.push(`"pfAccountName" = $${i++}`);           args.push(pfAccountName           || null); }
      if (ptEstablishmentId       !== undefined) { setParts.push(`"ptEstablishmentId" = $${i++}`);       args.push(ptEstablishmentId       || null); }
      // ABOUT-tab bios. Empty string clears (stored NULL) to match the
      // /api/hr/profile self-edit behaviour.
      if (about   !== undefined) { setParts.push(`"about" = $${i++}`);   args.push(typeof about   === "string" && about.trim().length   > 0 ? about   : null); }
      if (jobLove !== undefined) { setParts.push(`"jobLove" = $${i++}`); args.push(typeof jobLove === "string" && jobLove.trim().length > 0 ? jobLove : null); }
      if (hobbies !== undefined) { setParts.push(`"hobbies" = $${i++}`); args.push(typeof hobbies === "string" && hobbies.trim().length > 0 ? hobbies : null); }
      if (setParts.length > 0) {
        args.push(id);
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeProfile" SET ${setParts.join(", ")} WHERE "userId" = $${i}`,
            ...args,
          );
        } catch (e) {
          console.warn("[people PUT] new-column raw update failed:", e);
        }
      }

      // Convention: Attendance No. == HRM No. When HR changes employeeId,
      // mirror the new value into attendanceNumber so the two stay in sync
      // (unless HR explicitly overrode attendanceNumber in the same save).
      if (employeeIdNew && attendanceNumber === undefined) {
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeProfile" SET "attendanceNumber" = $1 WHERE "userId" = $2`,
            employeeIdNew, id,
          );
        } catch (e) {
          console.warn("[people PUT] attendanceNumber sync failed:", e);
        }
      }
    }

    // inlineManagerId lives on User, not EmployeeProfile, and the typed
    // client may not know about it yet. Raw SQL keeps this independent
    // of `prisma generate` cache state on dev/VPS.
    if (inlineManagerId !== undefined) {
      const newInlineId = inlineManagerId === null || inlineManagerId === ""
        ? null
        : parseInt(String(inlineManagerId), 10);
      if (newInlineId !== null && newInlineId === id) {
        return NextResponse.json(
          { error: "Inline manager cannot be the same person." },
          { status: 400 },
        );
      }
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET "inlineManagerId" = $1 WHERE id = $2`,
          newInlineId,
          id,
        );
      } catch (e) {
        console.warn("[people PUT] inlineManagerId update failed:", e);
      }
    }

    // ── Shift assignment (Work Settings → "Week Days & Time Shift") ──
    // Upserts the user's single UserShift. effectiveFrom is only re-set when
    // the shift actually CHANGES — re-saving the section with the same shift
    // keeps the original anchor, so an alternate-Saturday rotation never
    // silently re-phases on an unrelated profile edit. When it IS set, anchor
    // it on the SHIFT's createdAt (not today) so the user shares the same
    // alternate-Saturday phase as everyone else on the shift — a today-anchor
    // can land out of phase and make the wrong Saturdays "working" only for
    // this person (see HRM161/162/164).
    if (body.shiftId !== undefined) {
      const sid = body.shiftId === null || body.shiftId === "" ? null : parseInt(String(body.shiftId), 10);
      try {
        const cur = await prisma.userShift.findUnique({ where: { userId: id }, select: { shiftId: true } });
        if (sid === null || !Number.isFinite(sid)) {
          if (cur) await prisma.userShift.delete({ where: { userId: id } });
        } else if (!cur || cur.shiftId !== sid) {
          const sh = await prisma.shift.findUnique({ where: { id: sid }, select: { createdAt: true } });
          const effectiveFrom = sh?.createdAt ?? istTodayDateOnly();
          if (!cur) await prisma.userShift.create({ data: { userId: id, shiftId: sid, effectiveFrom } });
          else await prisma.userShift.update({ where: { userId: id }, data: { shiftId: sid, effectiveFrom } });
        }
      } catch (e) { console.warn("[people PUT] shift assignment failed:", e); }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[people PUT] outer catch:", e);
    return NextResponse.json({
      error: `Save failed: ${e?.message ?? "Unknown error"}`,
    }, { status: 500 });
  }
}
