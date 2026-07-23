// ClickUp cron job — list-picker config.
//
// GET  → returns every synced ProductionList (with its Capsule + Space
//        names) plus the current `selected_lists` SyncConfig value.
// PUT  → writes `selected_lists` to SyncConfig. Body: { listIds: string[] }.
//        An empty array means "sync ALL lists" — that's what the
//        sync-engine treats as the no-filter fallback
//        (src/lib/clickup/sync-engine.ts:368-374).

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverError } from "@/lib/api-auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SELECTED_LISTS_KEY = "selected_lists";

function canManage(session: any): boolean {
  const u = session?.user as any;
  return u?.orgLevel === "ceo" || u?.isDeveloper === true;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!canManage(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [rows, config] = await Promise.all([
      prisma.productionList.findMany({
        select: {
          clickupListId: true,
          name: true,
          capsule: {
            select: { name: true, space: { select: { name: true } } },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.syncConfig.findUnique({ where: { key: SELECTED_LISTS_KEY } }),
    ]);

    const selected: string[] = Array.isArray(config?.value)
      ? (config!.value as string[]).filter((x): x is string => typeof x === "string")
      : [];

    const lists = rows.map((r) => ({
      clickupListId: r.clickupListId,
      name:          r.name,
      capsuleName:   r.capsule?.name ?? null,
      spaceName:     r.capsule?.space?.name ?? null,
    }));

    return NextResponse.json({ lists, selectedListIds: selected });
  } catch (error) {
    return serverError(error, "admin/cron-jobs/clickup/lists GET");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!canManage(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({} as any));
    const raw = Array.isArray(body?.listIds) ? body.listIds : null;
    if (raw === null) {
      return NextResponse.json({ error: "Body must include listIds: string[]" }, { status: 400 });
    }

    // Whitelist against the synced lists — silently drop unknown IDs so a
    // stale UI can't write garbage. De-dupe while preserving order.
    const known = await prisma.productionList.findMany({ select: { clickupListId: true } });
    const knownSet = new Set(known.map((r) => r.clickupListId));
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const id of raw) {
      if (typeof id !== "string") continue;
      if (!knownSet.has(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      cleaned.push(id);
    }

    await prisma.syncConfig.upsert({
      where:  { key: SELECTED_LISTS_KEY },
      create: { key: SELECTED_LISTS_KEY, value: cleaned },
      update: { value: cleaned },
    });

    return NextResponse.json({ ok: true, selectedListIds: cleaned });
  } catch (error) {
    return serverError(error, "admin/cron-jobs/clickup/lists PUT");
  }
}
