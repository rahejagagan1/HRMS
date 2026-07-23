import prisma from "@/lib/prisma";
import { clickupApi, WORKSPACE_ID, TARGET_SPACE_IDS } from "./api-client";
import { parseCustomFields } from "./field-parser";
import { USER_FIELDS, CUSTOM_FIELD_MAP } from "./field-mapping";
import { delay, deriveShortName, calcBusinessDaysTat } from "@/lib/utils";

// ═══ STEP 1: Sync Workspace Members ═══
// HR is the identity source. This sync:
//   1. For each ClickUp workspace member, finds the HR User by email (case-insensitive).
//      If found, backfills clickupUserId (if null) and refreshes name/picture. Does NOT create new Users.
//   2. Records ClickUp users without a matching HR User in ClickupUnmatchedUser so HR admins can review.
//   3. Clears clickupUserId on HR users who are no longer in ClickUp (keeps the User for history).
export async function syncUsers(): Promise<number> {
    const response = await clickupApi<any>(`/team/${WORKSPACE_ID}`);
    const members = response.team?.members || [];
    let matched = 0;
    let unmatched = 0;

    const seenClickupIds: bigint[] = [];
    const seenUnmatchedClickupIds: bigint[] = [];

    for (const member of members) {
        const user = member.user;
        if (!user?.id || !user?.email) continue;

        const clickupId = BigInt(user.id);
        const email = String(user.email).trim().toLowerCase();
        const name = user.username || email.split("@")[0];
        const picture = user.profilePicture || null;

        seenClickupIds.push(clickupId);

        // Match by email (case-insensitive). Prisma's String @unique is case-sensitive,
        // so we query with lowercase — HR registration should also lowercase-normalize.
        const hrUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true, clickupUserId: true },
        });

        if (hrUser) {
            // Matched: backfill clickupUserId if missing or different, refresh display fields.
            // Guard against collisions: another HR user may already own this clickupUserId.
            if (hrUser.clickupUserId == null || hrUser.clickupUserId !== clickupId) {
                const collision = await prisma.user.findUnique({
                    where: { clickupUserId: clickupId },
                    select: { id: true, email: true },
                });
                if (collision && collision.id !== hrUser.id) {
                    console.warn(
                        `[Sync] clickupUserId ${clickupId} already linked to HR user "${collision.email}" — not re-linking to "${email}"`
                    );
                    continue;
                }
            }

            // Profile picture priority: Gmail (set on Google sign-in) > ClickUp.
            // Only write the ClickUp picture when (a) ClickUp actually has one and
            // (b) the HR user has no picture yet — never clobber an existing Gmail
            // avatar with ClickUp's null. Refetch the row so we know the current
            // value (we only selected `clickupUserId` above for the collision check).
            const updateData: { clickupUserId: bigint; name: string; profilePictureUrl?: string } = {
                clickupUserId: clickupId,
                name,
            };
            if (picture) {
                const cur = await prisma.user.findUnique({
                    where: { id: hrUser.id },
                    select: { profilePictureUrl: true },
                });
                if (!cur?.profilePictureUrl) updateData.profilePictureUrl = picture;
            }
            await prisma.user.update({
                where: { id: hrUser.id },
                data: updateData,
            });
            matched++;
        } else {
            // Not in HR. Record so admins can onboard them.
            seenUnmatchedClickupIds.push(clickupId);
            await prisma.clickupUnmatchedUser.upsert({
                where: { clickupUserId: clickupId },
                create: {
                    clickupUserId: clickupId,
                    email,
                    name,
                    profilePictureUrl: picture,
                },
                update: {
                    email,
                    name,
                    profilePictureUrl: picture,
                },
            });
            unmatched++;
        }
    }

    // Users previously linked to ClickUp but no longer present → clear clickupUserId.
    // Keep the HR User row and historical records intact.
    if (seenClickupIds.length > 0) {
        const cleared = await prisma.user.updateMany({
            where: {
                clickupUserId: { notIn: seenClickupIds, not: null },
            },
            data: { clickupUserId: null },
        });
        if (cleared.count > 0) {
            console.log(`[Sync] Cleared clickupUserId on ${cleared.count} HR users no longer in ClickUp`);
        }
    }

    // Drop stale unmatched entries — they either got onboarded or were removed from ClickUp.
    await prisma.clickupUnmatchedUser.deleteMany({
        where: { clickupUserId: { notIn: seenUnmatchedClickupIds } },
    });

    console.log(`[Sync] Users: ${matched} matched/backfilled, ${unmatched} unmatched (awaiting HR onboarding)`);
    return matched;
}

