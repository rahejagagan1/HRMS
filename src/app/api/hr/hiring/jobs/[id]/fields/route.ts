// Per-job application-form field config.
//
//   GET   /api/hr/hiring/jobs/[id]/fields
//         → Merges code-side defaults (STANDARD_FIELDS x CHANNELS) with
//           the per-job overrides in JobOpeningFieldConfig. Returns
//           one row per (channel, fieldKey) so the client can render
//           the table directly.
//
//   PATCH /api/hr/hiring/jobs/[id]/fields
//         body: { channel, fieldKey, visibility, sortOrder? }
//         → UPSERT one row. Used when the user changes a single
//           field's visibility from the right-hand panel.
//
//   PUT   /api/hr/hiring/jobs/[id]/fields
//         body: { channel, order: string[] }  — fieldKey[] in new order
//         → Bulk reorder for a single channel.
//
// Soft-fails when the override table is missing — returns defaults
// only so the page renders cleanly pre-migration.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import {
  STANDARD_FIELDS, CHANNELS, defaultVisibility,
  type Channel, type Visibility,
} from "@/lib/hr/job-form-defaults";

export const dynamic = "force-dynamic";

const ALLOWED_VISIBILITY = new Set<Visibility>(["required", "optional", "hidden"]);
const CHANNEL_KEYS = new Set<string>(CHANNELS.map((c) => c.key));

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const jobId = parseInt(idParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    }
    const channelFilter = new URL(req.url).searchParams.get("channel");

    let overrides: any[] = [];
    try {
      overrides = await prisma.$queryRawUnsafe<any[]>(
        `SELECT channel, "fieldKey", visibility, "sortOrder"
           FROM "JobOpeningFieldConfig"
          WHERE "jobOpeningId" = $1`,
        jobId,
      );
    } catch (e: any) {
      const msg = String(e?.meta?.message || e?.message || "");
      if (!/does not exist|42P01/i.test(msg)) throw e;
    }

    // Index overrides by `${channel}:${fieldKey}` for O(1) lookup.
    const overrideMap = new Map<string, { visibility: Visibility; sortOrder: number }>();
    for (const o of overrides) {
      overrideMap.set(`${o.channel}:${o.fieldKey}`, {
        visibility: o.visibility as Visibility,
        sortOrder: Number(o.sortOrder),
      });
    }

    const wantedChannels: Channel[] =
      channelFilter && CHANNEL_KEYS.has(channelFilter)
        ? [channelFilter as Channel]
        : CHANNELS.map((c) => c.key);

    const rows: any[] = [];
    for (const channel of wantedChannels) {
      STANDARD_FIELDS.forEach((f, idx) => {
        const key = `${channel}:${f.key}`;
        const o = overrideMap.get(key);
        rows.push({
          channel,
          fieldKey:   f.key,
          label:      f.label,
          group:      f.group,
          visibility: o?.visibility ?? defaultVisibility(channel, f.key),
          sortOrder:  o?.sortOrder ?? (idx + 1) * 10,
          overridden: !!o,
        });
      });
    }
    // Sort within each channel by sortOrder.
    rows.sort((a, b) =>
      a.channel === b.channel
        ? a.sortOrder - b.sortOrder
        : wantedChannels.indexOf(a.channel) - wantedChannels.indexOf(b.channel),
    );

    return NextResponse.json({ fields: rows, channels: CHANNELS });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/jobs/[id]/fields");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const jobId = parseInt(idParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    }
    const body = await req.json();
    const channel = String(body?.channel ?? "");
    const fieldKey = String(body?.fieldKey ?? "");
    const visibility = String(body?.visibility ?? "") as Visibility;

    if (!CHANNEL_KEYS.has(channel)) return NextResponse.json({ error: "Bad channel" }, { status: 400 });
    if (!STANDARD_FIELDS.some((f) => f.key === fieldKey)) {
      return NextResponse.json({ error: "Bad fieldKey" }, { status: 400 });
    }
    if (!ALLOWED_VISIBILITY.has(visibility)) {
      return NextResponse.json({ error: "visibility must be required | optional | hidden" }, { status: 400 });
    }

    // Required fields by code (first_name, last_name, email on most
    // channels) — we still allow them to be set explicitly, but we
    // don't *force* anything here so the user keeps control. Hard
    // requirements are enforced at apply-time, not here.

    const sortOrder = Number.isInteger(body?.sortOrder)
      ? Number(body.sortOrder)
      : (STANDARD_FIELDS.findIndex((f) => f.key === fieldKey) + 1) * 10;

    // UPSERT — relies on the (jobOpeningId, channel, fieldKey) unique
    // index from the migration.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "JobOpeningFieldConfig"
        ("jobOpeningId", "channel", "fieldKey", "visibility", "sortOrder")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("jobOpeningId", "channel", "fieldKey") DO UPDATE
         SET "visibility" = EXCLUDED."visibility",
             "sortOrder"  = EXCLUDED."sortOrder",
             "updatedAt"  = NOW()`,
      jobId, channel, fieldKey, visibility, sortOrder,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/hiring/jobs/[id]/fields");
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const jobId = parseInt(idParam, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    }
    const body = await req.json();
    const channel = String(body?.channel ?? "");
    if (!CHANNEL_KEYS.has(channel)) {
      return NextResponse.json({ error: "Bad channel" }, { status: 400 });
    }
    if (!Array.isArray(body?.order)) {
      return NextResponse.json({ error: "order array required" }, { status: 400 });
    }
    const order: string[] = body.order
      .map((x: any) => String(x))
      .filter((k: string) => STANDARD_FIELDS.some((f) => f.key === k));

    // Upsert sortOrder for each field, preserving its current
    // visibility (or applying the default if no row exists yet).
    await prisma.$transaction(async (tx) => {
      let sort = 10;
      for (const key of order) {
        const vis = defaultVisibility(channel as Channel, key);
        await tx.$executeRawUnsafe(
          `INSERT INTO "JobOpeningFieldConfig"
            ("jobOpeningId", "channel", "fieldKey", "visibility", "sortOrder")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("jobOpeningId", "channel", "fieldKey") DO UPDATE
             SET "sortOrder" = EXCLUDED."sortOrder",
                 "updatedAt" = NOW()`,
          jobId, channel, key, vis, sort,
        );
        sort += 10;
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PUT /api/hr/hiring/jobs/[id]/fields");
  }
}
