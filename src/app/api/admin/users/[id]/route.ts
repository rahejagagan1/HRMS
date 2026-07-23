import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveTeamCapsuleForSave } from "@/lib/capsule-matching";
import { requireAdmin, serverError } from "@/lib/api-auth";

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { errorResponse } = await requireAdmin();
    if (errorResponse) return errorResponse;


        const { id: idRaw } = await params;
    try {
        const id = parseInt(idRaw);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        const body = await request.json();
        const updateData: any = {};

        if (body.role !== undefined) updateData.role = body.role;
        if (body.orgLevel !== undefined) updateData.orgLevel = body.orgLevel;
        // Designation-based RBAC. The single Designation picker sends this plus
        // the derived role/orgLevel (compat shim) so current access is unchanged.
        if (body.designationId !== undefined) {
            updateData.designationId = body.designationId === null ? null : parseInt(String(body.designationId), 10);
            // Sync the displayed job-title designation to the RBAC designation
            // label so the header / lists / org-tree / pickers show it everywhere.
            if (updateData.designationId != null) {
                try {
                    await prisma.$executeRawUnsafe(
                        `UPDATE "EmployeeProfile" SET "designation" = d."label"
                         FROM "Designation" d
                         WHERE "EmployeeProfile"."userId" = $1 AND d."id" = $2`,
                        id, updateData.designationId,
                    );
                } catch { /* no profile / table missing → skip */ }
            }
        }
        if (body.managerId !== undefined) {
            updateData.managerId = body.managerId === null ? null : parseInt(body.managerId);
        }
        if (body.monthlyDeliveryTargetCases !== undefined) {
            const v = body.monthlyDeliveryTargetCases;
            updateData.monthlyDeliveryTargetCases =
                v === null || v === "" ? null : Math.max(0, parseInt(String(v), 10) || 0);
        }
        if (body.teamCapsule !== undefined) {
            const resolved = await resolveTeamCapsuleForSave(body.teamCapsule);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: 400 });
            }
            updateData.teamCapsule = resolved.value;
        }

        // Before the update, capture role/orgLevel so we know whether to
        // re-sync tab permissions. The Tab Permissions UI lets admins
        // override role-derived defaults per-user; once an override row
        // exists, role changes here stop propagating, which is surprising.
        // Solution: when role or orgLevel changes via Admin → Users,
        // wipe any UserTabPermission rows for that user — their effective
        // permissions then fall back to the new role's defaults from
        // ROLE_TAB_OVERRIDES. HR can still re-override afterward.
        const before = await prisma.user.findUnique({
            where: { id },
            select: { role: true, orgLevel: true },
        });

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                role: true,
                orgLevel: true,
                managerId: true,
                manager: { select: { id: true, name: true } },
            },
        });

        const roleChanged     = before && updateData.role !== undefined     && updateData.role     !== before.role;
        const orgLevelChanged = before && updateData.orgLevel !== undefined && updateData.orgLevel !== before.orgLevel;
        if (roleChanged || orgLevelChanged) {
            try {
                // Raw SQL — the generated Prisma client may not include
                // UserTabPermission on some dev machines. Best-effort: if
                // the table is missing, we silently no-op rather than
                // failing the whole PATCH.
                await prisma.$executeRawUnsafe(
                    `DELETE FROM "UserTabPermission" WHERE "userId" = $1`,
                    id,
                );
            } catch (e) {
                console.warn("[admin/users PATCH] tab-permission resync skipped:", e);
            }
        }

        return NextResponse.json(user);
    } catch (error) {
        return serverError(error, "admin/users/[id] PATCH");
    }
}