// ═══ STEP 2: Sync Spaces ═══
export async function syncSpaces(): Promise<number> {
    const response = await clickupApi<any>(
        `/team/${WORKSPACE_ID}/space?archived=false`
    );
    let count = 0;

    // Always include TARGET_SPACE_IDS; admin config can add more but never removes the baseline.
    const config = await prisma.syncConfig.findUnique({ where: { key: "selected_spaces" } });
    const configIds: string[] = Array.isArray(config?.value) ? (config!.value as string[]) : [];

    // Also auto-include any space that contains a list in `selected_lists`.
    // Without this, picking a list in the admin UI silently no-ops because
    // the list's parent space wasn't enabled. We walk each selected list
    // via /list/{id} (it returns the parent space + folder), collect the
    // distinct space IDs, and union them into the filter set for this run.
    // Best-effort: any list that errors (deleted / permissions) is skipped.
    const listsCfg = await prisma.syncConfig.findUnique({ where: { key: "selected_lists" } });
    const selectedListIds: string[] = Array.isArray(listsCfg?.value)
        ? (listsCfg!.value as string[])
        : [];
    const derivedSpaceIds = new Set<string>();
    for (const listId of selectedListIds) {
        await delay(150);
        try {
            const list = await clickupApi<any>(`/list/${listId}`);
            const sid = list?.space?.id;
            if (typeof sid === "string" && sid) derivedSpaceIds.add(sid);
        } catch (e) {
            console.warn(`[Sync] could not resolve parent space for list ${listId}:`, (e as Error).message);
        }
    }

    const filterIds = [...new Set([...TARGET_SPACE_IDS, ...configIds, ...derivedSpaceIds])];

    for (const space of response.spaces || []) {
        if (filterIds.includes(space.id)) {
            await prisma.space.upsert({
                where: { clickupSpaceId: space.id },
                create: { clickupSpaceId: space.id, name: space.name, isSynced: true },
                update: { name: space.name, isSynced: true },
            });
            count++;
        }
    }

    return count;
}

// ═══ STEP 3: Sync Folders → Capsules ═══
export async function syncCapsules(): Promise<number> {
    const spaces = await prisma.space.findMany({ where: { isSynced: true } });
    let count = 0;

    for (const space of spaces) {
        await delay(650);
        try {
            const response = await clickupApi<any>(
                `/space/${space.clickupSpaceId}/folder?archived=false`
            );

            for (const folder of response.folders || []) {
                const prev = await prisma.capsule.findUnique({
                    where: { clickupFolderId: folder.id },
                    select: { name: true },
                });
                await prisma.capsule.upsert({
                    where: { clickupFolderId: folder.id },
                    create: {
                        clickupFolderId: folder.id,
                        spaceId: space.id,
                        name: folder.name,
                        shortName: deriveShortName(folder.name),
                    },
                    update: { name: folder.name, shortName: deriveShortName(folder.name) },
                });
                if (prev) await cascadeTeamCapsuleRename(prev.name, folder.name);
                count++;
            }
        } catch (error) {
            console.error(
                `Error syncing capsules for space ${space.clickupSpaceId}:`,
                error
            );
        }
    }

    return count;
}

