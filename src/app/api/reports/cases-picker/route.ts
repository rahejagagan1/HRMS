// Cases-picker — feeds the cascading "list → cases" dropdown used by
// the Researchers Monthly Report Section B (RTC / FOIA rows).
//
// Query params:
//   ?folder=Ready%20To%20Cover%202026   (required, case-insensitive)
//   ?month=4&year=2026                  (optional — when both passed,
//                                        filters cases to those with
//                                        dateDone in that month)
//
// Response shape:
//   {
//     folder:  { id, name } | null,
//     lists:   [{ id, name, clickupListId, cases: [{ id, name, dateDone, status }] }],
//     hint?:   string   // when no folder matches — useful for debugging
//   }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const folderName = (req.nextUrl.searchParams.get("folder") || "").trim();
    if (!folderName) {
      return NextResponse.json({ error: "folder query param is required" }, { status: 400 });
    }
    const monthParam = req.nextUrl.searchParams.get("month");
    const yearParam  = req.nextUrl.searchParams.get("year");
    const month = monthParam !== null ? parseInt(monthParam) : NaN; // 0-indexed
    const year  = yearParam  !== null ? parseInt(yearParam)  : NaN;
    const filterByMonth = Number.isFinite(month) && Number.isFinite(year);

    // Capsule (folder) lookup — case-insensitive exact match first, then
    // a "contains" fallback so trailing-space / year-suffix variations
    // still resolve. We pick the most-recently-updated match when more
    // than one candidate exists.
    let capsule = await prisma.capsule.findFirst({
      where: { name: { equals: folderName, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (!capsule) {
      capsule = await prisma.capsule.findFirst({
        where: { name: { contains: folderName, mode: "insensitive" } },
        select: { id: true, name: true },
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!capsule) {
      return NextResponse.json({
        folder: null,
        lists:  [],
        hint:   `No capsule (folder) named "${folderName}" is synced yet. Run the ClickUp sync, or check the space includes this folder.`,
      });
    }

    const lists = await prisma.productionList.findMany({
      where: { capsuleId: capsule.id },
      select: { id: true, name: true, clickupListId: true },
      orderBy: { name: "asc" },
    });

    if (lists.length === 0) {
      return NextResponse.json({
        folder: capsule,
        lists:  [],
        hint:   `Capsule "${capsule.name}" has no production lists yet.`,
      });
    }

    // Date window for the optional month filter.
    let dateGte: Date | undefined;
    let dateLte: Date | undefined;
    if (filterByMonth) {
      dateGte = new Date(year, month,     1, 0,  0,  0,   0);
      dateLte = new Date(year, month + 1, 0, 23, 59, 59, 999);
    }

    const listIds = lists.map((l) => l.id);
    const cases = await prisma.case.findMany({
      where: {
        productionListId: { in: listIds },
        ...(filterByMonth ? { dateDone: { gte: dateGte, lte: dateLte } } : {}),
      },
      select: {
        id: true,
        name: true,
        status: true,
        dateDone: true,
        productionListId: true,
      },
      orderBy: { dateDone: "desc" },
    });

    // Group cases under their list.
    const byList = new Map<number, typeof cases>();
    for (const c of cases) {
      const arr = byList.get(c.productionListId!) ?? [];
      arr.push(c);
      byList.set(c.productionListId!, arr);
    }

    const payload = {
      folder: capsule,
      lists:  lists.map((l) => ({
        id:            l.id,
        name:          l.name,
        clickupListId: l.clickupListId,
        cases: (byList.get(l.id) ?? []).map((c) => ({
          id:       c.id,
          name:     c.name,
          status:   c.status,
          dateDone: c.dateDone,
        })),
      })),
    };
    return NextResponse.json(payload);
  } catch (error) {
    return serverError(error, "reports/cases-picker GET");
  }
}
