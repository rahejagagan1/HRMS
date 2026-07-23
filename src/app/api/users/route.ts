import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { can, hasResolvedPermissions } from "@/lib/permissions/can";
import { brandScopeUserWhere } from "@/lib/hr/brand-scope";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendEmail } from "@/lib/email/sender";
import { welcomeLoginEmail } from "@/lib/email/templates";

export const dynamic = 'force-dynamic';
import { serializeBigInt } from "@/lib/utils";
import { resolveTeamCapsuleForSave } from "@/lib/capsule-matching";
import { isDeveloperEmail } from "@/lib/hr/notification-policy";
import { regularSplit } from "@/lib/hr/salary-split";
import { probationWindow } from "@/lib/hr/probation";

// CEO + developer only — used for destructive actions (DELETE).
// Onboarding employees is gated separately by `canCreateUsers` so HR
// managers / admins / special_access can also onboard.
function canManageUsers(session: any): boolean {
    const user = session?.user as any;
    return user?.orgLevel === "ceo" || user?.isDeveloper === true;
}

// HR-admin tier — mirrors src/lib/access.ts:isHRAdmin so the onboarding
// form (POST /api/users) works for everyone the UI shows the wizard to:
// CEO / developer / special_access / role=admin / orgLevel=hr_manager.
function canCreateUsers(session: any): boolean {
    const user = session?.user as any;
    // RBAC-designation-driven (policy 2026-07-14): MANAGE_USERS is the
    // create/edit-users permission. Legacy expression kept only as the
    // fallback for sessions without resolved permissions.
    if (hasResolvedPermissions(user)) return can(user, "MANAGE_USERS");
    return (
        user?.orgLevel === "ceo" ||
        user?.isDeveloper === true ||
        user?.orgLevel === "special_access" ||
        user?.role === "admin" ||
        user?.orgLevel === "hr_manager"
    );
}

export async function GET(request: Request) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        const viewer = session?.user as any;

        const { searchParams } = new URL(request.url);
        const includeAll      = searchParams.get("all") === "true";
        const includeInactive = searchParams.get("includeInactive") === "true";

        // Default = active only. `?all=true` widens the role filter so
        // post-Keka member/member rows are pickable in dropdowns. The
        // separate `?includeInactive=true` flag is needed for the admin
        // user table — HR keeps inactive employees visible (with the
        // "Inactive" badge) for record-keeping but they're still
        // excluded from rating lists, email reminders, and login.
        const where: any = {};
        if (!includeInactive) where.isActive = true;
        if (!includeAll)      where.NOT = { role: "member", orgLevel: "member" };

        // Developer invisibility: developer accounts are hidden from
        // everyone except other developers. CEO sees the org without
        // them. NOT clauses can be merged via AND.
        const viewerIsDev = isDeveloperEmail(viewer?.email ?? null);
        const devEmails = (process.env.DEVELOPER_EMAILS || "")
            .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!viewerIsDev && devEmails.length > 0) {
            where.AND = [{ NOT: { email: { in: devEmails } } }];
        }

        // Org-wide brand isolation (2026-07-15): without VIEW_ALL_BRANDS the
        // caller only ever sees their OWN brand's users in the admin table
        // and every dropdown this endpoint feeds.
        const brandClamp = brandScopeUserWhere(viewer);
        if (Object.keys(brandClamp).length) {
            where.AND = [...(where.AND ?? []), brandClamp];
        }

        const users = await prisma.user.findMany({
            where,
            orderBy: [{ role: "asc" }, { name: "asc" }],
            select: {
                id: true,
                clickupUserId: true,
                name: true,
                email: true,
                role: true,
                orgLevel: true,
                managerId: true,
                teamCapsule: true,
                monthlyDeliveryTargetCases: true,
                isActive: true,
                profilePictureUrl: true,
            },
        });

        // Attach designationId via raw SQL — the typed client may not know the
        // column yet (pre-`prisma generate`). Cheap: one query over all users.
        let desigById = new Map<number, number | null>();
        try {
            const rows = await prisma.$queryRawUnsafe<{ id: number; designationId: number | null }[]>(
                `SELECT "id","designationId" FROM "User"`
            );
            desigById = new Map(rows.map((r) => [r.id, r.designationId]));
        } catch { /* column missing pre-migration → no-op */ }
        const withDesignation = users.map((u) => ({ ...u, designationId: desigById.get(u.id) ?? null }));

        return NextResponse.json(serializeBigInt(withDesignation));
    } catch (error) {
        return serverError(error, "route");
    }
}

