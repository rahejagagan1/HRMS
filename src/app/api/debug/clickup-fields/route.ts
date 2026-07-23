import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { clickupApi, WORKSPACE_ID } from "@/lib/clickup/api-client";

export const dynamic = "force-dynamic";

// Debug endpoint: GET /api/debug/clickup-fields?listId=YOUR_LIST_ID
// Returns all custom fields with their real UUIDs from a real task
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const listId = searchParams.get("listId");
    const taskId = searchParams.get("taskId");

    try {
        if (taskId) {
            // Get a specific task's custom fields
            const task = await clickupApi<any>(`/task/${taskId}`);
            const fields = (task.custom_fields || []).map((f: any) => ({
                id: f.id,
                name: f.name,
                type: f.type,
                value: f.value,
                type_config: f.type_config,
            }));
            return NextResponse.json({ taskName: task.name, fields });
        }

        if (listId) {
            // Get first task from a list
            const response = await clickupApi<any>(
                `/list/${listId}/task?page=0&include_closed=true`
            );
            const tasks = response.tasks || [];
            if (tasks.length === 0) {
                return NextResponse.json({ error: "No tasks found in this list" });
            }
            const task = tasks[0];
            const fields = (task.custom_fields || []).map((f: any) => ({
                id: f.id,
                name: f.name,
                type: f.type,
                value: f.value,
                type_config: f.type_config,
            }));
            return NextResponse.json({
                taskId: task.id,
                taskName: task.name,
                fields,
            });
        }

        // Get all lists in workspace so user can pick one
        const spaces = await clickupApi<any>(
            `/team/${WORKSPACE_ID}/space?archived=false`
        );
        return NextResponse.json({
            message: "Pass ?listId=YOUR_LIST_ID or ?taskId=YOUR_TASK_ID to see custom fields",
            spaces: (spaces.spaces || []).map((s: any) => ({
                id: s.id,
                name: s.name,
            })),
        });
    } catch (error) {
        return serverError(error, "route");
    }
}
