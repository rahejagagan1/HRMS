import { NextRequest, NextResponse } from "next/server";
import { clickupApi, WORKSPACE_ID } from "@/lib/clickup/api-client";
import prisma from "@/lib/prisma";
import { serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Helper: load selected lists from DB (safe - won't crash if table missing)
async function loadSelectedLists(): Promise<string[]> {
    try {
        const config = await prisma.syncConfig.findUnique({ where: { key: "selected_lists" } });
        return (config?.value as string[]) || [];
    } catch {
        return [];
    }
}

// GET /api/admin/workspaces
// Without spaceId: returns all spaces (fast, 1 API call)
// With ?spaceId=xxx: returns folders + lists for that space
// With ?allDetails=true: returns all spaces with full details in one call (parallel)
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const spaceId = searchParams.get("spaceId");
    const allDetails = searchParams.get("allDetails") === "true";

    try {
        const selectedLists = await loadSelectedLists();

        if (spaceId) {
            // Lazy-load: fetch folders + lists for a specific space
            const foldersRes = await clickupApi<any>(`/space/${spaceId}/folder?archived=false`);
            const folders = [];

            for (const folder of foldersRes.folders || []) {
                const listsRes = await clickupApi<any>(`/folder/${folder.id}/list?archived=false`);
                folders.push({
                    id: folder.id,
                    name: folder.name,
                    lists: (listsRes.lists || []).map((l: any) => ({
                        id: l.id,
                        name: l.name,
                        taskCount: l.task_count || 0,
                        selected: selectedLists.includes(l.id),
                    })),
                });
            }

            // Folderless lists
            const folderlessRes = await clickupApi<any>(`/space/${spaceId}/list?archived=false`);
            const folderlessLists = (folderlessRes.lists || []).map((l: any) => ({
                id: l.id,
                name: l.name,
                taskCount: l.task_count || 0,
                selected: selectedLists.includes(l.id),
            }));

            return NextResponse.json({ folders, folderlessLists, selectedLists });
        }

        // Fast path: return all spaces
        const spacesRes = await clickupApi<any>(`/team/${WORKSPACE_ID}/space?archived=false`);
        const spaces = (spacesRes.spaces || []).map((s: any) => ({
            id: s.id,
            name: s.name,
        }));

        // If allDetails requested, fetch all space details in parallel
        if (allDetails) {
            const spacesWithDetails = await Promise.all(
                spaces.map(async (space: any) => {
                    try {
                        const [foldersRes, folderlessRes] = await Promise.all([
                            clickupApi<any>(`/space/${space.id}/folder?archived=false`),
                            clickupApi<any>(`/space/${space.id}/list?archived=false`),
                        ]);

                        // Fetch lists for each folder in parallel
                        const folders = await Promise.all(
                            (foldersRes.folders || []).map(async (folder: any) => {
                                const listsRes = await clickupApi<any>(`/folder/${folder.id}/list?archived=false`);
                                return {
                                    id: folder.id,
                                    name: folder.name,
                                    lists: (listsRes.lists || []).map((l: any) => ({
                                        id: l.id, name: l.name,
                                        taskCount: l.task_count || 0,
                                        selected: selectedLists.includes(l.id),
                                    })),
                                };
                            })
                        );

                        const folderlessLists = (folderlessRes.lists || []).map((l: any) => ({
                            id: l.id, name: l.name,
                            taskCount: l.task_count || 0,
                            selected: selectedLists.includes(l.id),
                        }));

                        return { ...space, detail: { folders, folderlessLists } };
                    } catch {
                        return space;
                    }
                })
            );
            return NextResponse.json({ spaces: spacesWithDetails, selectedLists });
        }

        return NextResponse.json({ spaces, selectedLists });
    } catch (error) {
        return serverError(error, "admin/workspaces GET");
    }
}

// POST /api/admin/workspaces — save selected lists to DB
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { selectedSpaces = [], selectedLists = [] } = body;

        await Promise.all([
            prisma.syncConfig.upsert({
                where: { key: "selected_spaces" },
                create: { key: "selected_spaces", value: selectedSpaces },
                update: { value: selectedSpaces },
            }),
            prisma.syncConfig.upsert({
                where: { key: "selected_lists" },
                create: { key: "selected_lists", value: selectedLists },
                update: { value: selectedLists },
            }),
        ]);

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverError(error, "admin/workspaces POST");
    }
}
