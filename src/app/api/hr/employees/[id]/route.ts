import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { istTodayDateOnly } from "@/lib/ist-date";

// GET /api/hr/employees/:id
//
// IDOR guard: previously any authenticated employee could enumerate
// every other employee's profile (assets, docs, leave balances) by
// guessing IDs. Restrict to HR-admin OR the employee themselves.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;


        const { id: idRaw } = await params;
  try {
    const id = parseInt(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const callerId = await resolveUserId(session);
    const isSelf = callerId != null && callerId === id;
    if (!isSelf && !isHRAdmin(session!.user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        employeeProfile: true,
        manager: { select: { id: true, name: true, profilePictureUrl: true } },
        teamMembers: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
        userShift: { include: { shift: true } },
        leaveBalances: { include: { leaveType: true } },
        heldAssets: { where: { returnedAt: null }, include: { asset: true } },
        ownedDocuments: true,
      },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(user);
  } catch (e) {
    return serverError(e, "GET /api/hr/employees/[id]");
  }
}

// PUT /api/hr/employees/:id
//
// HR-admin only. Lets HR edit any employee's User row + profile.
// Previously this had no role check — any authenticated employee
// could overwrite anyone else's name / role / orgLevel / isActive
// / managerId / profileData.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }


        const { id: idRaw } = await params;
  try {
    const id = parseInt(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await req.json();
    const { name, role, orgLevel, managerId, isActive, teamCapsule, ...profileData } = body;

    const userUpdate: any = {};
    if (name !== undefined) userUpdate.name = name;
    if (role !== undefined) userUpdate.role = role;
    if (orgLevel !== undefined) userUpdate.orgLevel = orgLevel;
    if (managerId !== undefined) userUpdate.managerId = managerId || null;
    if (isActive !== undefined) userUpdate.isActive = isActive;
    if (teamCapsule !== undefined) userUpdate.teamCapsule = teamCapsule;

    if (Object.keys(userUpdate).length > 0) {
      await prisma.user.update({ where: { id }, data: userUpdate });
    }

    if (Object.keys(profileData).length > 0) {
      if (profileData.joiningDate) profileData.joiningDate = new Date(profileData.joiningDate);
      if (profileData.dateOfBirth) profileData.dateOfBirth = new Date(profileData.dateOfBirth);

      await prisma.employeeProfile.upsert({
        where: { userId: id },
        create: { userId: id, employeeId: `NB-${istTodayDateOnly().getUTCFullYear()}-${String(id).padStart(3, "0")}`, ...profileData },
        update: profileData,
      });
    }

    const updated = await prisma.user.findUnique({
      where: { id },
      include: { employeeProfile: true, manager: { select: { id: true, name: true } } },
    });
    return NextResponse.json(updated);
  } catch (e) {
    return serverError(e, "PUT /api/hr/employees/[id]");
  }
}
