import { serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveTeamCapsuleForSave } from "@/lib/capsule-matching";

export const dynamic = 'force-dynamic';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: idRaw } = await params;
        const id = parseInt(idRaw);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        const body = await request.json();
        const updateData: any = {};

        if (body.role) {
            const validRoles = ["admin", "manager", "lead", "sub_lead", "writer", "editor", "qa", "researcher", "gc", "vo_artist", "publisher", "production_manager", "hr_manager", "researcher_manager", "member"];
            if (!validRoles.includes(body.role)) {
                return NextResponse.json({ error: "Invalid role" }, { status: 400 });
            }
            updateData.role = body.role;
        }

        if (body.teamCapsule !== undefined) {
            const resolved = await resolveTeamCapsuleForSave(body.teamCapsule);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: 400 });
            }
            updateData.teamCapsule = resolved.value;
        }

        if (body.isActive !== undefined) {
            updateData.isActive = body.isActive;
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json({ success: true, user });
    } catch (error) {
        return serverError(error, "route");
    }
}
