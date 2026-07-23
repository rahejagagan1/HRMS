import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { listConfiguredChannels } from "@/lib/youtube/channels-config";

export const dynamic = "force-dynamic";

/**
 * HR-admin CRUD for per-channel view targets. Each channel can have:
 *   • quarter 0          → year-level target
 *   • quarter 1..4       → per-quarter target
 *
 * The dashboard (/api/me/view-targets) reads these and overlays them
 * on the live YoutubeDashboardQuarterMetrics totals. Listing from
 * YOUTUBE_CHANNELS env ensures HR sees every configured channel even
 * before they've set any target rows.
 */

export async function GET(req: NextRequest) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        if (!isHRAdmin(session!.user)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const url = new URL(req.url);
        const yearParam = url.searchParams.get("year");
        const parsedYear = yearParam ? Number(yearParam) : NaN;
        const year = Number.isFinite(parsedYear) && parsedYear > 0
            ? Math.trunc(parsedYear)
            : new Date().getUTCFullYear();

        const configured = listConfiguredChannels();
        // Soft-fail when the ChannelViewTarget table doesn't exist
        // yet (HR hasn't run the migration). Returning an empty rows
        // list lets HR still see the editor pre-filled with zeros so
        // they can type values; saves will only land after the
        // migration runs.
        let rows: Array<{ channelId: string; quarter: number; target: bigint }> = [];
        try {
            rows = await prisma.channelViewTarget.findMany({ where: { year } });
        } catch (e: any) {
            const code = e?.meta?.code || e?.code;
            const msg = String(e?.meta?.message || e?.message || "");
            if (code !== "42P01" && !/does not exist|42P01/i.test(msg)) throw e;
            // Table is missing — that's expected pre-migration. Continue with empty rows.
        }

        // Per (channelId, quarter) lookup — 0 = year-level, 1..4 = quarter.
        const byChannelQuarter = new Map<string, number>();
        for (const row of rows) {
            byChannelQuarter.set(`${row.channelId}:${row.quarter}`, Number(row.target));
        }

        // Build BOTH response shapes so the admin editor page and any
        // legacy consumer of the original {channels:...} contract both
        // work. The page reads `rows` + `row.targets[quarter]` (Map-by-
        // quarter); the original shape kept `yearTarget` + `quarterTargets[]`.
        const channels = configured.map((c) => ({
            channelId: c.channelId,
            channelName: c.name,
            year,
            yearTarget: byChannelQuarter.get(`${c.channelId}:0`) ?? 0,
            quarterTargets: [
                byChannelQuarter.get(`${c.channelId}:1`) ?? 0,
                byChannelQuarter.get(`${c.channelId}:2`) ?? 0,
                byChannelQuarter.get(`${c.channelId}:3`) ?? 0,
                byChannelQuarter.get(`${c.channelId}:4`) ?? 0,
            ],
        }));
        const pageRows = configured.map((c) => ({
            channelId: c.channelId,
            channelName: c.name,
            year,
            targets: {
                0: byChannelQuarter.get(`${c.channelId}:0`) ?? null,
                1: byChannelQuarter.get(`${c.channelId}:1`) ?? null,
                2: byChannelQuarter.get(`${c.channelId}:2`) ?? null,
                3: byChannelQuarter.get(`${c.channelId}:3`) ?? null,
                4: byChannelQuarter.get(`${c.channelId}:4`) ?? null,
            },
        }));

        return NextResponse.json({ year, channels, rows: pageRows });
    } catch (error) {
        return serverError(error, "GET /api/hr/admin/view-targets");
    }
}

export async function PUT(req: NextRequest) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        if (!isHRAdmin(session!.user)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await req.json();
        const channelId = typeof body?.channelId === "string" ? body.channelId.trim() : "";
        const channelName = typeof body?.channelName === "string" ? body.channelName : "";
        const year = Number(body?.year);
        const quarter = Number(body?.quarter);
        const target = Number(body?.target);

        if (!channelId) {
            return NextResponse.json({ error: "channelId is required" }, { status: 400 });
        }
        if (!Number.isInteger(year) || year <= 0) {
            return NextResponse.json({ error: "year must be a positive integer" }, { status: 400 });
        }
        if (!Number.isInteger(quarter) || quarter < 0 || quarter > 4) {
            return NextResponse.json({ error: "quarter must be 0..4" }, { status: 400 });
        }
        if (!Number.isFinite(target) || target < 0) {
            return NextResponse.json({ error: "target must be a non-negative number" }, { status: 400 });
        }

        const userId = await resolveUserId(session);
        const targetBig = BigInt(Math.trunc(target));

        await prisma.channelViewTarget.upsert({
            where: {
                channelId_year_quarter: { channelId, year, quarter },
            },
            create: {
                channelId,
                channelName,
                year,
                quarter,
                target: targetBig,
                updatedById: userId ?? null,
            },
            update: {
                channelName,
                target: targetBig,
                updatedById: userId ?? null,
            },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        return serverError(error, "PUT /api/hr/admin/view-targets");
    }
}
