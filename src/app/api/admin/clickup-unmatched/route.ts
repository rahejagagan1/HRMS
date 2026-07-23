import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";
import { resolveTeamCapsuleForSave } from "@/lib/capsule-matching";

export const dynamic = "force-dynamic";

// GET: list ClickUp users whose email did not match any HR user at last sync.
export async function GET() {
    try {
        const { errorResponse } = await requireAdmin();
        if (errorResponse) return errorResponse;

        const rows = await prisma.clickupUnmatchedUser.findMany({
            orderBy: { lastSeenAt: "desc" },
        });

        return NextResponse.json(serializeBigInt(rows));
    } catch (error) {
        return serverError(error, "admin/clickup-unmatched GET");
    }
}

// POST: onboard an unmatched ClickUp user into HR — creates a User row linked to the ClickUp ID
// and removes the unmatched record. Body: { id, role?, orgLevel?, managerId?, teamCapsule?, name? }.
export async function POST(request: NextRequest) {
    try {
        const { errorResponse } = await requireAdmin();
        if (errorResponse) return errorResponse;

        const body = await request.json();
        const { id, role, orgLevel, managerId, teamCapsule, name } = body || {};
        if (!id) {
            return NextResponse.json({ error: "id is required" }, { status: 400 });
        }

        const unmatched = await prisma.clickupUnmatchedUser.findUnique({ where: { id: Number(id) } });
        if (!unmatched) {
            return NextResponse.json({ error: "Unmatched user not found" }, { status: 404 });
        }

        let resolvedCapsule: string | null = null;
        if (teamCapsule !== undefined && teamCapsule !== null && String(teamCapsule).trim() !== "") {
            const resolved = await resolveTeamCapsuleForSave(teamCapsule);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: 400 });
            }
            resolvedCapsule = resolved.value;
        }

        const email = unmatched.email.trim().toLowerCase();

        // Collision guard: another HR user may already hold this clickupUserId.
        const collision = await prisma.user.findUnique({
            where: { clickupUserId: unmatched.clickupUserId },
            select: { id: true, email: true },
        });
        if (collision) {
            return NextResponse.json(
                { error: `ClickUp ID already linked to HR user ${collision.email}` },
                { status: 409 },
            );
        }

        const user = await prisma.user.create({
            data: {
                name: name || unmatched.name || email,
                email,
                role: role || "member",
                orgLevel: orgLevel || "member",
                clickupUserId: unmatched.clickupUserId,
                profilePictureUrl: unmatched.profilePictureUrl,
                teamCapsule: resolvedCapsule,
                managerId: managerId || null,
            },
        });

        await prisma.clickupUnmatchedUser.delete({ where: { id: unmatched.id } });

        return NextResponse.json(serializeBigInt(user));
    } catch (error: any) {
        if (error?.code === "P2002") {
            return NextResponse.json(
                { error: "User with this email or ClickUp ID already exists" },
                { status: 409 },
            );
        }
        return serverError(error, "admin/clickup-unmatched POST");
    }
}

// DELETE: dismiss an unmatched ClickUp user from the queue without onboarding.
export async function DELETE(request: NextRequest) {
    try {
        const { errorResponse } = await requireAdmin();
        if (errorResponse) return errorResponse;

        const { id } = await request.json();
        if (!id) {
            return NextResponse.json({ error: "id is required" }, { status: 400 });
        }

        await prisma.clickupUnmatchedUser.delete({ where: { id: Number(id) } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverError(error, "admin/clickup-unmatched DELETE");
    }
}