// Cascade a capsule / production-list rename to the denormalized
// User.teamCapsule strings. teamCapsule stores the label BY NAME (not an
// id), and teamCapsuleToSelectionKey matches it by exact name — so a ClickUp
// rename would otherwise leave every already-assigned user pointing at the
// old label: their org-tree dropdown reads "— Not set —" and displays show
// the stale name. Called right after each name change is persisted.
async function cascadeTeamCapsuleRename(oldName: string, newName: string): Promise<void> {
    if (!oldName || oldName === newName) return;
    await prisma.user.updateMany({
        where: { teamCapsule: oldName },
        data: { teamCapsule: newName },
    });
}

// ═══ STEP 4: Sync Lists ═══
export async function syncLists(): Promise<number> {
    let count = 0;

    // Lists inside folders (capsules)
    const capsules = await prisma.capsule.findMany();
    for (const capsule of capsules) {
        await delay(650);
        try {
            const response = await clickupApi<any>(
                `/folder/${capsule.clickupFolderId}/list?archived=false`
            );

            for (const list of response.lists || []) {
                const prev = await prisma.productionList.findUnique({
                    where: { clickupListId: list.id },
                    select: { name: true },
                });
                await prisma.productionList.upsert({
                    where: { clickupListId: list.id },
                    create: {
                        clickupListId: list.id,
                        capsuleId: capsule.id,
                        name: list.name,
                    },
                    update: { name: list.name },
                });
                if (prev) await cascadeTeamCapsuleRename(prev.name, list.name);
                count++;
            }
        } catch (error) {
            console.error(
                `Error syncing lists for capsule ${capsule.clickupFolderId}:`,
                error
            );
        }
    }

    // Folderless lists (directly under space)
    const spaces = await prisma.space.findMany({ where: { isSynced: true } });
    for (const space of spaces) {
        await delay(650);
        try {
            const response = await clickupApi<any>(
                `/space/${space.clickupSpaceId}/list?archived=false`
            );

            for (const list of response.lists || []) {
                const existing = await prisma.productionList.findUnique({
                    where: { clickupListId: list.id },
                    select: { id: true, name: true },
                });
                if (existing) {
                    // Keep the name in sync when the list is renamed in
                    // ClickUp (previously folderless lists were create-only,
                    // so renames never propagated and dropdowns showed the
                    // stale label). Also cascade the rename to any users whose
                    // denormalized teamCapsule still holds the old name.
                    if (existing.name !== list.name) {
                        await prisma.productionList.update({
                            where: { clickupListId: list.id },
                            data: { name: list.name },
                        });
                        await cascadeTeamCapsuleRename(existing.name, list.name);
                    }
                } else {
                    await prisma.productionList.create({
                        data: {
                            clickupListId: list.id,
                            spaceId: space.id,
                            name: list.name,
                        },
                    });
                    count++;
                }
            }
        } catch (error) {
            console.error(
                `Error syncing folderless lists for space ${space.clickupSpaceId}:`,
                error
            );
        }
    }

    return count;
}

// ═══ Helper: resolve ClickUp user ID to our DB user ID ═══
async function resolveUserId(
    clickupId: number | null | undefined
): Promise<number | null> {
    if (!clickupId) return null;
    try {
        const user = await prisma.user.findUnique({
            where: { clickupUserId: BigInt(clickupId) },
            select: { id: true },
        });
        return user?.id || null;
    } catch {
        return null;
    }
}