// POST: Add new user — HR admin tier (CEO / dev / admin / special_access / hr_manager)
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!canCreateUsers(session)) {
            return NextResponse.json({ error: "Only HR managers and admins can add users" }, { status: 403 });
        }

        const body = await request.json();
        const {
            name, email: rawEmail, role, orgLevel, clickupUserId, teamCapsule, managerId,
            designationId,              // optional RBAC Designation link (drives job title / perms)
            inlineManagerId,            // optional secondary / dotted-line manager
            inviteToLogin,              // boolean: if true, email a welcome / sign-in link
            enableOnboarding,           // boolean: if true, gate first login behind /onboarding
            leavePolicyId,              // optional: assign a LeavePolicy at creation
            profile,                    // optional EmployeeProfile payload
            shiftId,                    // optional UserShift assignment
            leaveBalances,              // optional: [{ leaveTypeId, totalDays }] for current year
            compensation,               // optional SalaryStructure payload (regular | intern)
        } = body;

        // Normalise the email to lowercase — Google OAuth always sends the
        // address in lowercase, so a stray capital typed by HR here would make
        // the login lookup miss (case-sensitive unique). Store it lowercased so
        // that can't happen. (Auth also matches case-insensitively as a safety
        // net, but keeping the DB clean avoids duplicate-casing rows entirely.)
        const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;

        if (!name || !email) {
            return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
        }

        let resolvedCapsule: string | null = null;
        if (teamCapsule !== undefined && teamCapsule !== null && String(teamCapsule).trim() !== "") {
            const resolved = await resolveTeamCapsuleForSave(teamCapsule);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: 400 });
            }
            resolvedCapsule = resolved.value;
        }

        // ── ClickUp linking (manual flow) ────────────────────────────────
        // Programmatic ClickUp invites require the Enterprise plan, which
        // we're not on. HR invites people through ClickUp's UI; the nightly
        // sync backfills the real ClickUp user-id when the email matches.
        // Until then we use the caller-supplied id, or a synthetic Date.now()
        // placeholder so the column (which is unique-but-nullable in schema)
        // doesn't collide between simultaneous creates.
        const resolvedClickupId: bigint = clickupUserId
            ? BigInt(clickupUserId)
            : BigInt(Date.now());

        // ── Local upsert, wrapped so profile + shift + balances ride along ─
        // We deliberately upsert (not create-only) on email so HR can finish
        // onboarding for someone who already signed in via Google OAuth and
        // therefore already has a thin User row. The HR-supplied data wins
        // wherever it's present, but we don't clobber an existing
        // clickupUserId (the sync may have already linked them).
        const { user, isUpdate } = await prisma.$transaction(async (tx) => {
            const existing = await tx.user.findUnique({
                where: { email },
                select: { id: true, clickupUserId: true },
            });

            // Update branch: ONLY touch role / orgLevel / managerId
            // when the caller explicitly sent them. This is what
            // protects the bulk-Keka import from clobbering existing
            // leads/managers down to "member" — the bulk path now
            // omits those fields, so existing values are preserved.
            // Single-employee onboarding still sets role/orgLevel
            // explicitly (it always sends a value), so its behaviour
            // is unchanged.
            let created;
            if (existing) {
                const updateData: any = { name };
                if (resolvedCapsule !== null || teamCapsule !== undefined) updateData.teamCapsule = resolvedCapsule;
                if (!existing.clickupUserId) updateData.clickupUserId = resolvedClickupId;
                if (role !== undefined && role !== null && role !== "") updateData.role = role;
                if (orgLevel !== undefined && orgLevel !== null && orgLevel !== "") updateData.orgLevel = orgLevel;
                if (managerId !== undefined) {
                    updateData.managerId = (managerId === null || managerId === "" || managerId === 0)
                        ? null
                        : Number(managerId);
                }
                if (leavePolicyId !== undefined) {
                    updateData.leavePolicyId = (leavePolicyId === null || leavePolicyId === "")
                        ? null
                        : Number(leavePolicyId);
                }
                // Detect role/orgLevel change so we can re-sync tab perms
                // after the update commits (same logic as Admin → Users
                // PATCH). Read the pre-update values from the DB so we're
                // not relying on whatever `existing` happened to include.
                const preRoleRow = await tx.user.findUnique({
                    where: { id: existing.id },
                    select: { role: true, orgLevel: true },
                });
                created = await tx.user.update({ where: { id: existing.id }, data: updateData });
                const roleChanged     = preRoleRow && updateData.role     !== undefined && updateData.role     !== preRoleRow.role;
                const orgLevelChanged = preRoleRow && updateData.orgLevel !== undefined && updateData.orgLevel !== preRoleRow.orgLevel;
                if (roleChanged || orgLevelChanged) {
                    try {
                        await tx.$executeRawUnsafe(
                            `DELETE FROM "UserTabPermission" WHERE "userId" = $1`,
                            existing.id,
                        );
                    } catch (e) {
                        console.warn("[users POST] tab-permission resync skipped:", e);
                    }
                }
            } else {
                created = await tx.user.create({
                    data: {
                        name,
                        email,
                        role: role || "member",
                        orgLevel: orgLevel || "member",
                        clickupUserId: resolvedClickupId,
                        teamCapsule: resolvedCapsule,
                        managerId: managerId || null,
                        leavePolicyId: leavePolicyId == null || leavePolicyId === "" ? null : Number(leavePolicyId),
                    },
                });
            }

            // RBAC designation link — raw SQL (typed client may lag on the
            // column). Keeps the displayed job-title designation in sync with
            // the chosen Designation's label, mirroring the People PUT route.
            if (designationId !== undefined) {
                const did = designationId === null || designationId === "" ? null : Number(designationId);
                await tx.$executeRawUnsafe(
                    `UPDATE "User" SET "designationId" = $1 WHERE id = $2`,
                    did, created.id,
                );
                if (did != null && profile && typeof profile === "object") {
                    try {
                        const drow = await tx.$queryRawUnsafe<Array<{ label: string }>>(
                            `SELECT "label" FROM "Designation" WHERE id = $1`, did,
                        );
                        if (drow[0]?.label) (profile as any).designation = drow[0].label;
                    } catch { /* Designation table missing → keep the sent label */ }
                }
            }

            // Mark new hire for first-login wizard if HR opted in. Done via
            // raw SQL so it works before `prisma generate` has picked up the
            // new column on hot-reloaded dev clients.
            if (enableOnboarding) {
                await tx.$executeRawUnsafe(
                    `UPDATE "User" SET "onboardingPending" = true WHERE id = $1`,
                    created.id,
                );
            }

            // Inline manager — same raw-SQL pattern (typed client may not
            // know about the column on a stale `prisma generate` cache).
            // Self-reference guarded: a brand-new user can't pick themselves
            // anyway, but the explicit check matches the PUT endpoint.
            if (inlineManagerId !== undefined) {
                const inlineId = inlineManagerId === null || inlineManagerId === ""
                    ? null
                    : Number(inlineManagerId);
                if (inlineId !== null && inlineId !== created.id) {
                    await tx.$executeRawUnsafe(
                        `UPDATE "User" SET "inlineManagerId" = $1 WHERE id = $2`,
                        inlineId,
                        created.id,
                    );
                } else if (inlineId === null) {
                    await tx.$executeRawUnsafe(
                        `UPDATE "User" SET "inlineManagerId" = NULL WHERE id = $1`,
                        created.id,
                    );
                }
            }

            if (profile && typeof profile === "object") {
                // Derive firstName / lastName from `name` if the caller didn't
                // supply them — schema requires both.
                const nameParts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
                const firstName = profile.firstName || nameParts[0] || "Unknown";
                const lastName  = profile.lastName  || nameParts.slice(1).join(" ") || "Unknown";
                // Default nationality. numberSeriesId is best-effort: the
                // EmployeeNumberSeries table is the source of truth, but for
                // ad-hoc creates we fall back to the lowest active series id.
                const fallbackSeries = await tx.employeeNumberSeries.findFirst({
                    where: { isActive: true },
                    orderBy: { id: "asc" },
                    select: { id: true },
                });
                const numberSeriesId = profile.numberSeriesId ?? fallbackSeries?.id;
                if (!numberSeriesId) {
                    throw new Error("No active EmployeeNumberSeries — create one before adding employees.");
                }
                // Auto-allocate the employee ID from the chosen series when the
                // caller didn't supply one. The atomic increment-and-return
                // pattern serialises concurrent creates so two new hires can
                // never collide on the same ID.
                // Re-onboard guard: don't burn a series number if the user
                // already has an EmployeeProfile.
                const existingProfile = await tx.employeeProfile.findUnique({
                    where: { userId: created.id },
                    select: { employeeId: true },
                });
                let employeeId: string;
                if (profile.employeeId) {
                    employeeId = String(profile.employeeId).trim();
                } else if (existingProfile?.employeeId) {
                    employeeId = existingProfile.employeeId;
                } else {
                    const bumped = await tx.employeeNumberSeries.update({
                        where: { id: numberSeriesId },
                        data:  { nextNumber: { increment: 1 } },
                        select: { prefix: true, nextNumber: true, isActive: true },
                    });
                    if (!bumped.isActive) {
                        throw new Error("Selected number series is inactive");
                    }
                    const claimed = bumped.nextNumber - 1;
                    employeeId = `${bumped.prefix}${claimed}`;
                }
                // `as any` so the typed Prisma client doesn't fight the
                // recently-added Keka-parity columns (homePhone /
                // physicallyHandicapped / addressLine2 / etc.) — same
                // workaround used elsewhere in the codebase when the
                // generated client lags behind a fresh migration.
                const profileData: any = {
                    employeeId,
                    firstName,
                    lastName,
                    nationality:      profile.nationality      ?? "Indian",
                    numberSeriesId,
                    designation:      profile.designation      ?? null,
                    department:       profile.department       ?? null,
                    employmentType:   profile.employmentType   ?? "fulltime",
                    workLocation:     profile.workLocation     ?? "office",
                    joiningDate:      profile.joiningDate      ? new Date(profile.joiningDate) : null,
                    phone:            profile.phone            ?? null,
                    dateOfBirth:      profile.dateOfBirth      ? new Date(profile.dateOfBirth) : null,
                    gender:           profile.gender           ?? null,
                    maritalStatus:    profile.maritalStatus    ?? null,
                    bloodGroup:       profile.bloodGroup       ?? null,
                    emergencyPhone:   profile.emergencyPhone   ?? null,
                    address:          profile.address          ?? null,
                    city:             profile.city             ?? null,
                    state:            profile.state            ?? null,
                    noticePeriodDays: Number.isFinite(profile.noticePeriodDays) ? profile.noticePeriodDays : 30,
                    // ── Keka-parity additions ──
                    workPhone:               profile.workPhone               ?? null,
                    homePhone:               profile.homePhone               ?? null,
                    personalEmail:           profile.personalEmail           ?? null,
                    physicallyHandicapped:   profile.physicallyHandicapped   ?? null,
                    parentName:              profile.parentName              ?? null,
                    motherName:              profile.motherName              ?? null,
                    spouseName:              profile.spouseName              ?? null,
                    childrenNames:           profile.childrenNames           ?? null,
                    emergencyRelationship:   profile.emergencyRelationship   ?? null,
                    addressLine2:            profile.addressLine2            ?? null,
                    addressPincode:          profile.addressPincode          ?? null,
                    addressCountry:          profile.addressCountry          ?? null,
                    permanentLine1:          profile.permanentLine1          ?? null,
                    permanentLine2:          profile.permanentLine2          ?? null,
                    permanentCity:           profile.permanentCity           ?? null,
                    permanentState:          profile.permanentState          ?? null,
                    permanentPincode:        profile.permanentPincode        ?? null,
                    permanentCountry:        profile.permanentCountry        ?? null,
                    attendanceCaptureScheme: profile.attendanceCaptureScheme ?? null,
                    costCenter:              profile.costCenter              ?? null,
                    // Convention: Attendance Number == HRM (employeeId).
                    // If the form supplied a value, honour it; otherwise
                    // backfill with the freshly-allocated employeeId so
                    // the two stay identical without HR retyping.
                    attendanceNumber:        (profile.attendanceNumber && String(profile.attendanceNumber).trim())
                                              || employeeId
                                              || null,
                    panNumber:               profile.panNumber               ?? null,
                    aadhaarNumber:           profile.aadhaarNumber           ?? null,
                    pfNumber:                profile.pfNumber                ?? null,
                    uanNumber:               profile.uanNumber               ?? null,
                    biometricId:             profile.biometricId             ?? null,
                };
                // Auto-probation: every new hire starts on a 3-month probation
                // from their joining date (HR can extend later). Only applied
                // when the profile is NEW — re-saving an existing employee must
                // never reset their probation clock.
                const probationCreate = !existingProfile
                    ? (() => {
                        const w = probationWindow(profile.joiningDate ? new Date(profile.joiningDate) : null);
                        return {
                            probationStartDate: w.start,
                            probationEndDate:   w.end,
                            probationPolicy:    profile.probationPolicy ?? "Regular Employees",
                        };
                    })()
                    : {};
                await tx.employeeProfile.upsert({
                    where:  { userId: created.id },
                    create: { userId: created.id, ...profileData, ...probationCreate },
                    update: profileData,
                });
            }

            if (shiftId) {
                // Anchor the UserShift at the SHIFT's createdAt, not the default
                // now(). The alternate-Saturday phase falls back to
                // UserShift.effectiveFrom when a caller doesn't load the shift's
                // createdAt (e.g. the leave-day counter), so a new joiner
                // defaulting to their join date can land out of phase with
                // everyone else on the shift — wrong Saturdays show as working
                // only for them (see HRM161/162/164). Using the shift's own
                // anchor keeps every user on the shift on the same phase.
                const sh = await tx.shift.findUnique({ where: { id: Number(shiftId) }, select: { createdAt: true } });
                await tx.userShift.upsert({
                    where:  { userId: created.id },
                    create: { userId: created.id, shiftId: Number(shiftId), ...(sh ? { effectiveFrom: sh.createdAt } : {}) },
                    update: { shiftId: Number(shiftId) },
                });
            }

            if (Array.isArray(leaveBalances) && leaveBalances.length > 0) {
                const now = new Date();
                const year = now.getFullYear();
                // Stamp the joining month so the next monthly accrual job
                // credits +1 Sick Leave at the start of next month — and
                // doesn't retroactively credit months they weren't here for.
                const currentYm = `${year}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                for (const lb of leaveBalances) {
                    if (!lb?.leaveTypeId) continue;
                    await tx.leaveBalance.upsert({
                        where: {
                            userId_leaveTypeId_year: {
                                userId:      created.id,
                                leaveTypeId: Number(lb.leaveTypeId),
                                year,
                            },
                        },
                        create: {
                            userId:      created.id,
                            leaveTypeId: Number(lb.leaveTypeId),
                            year,
                            totalDays:   lb.totalDays ?? 0,
                        },
                        update: { totalDays: lb.totalDays ?? 0 },
                    });
                }
                // Patch lastAccrualMonth via raw SQL — stale typed clients
                // won't know about this column yet.
                await tx.$executeRawUnsafe(
                    `UPDATE "LeaveBalance" SET "lastAccrualMonth" = $1
                       WHERE "userId" = $2 AND year = $3 AND "lastAccrualMonth" IS NULL`,
                    currentYm, created.id, year,
                );
            }

            // ── Salary structure ─────────────────────────────────────────
            // Form sends one of two shapes:
            //   intern  → { salaryType:"intern",  monthlyBasic, effectiveFrom }
            //   regular → { salaryType:"regular", annualCtc, payGroup, ... }
            // We compute breakup components here so they match what the
            // wizard previewed on screen.
            //
            // Salary policy (onboarding exception): ANY authorised onboarder
            // may save the salary they enter in Step 4 — this POST already
            // required canCreateUsers to get here, so if they're trusted to
            // onboard the employee they're trusted to record the salary they
            // just typed. This means an entered Step 4 salary is NEVER silently
            // dropped. Scoped to ONBOARDING ONLY: seeing or editing salary
            // anywhere else in the app (Finances tab, profile Compensation
            // panel, payroll) still requires canViewSalary — the salary-
            // structure POST behind those surfaces keeps its own gate.
            if (compensation && typeof compensation === "object") {
                const effectiveFrom = compensation.effectiveFrom
                    ? new Date(compensation.effectiveFrom)
                    : new Date();
                const isIntern = compensation.salaryType === "intern";
                const pfElig   = !isIntern && !!compensation.pfEligible;
                // ALL component amounts are stored ANNUAL (the payslip divides
                // by 12 at display). This mirrors the HR salary form exactly —
                // both use regularSplit() from lib/hr/salary-split so the two
                // paths can't drift. (They used to: this path computed the split
                // off the MONTHLY figure and dropped DA/Conveyance/Medical on
                // save, giving API-onboarded hires 1/12-scale components with
                // three heads at 0. See HRM161 Harman Singh.)
                let ctc: number, basic: number, hra: number, da: number, conv: number,
                    med: number, special: number, pfEmp: number, pfEmpr: number;
                if (isIntern) {
                    // Flat stipend, stored ANNUAL (stipend × 12) like the form;
                    // no allowance split, no PF.
                    const stipend = Number(compensation.monthlyBasic) || 0;
                    ctc = stipend * 12; basic = stipend * 12;
                    hra = 0; da = 0; conv = 0; med = 0; special = 0; pfEmp = 0; pfEmpr = 0;
                } else {
                    ctc = Number(compensation.annualCtc) || 0;
                    const s = regularSplit(ctc, pfElig);
                    basic = s.basic; hra = s.hra; da = s.da; conv = s.conv;
                    med = s.medical; special = s.special; pfEmp = s.pfEmp; pfEmpr = s.pfEmpr;
                }
                const typedData = {
                    ctc,
                    basic,
                    hra,
                    dearnessAllowance:   da,
                    conveyanceAllowance: conv,
                    medicalAllowance:    med,
                    specialAllowance:    special,
                    pfEmployee:    pfEmp,
                    pfEmployer:    pfEmpr,
                    esiEmployee:   0,
                    esiEmployer:   0,
                    tds:           0,
                    professionalTax: 0,
                    effectiveFrom,
                };
                await tx.salaryStructure.upsert({
                    where:  { userId: created.id },
                    create: { userId: created.id, ...typedData },
                    update: typedData,
                });
                await tx.$executeRawUnsafe(
                    `UPDATE "SalaryStructure"
                       SET "salaryType"=$1, "payGroup"=$2, "bonusIncluded"=$3,
                           "taxRegime"=$4, "structureType"=$5, "pfEligible"=$6
                     WHERE "userId"=$7`,
                    isIntern ? "intern" : "regular",
                    compensation.payGroup ?? null,
                    !!compensation.bonusIncluded,
                    compensation.taxRegime ?? null,
                    compensation.structureType ?? null,
                    pfElig,
                    created.id,
                );
            }

            return { user: created, isUpdate: !!existing };
        });

        // Persist businessUnit + legalEntity via raw SQL — keeps things
        // working even if the typed Prisma client hasn't been
        // regenerated after the schema change. Same pattern other new
        // columns use here. Defaults businessUnit to "NB Media" when
        // caller didn't supply one (treat blank as the parent brand);
        // legalEntity is left NULL when not provided so we don't paper
        // over a real onboarding gap.
        if (profile && typeof profile === "object") {
            const bu = (typeof profile.businessUnit === "string" && profile.businessUnit.trim())
                ? profile.businessUnit.trim()
                : "NB Media";
            try {
                await prisma.$executeRawUnsafe(
                    `UPDATE "EmployeeProfile" SET "businessUnit" = $1 WHERE "userId" = $2`,
                    bu,
                    user.id,
                );
            } catch (e) {
                console.warn("[users POST] businessUnit update failed:", e);
            }
            const le = (typeof profile.legalEntity === "string" && profile.legalEntity.trim())
                ? profile.legalEntity.trim()
                : null;
            if (le) {
                try {
                    await prisma.$executeRawUnsafe(
                        `UPDATE "EmployeeProfile" SET "legalEntity" = $1 WHERE "userId" = $2`,
                        le,
                        user.id,
                    );
                } catch (e) {
                    console.warn("[users POST] legalEntity update failed:", e);
                }
            }
        }

        // Welcome / sign-in email — fire-and-forget so a transient SMTP
        // failure doesn't roll back the create.
        if (inviteToLogin && email) {
            void sendEmail({
                to: email,
                content: welcomeLoginEmail({
                    name: name || email,
                    email,
                    needsOnboarding: !!enableOnboarding,
                }),
            });
        }

        return NextResponse.json({ ...serializeBigInt(user), isUpdate });
    } catch (error: any) {
        // Email uniqueness is now handled by the upsert path; P2002 here is
        // most likely a clickupUserId collision (synthetic placeholder
        // matched another row's value). Fall back to a clearer message.
        if (error.code === "P2002") {
            return NextResponse.json(
                { error: "Couldn't link this account — a unique field is already taken (likely ClickUp ID)." },
                { status: 409 },
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE: Remove user (CEO / Developer only)
export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!canManageUsers(session)) {
            return NextResponse.json({ error: "Only CEO and developers can delete users" }, { status: 403 });
        }

        const { id } = await request.json();

        // Clean up all related records before deleting the user to avoid FK constraint errors
        await prisma.notification.deleteMany({ where: { userId: id } });
        await prisma.userTabPermission.deleteMany({ where: { userId: id } });
        await prisma.leaveBalance.deleteMany({ where: { userId: id } });
        await prisma.leaveApplication.deleteMany({ where: { userId: id } });
        await prisma.attendance.deleteMany({ where: { userId: id } });
        await prisma.attendanceRegularization.deleteMany({ where: { userId: id } });
        await prisma.wFHRequest.deleteMany({ where: { userId: id } });
        await prisma.compOffRequest.deleteMany({ where: { userId: id } });
        await prisma.userShift.deleteMany({ where: { userId: id } });
        await prisma.youtubeDashUserQuarterChannel.deleteMany({ where: { userId: id } });
        await prisma.monthlyRating.deleteMany({ where: { userId: id } });
        await prisma.monthlyReport.deleteMany({ where: { managerId: id } });
        await prisma.weeklyReport.deleteMany({ where: { managerId: id } });
        await prisma.managerRating.deleteMany({ where: { managerId: id } });
        await prisma.userReportAccess.deleteMany({ where: { userId: id } });
        await prisma.announcementRead.deleteMany({ where: { userId: id } });
        await prisma.userFeedback.deleteMany({ where: { userId: id } });
        await prisma.violation.deleteMany({ where: { OR: [{ userId: id }, { reportedBy: id }] } });
        await prisma.auditLog.deleteMany({ where: { actorId: id } });
        await prisma.employeeProfile.deleteMany({ where: { userId: id } });

        await prisma.user.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