// Upsert a single ClickUp subtask into our DB. Shared between the list-flat
// pass and the per-task include_subtasks pass.
//
// Correctness rule: we NEVER fabricate a dateDone. ClickUp's parent-task
// payload frequently omits `date_done` from embedded subtask summaries, and the
// old code fell back to `date_updated` — which is the "last touched" timestamp
// and is completely wrong (e.g. bumps every time anyone adds a comment). So:
//   1. If the provided subtask already has a real `date_done`, use it.
//   2. Else if the subtask is closed but `date_done` is missing, refetch the
//      full subtask via GET /task/{id}. That call returns the authoritative
//      `date_done`.
//   3. If even the standalone fetch has no `date_done`, we store null — we
//      would rather have a missing date than a wrong one.
async function upsertSubtaskFromClickup(subtask: any, caseId: number): Promise<void> {
    // Decide whether the payload's dateDone is trustworthy, or whether we must
    // refetch the subtask individually. Parent-task payloads frequently omit
    // `date_done` for closed subtasks, so we refetch in that case.
    let authoritative = subtask;
    let dateDoneIsTrusted = !!subtask.date_done || subtask.status?.type !== "closed";

    if (!dateDoneIsTrusted) {
        try {
            authoritative = await clickupApi<any>(`/task/${subtask.id}`);
            dateDoneIsTrusted = true; // standalone /task/{id} returns the real date_done (or null)
        } catch (err) {
            // Refetch failed (network, server error after all retries). Update
            // everything else from the parent payload, but do NOT touch
            // dateDone/tat in DB — leaving existing values is the safe default.
            console.warn(
                `[Sync] could not refetch subtask ${subtask.id} — leaving dateDone untouched:`,
                (err as Error).message
            );
        }
    }

    const subtaskAssigneeId = await resolveUserId(authoritative.assignees?.[0]?.id);
    const stStartDate = authoritative.start_date
        ? new Date(parseInt(authoritative.start_date))
        : null;
    const stDateDone = authoritative.date_done
        ? new Date(parseInt(authoritative.date_done))
        : null;
    const stTat = stStartDate && stDateDone
        ? calcBusinessDaysTat(stStartDate, stDateDone)
        : null;

    // Fields we always update from ClickUp.
    const baseUpdate: any = {
        name: authoritative.name,
        status: authoritative.status?.status || "unknown",
        statusType: authoritative.status?.type || null,
        assigneeUserId: subtaskAssigneeId,
        startDate: stStartDate,
        dueDate: authoritative.due_date ? new Date(parseInt(authoritative.due_date)) : null,
        lastSyncedAt: new Date(),
    };

    // Only touch dateDone/tat when we have authoritative data. Otherwise leave
    // the existing DB values alone — never overwrite with guesses.
    const update: any = dateDoneIsTrusted
        ? { ...baseUpdate, dateDone: stDateDone, tat: stTat }
        : baseUpdate;

    // CREATE uses null when we're not trusted (better than a wrong value).
    const create: any = {
        clickupTaskId: authoritative.id,
        caseId,
        ...baseUpdate,
        dateDone: dateDoneIsTrusted ? stDateDone : null,
        tat: dateDoneIsTrusted ? stTat : null,
        orderIndex: authoritative.orderindex ? parseInt(authoritative.orderindex) : null,
        dateCreated: authoritative.date_created ? new Date(parseInt(authoritative.date_created)) : null,
    };

    const savedSubtask = await prisma.subtask.upsert({
        where: { clickupTaskId: authoritative.id },
        create,
        update,
    });

    // Sync ALL subtask assignees into SubtaskAssignee join table
    const subtaskAssignees: any[] = Array.isArray(authoritative.assignees) ? authoritative.assignees : [];
    if (subtaskAssignees.length > 0) {
        await prisma.subtaskAssignee.deleteMany({ where: { subtaskId: savedSubtask.id } });
        // Resolve clickup assignees → db users, deduped by userId (two clickup
        // accounts can map to one db user). createMany + skipDuplicates is
        // race-proof, so two overlapping syncs no longer throw P2002 on the
        // (subtaskId, userId) unique constraint — they just skip the dupe.
        const byUserId = new Map<number, bigint>();
        for (const assignee of subtaskAssignees) {
            const resolvedId = await resolveUserId(assignee.id);
            if (resolvedId && !byUserId.has(resolvedId)) {
                byUserId.set(resolvedId, BigInt(assignee.id));
            }
        }
        if (byUserId.size > 0) {
            await prisma.subtaskAssignee.createMany({
                data: [...byUserId].map(([userId, clickupUserId]) => ({
                    subtaskId: savedSubtask.id,
                    userId,
                    clickupUserId,
                })),
                skipDuplicates: true,
            });
        }
    }
}

// ═══ STEP 5: Sync Tasks + Subtasks ═══
export async function syncTasks(): Promise<number> {
    // Read admin-selected lists from DB (fallback to all lists if none configured)
    const config = await prisma.syncConfig.findUnique({ where: { key: "selected_lists" } });
    const selectedListIds: string[] = (config?.value as string[]) || [];

    const allLists = await prisma.productionList.findMany();
    const lists = selectedListIds.length > 0
        ? allLists.filter(l => selectedListIds.includes(l.clickupListId))
        : allLists;

    // Clear every case's deep-subtask flag at the start of a sync so that cases
    // fixed in ClickUp since the last sync stop being highlighted. The sync
    // re-flags any case that still has a level-3+ descendant.
    await prisma.case.updateMany({ data: { hasDeepSubtasks: false } });

    let count = 0;

    for (const list of lists) {
        let page = 0;
        let hasMore = true;

        while (hasMore) {
            await delay(650);
            try {
                const response = await clickupApi<any>(
                    `/list/${list.clickupListId}/task?subtasks=true&include_closed=true&page=${page}`
                );

                const tasks = response.tasks || [];
                if (tasks.length === 0) {
                    hasMore = false;
                    break;
                }

                // Separate parent tasks and subtasks from the flat response
                const parentTasks = tasks.filter((t: any) => !t.parent);
                const subtaskEntries = tasks.filter((t: any) => t.parent);

                // First pass: process parent tasks as cases
                for (const task of parentTasks) {
                    try {
                        // Parse custom fields
                        const customData = parseCustomFields(task.custom_fields || []);

                        // Extract YouTube video URL by field name (custom field: "X.❤️ Youtube video link :-")
                        const ytField = (task.custom_fields || []).find((f: any) =>
                            f.name && f.name.toLowerCase().includes("youtube video link")
                        );
                        const youtubeVideoUrl = ytField?.value ? String(ytField.value) : null;

                        // Resolve ClickUp user IDs to our User IDs
                        const assigneeId = await resolveUserId(task.assignees?.[0]?.id);
                        const researcherId = await resolveUserId(customData.researcherUserId);
                        const writerId = await resolveUserId(customData.writerUserId);
                        const editorId = await resolveUserId(customData.editorUserId);

                        // Collect ALL editors and writers from custom fields (multi-user)
                        const EDITOR_FIELD_ID = "7564d086-10d1-4db5-9190-6c9d34a79c1f";
                        const WRITER_FIELD_ID = "e39e94a8-5144-4759-a007-91b1a2c78ea8";
                        const editorClickupIds: number[] = (task.custom_fields?.find((f: any) => f.id === EDITOR_FIELD_ID)?.value || []).map((u: any) => u.id).filter(Boolean);
                        const writerClickupIds: number[] = (task.custom_fields?.find((f: any) => f.id === WRITER_FIELD_ID)?.value || []).map((u: any) => u.id).filter(Boolean);

                        // Remove user fields from customData (they need FK resolution)
                        const cleanCustomData = { ...customData };
                        for (const field of USER_FIELDS) {
                            delete cleanCustomData[field];
                        }

                        // Upsert main case
                        const savedCase = await prisma.case.upsert({
                            where: { clickupTaskId: task.id },
                            create: {
                                clickupTaskId: task.id,
                                productionListId: list.id,
                                name: task.name,
                                status: task.status?.status || "unknown",
                                statusType: task.status?.type || null,
                                clickupUrl: task.url || null,
                                assigneeUserId: assigneeId,
                                researcherUserId: researcherId,
                                writerUserId: writerId,
                                editorUserId: editorId,
                                dateCreated: task.date_created
                                    ? new Date(parseInt(task.date_created))
                                    : null,
                                dateDone: task.date_done
                                    ? new Date(parseInt(task.date_done))
                                    : null,
                                lastSyncedAt: new Date(),
                                youtubeVideoUrl,
                                ...cleanCustomData,
                            },
                            update: {
                                name: task.name,
                                status: task.status?.status || "unknown",
                                statusType: task.status?.type || null,
                                clickupUrl: task.url || null,
                                assigneeUserId: assigneeId,
                                researcherUserId: researcherId,
                                writerUserId: writerId,
                                editorUserId: editorId,
                                dateDone: task.date_done
                                    ? new Date(parseInt(task.date_done))
                                    : null,
                                lastSyncedAt: new Date(),
                                youtubeVideoUrl,
                                ...cleanCustomData,
                            },
                        });

                        count++;

                        // Sync all editors into CaseEditorEntry
                        await prisma.$executeRawUnsafe(`DELETE FROM "CaseEditorEntry" WHERE "caseId" = $1`, savedCase.id);
                        for (const clickupId of editorClickupIds) {
                            const resolvedId = await resolveUserId(clickupId);
                            if (resolvedId) {
                                await prisma.$executeRawUnsafe(
                                    `INSERT INTO "CaseEditorEntry" ("caseId","userId","clickupUserId") VALUES ($1,$2,$3) ON CONFLICT ("caseId","userId") DO NOTHING`,
                                    savedCase.id, resolvedId, BigInt(clickupId)
                                );
                            }
                        }

                        // Sync all writers into CaseWriterEntry
                        await prisma.$executeRawUnsafe(`DELETE FROM "CaseWriterEntry" WHERE "caseId" = $1`, savedCase.id);
                        for (const clickupId of writerClickupIds) {
                            const resolvedId = await resolveUserId(clickupId);
                            if (resolvedId) {
                                await prisma.$executeRawUnsafe(
                                    `INSERT INTO "CaseWriterEntry" ("caseId","userId","clickupUserId") VALUES ($1,$2,$3) ON CONFLICT ("caseId","userId") DO NOTHING`,
                                    savedCase.id, resolvedId, BigInt(clickupId)
                                );
                            }
                        }

                        // Sync ALL assignees into CaseAssignee:
                        // – task.assignees (the ClickUp Assignees field)
                        // – every user in user-type custom fields (editor, writer, researcher)
                        {
                            const seenClickupIds = new Set<number>();
                            const toAdd: Array<{ clickupId: number }> = [];

                            for (const a of (task.assignees || [])) {
                                if (a?.id && !seenClickupIds.has(a.id)) {
                                    seenClickupIds.add(a.id);
                                    toAdd.push({ clickupId: a.id });
                                }
                            }
                            for (const field of (task.custom_fields || [])) {
                                const mapping = CUSTOM_FIELD_MAP[field.id];
                                if (!mapping || mapping.parseAs !== "user_id") continue;
                                if (!Array.isArray(field.value)) continue;
                                for (const u of field.value) {
                                    if (u?.id && !seenClickupIds.has(u.id)) {
                                        seenClickupIds.add(u.id);
                                        toAdd.push({ clickupId: u.id });
                                    }
                                }
                            }

                            if (toAdd.length > 0) {
                                await prisma.caseAssignee.deleteMany({ where: { caseId: savedCase.id } });
                                for (const { clickupId } of toAdd) {
                                    const resolvedId = await resolveUserId(clickupId);
                                    if (resolvedId) {
                                        await prisma.caseAssignee.upsert({
                                            where: { caseId_userId: { caseId: savedCase.id, userId: resolvedId } },
                                            create: { caseId: savedCase.id, userId: resolvedId, clickupUserId: BigInt(clickupId) },
                                            update: {},
                                        });
                                    }
                                }
                            }
                        }
                    } catch (taskError) {
                        console.error(`Error syncing task ${task.id}:`, taskError);
                    }
                }

                // Second pass (A): process subtasks that were returned inline with the list
                // (works only for subtasks that live in the same list).
                for (const subtask of subtaskEntries) {
                    try {
                        const parentCase = await prisma.case.findUnique({
                            where: { clickupTaskId: subtask.parent },
                            select: { id: true },
                        });
                        if (!parentCase) {
                            // Parent isn't a case, so this is a level-3+ sub-subtask
                            // (ClickUp allows nesting; our schema only models 2 levels).
                            // Walk up to the top-level case and mark it so the UI can
                            // surface it for manual cleanup in ClickUp.
                            let topCase: { id: number } | null = null;
                            if (subtask.top_level_parent) {
                                topCase = await prisma.case.findUnique({
                                    where: { clickupTaskId: subtask.top_level_parent },
                                    select: { id: true },
                                });
                            }
                            if (!topCase && subtask.parent) {
                                const parentSubtask = await prisma.subtask.findUnique({
                                    where: { clickupTaskId: subtask.parent },
                                    select: { caseId: true },
                                });
                                if (parentSubtask) topCase = { id: parentSubtask.caseId };
                            }
                            if (topCase) {
                                await prisma.case.update({
                                    where: { id: topCase.id },
                                    data: { hasDeepSubtasks: true },
                                });
                                console.warn(`[Sync] Subtask ${subtask.id} is a level-3+ descendant of case ${topCase.id} — case flagged for review`);
                            } else {
                                console.warn(`Subtask ${subtask.id} has parent ${subtask.parent} which is not a synced case, skipping`);
                            }
                            continue;
                        }
                        await upsertSubtaskFromClickup(subtask, parentCase.id);
                    } catch (subtaskError) {
                        console.error(`Error syncing subtask ${subtask.id}:`, subtaskError);
                    }
                }

                // Second pass (B): explicitly fetch each parent task with include_subtasks=true.
                // ClickUp's list endpoint only returns subtasks that live IN the list;
                // this per-task call returns ALL subtasks (including those outside the list).
                for (const task of parentTasks) {
                    try {
                        await delay(200);
                        const detail = await clickupApi<any>(
                            `/task/${task.id}?include_subtasks=true`
                        );
                        const childSubtasks: any[] = detail?.subtasks || [];
                        if (childSubtasks.length === 0) continue;

                        const parentCase = await prisma.case.findUnique({
                            where: { clickupTaskId: task.id },
                            select: { id: true },
                        });
                        if (!parentCase) continue;

                        for (const subtask of childSubtasks) {
                            try {
                                await upsertSubtaskFromClickup(subtask, parentCase.id);
                            } catch (subtaskError) {
                                console.error(`Error syncing child subtask ${subtask.id}:`, subtaskError);
                            }
                        }
                    } catch (detailError) {
                        console.error(`Error fetching subtasks for task ${task.id}:`, detailError);
                    }
                }

                page++;
                if (tasks.length < 100) hasMore = false;
            } catch (error) {
                console.error(
                    `Error fetching tasks for list ${list.clickupListId} page ${page}:`,
                    error
                );
                hasMore = false;
            }
        }
    }

    return count;
}

// ═══ Full Sync Orchestrator ═══
export async function runFullSync(): Promise<{
    spaces: number;
    capsules: number;
    lists: number;
    tasks: number;
}> {
    console.log("[Sync] Starting full ClickUp sync...");

    const spaces = await syncSpaces();
    console.log(`[Sync] Spaces synced: ${spaces}`);

    const capsules = await syncCapsules();
    console.log(`[Sync] Capsules synced: ${capsules}`);

    const lists = await syncLists();
    console.log(`[Sync] Lists synced: ${lists}`);

    const tasks = await syncTasks();
    console.log(`[Sync] Tasks synced: ${tasks}`);

    console.log("[Sync] Full sync complete!");

    return { spaces, capsules, lists, tasks };
}
