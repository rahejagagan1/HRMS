// HR Hiring — Email template CRUD.
//
// GET   /api/hr/hiring/email-templates       → list all
// POST  /api/hr/hiring/email-templates       → create
// PATCH /api/hr/hiring/email-templates/[id]  → update (other file)
//
// Templates support merge tags rendered server-side at send time:
//   {{candidate_name}}, {{job_title}}, {{company}}, {{interviewer_names}},
//   {{interview_date}}, {{interview_time}}, {{interview_location}},
//   {{ctc}}, {{joining_date}}

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    let rows: any[] = [];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT t.*, s."key" AS "stageKey", s."label" AS "stageLabel"
           FROM "EmailTemplate" t
           LEFT JOIN "HiringStage" s ON s."id" = t."stageId"
          ORDER BY t."trigger" ASC, t."name" ASC`,
      );
    } catch (e: any) {
      // Pre-migration — table doesn't exist yet. Return empty so the
      // Settings tab renders an empty state instead of a 500.
      const code = e?.meta?.code || e?.code;
      const msg = String(e?.meta?.message || e?.message || "");
      if (code !== "42P01" && !/does not exist/i.test(msg)) throw e;
    }
    return NextResponse.json({ templates: rows });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/email-templates");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json();
    const key = String(body?.key ?? "").trim();
    const name = String(body?.name ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    const bodyHtml = String(body?.bodyHtml ?? "").trim();
    if (!key || !name || !subject || !bodyHtml) {
      return NextResponse.json({ error: "key, name, subject, bodyHtml all required" }, { status: 400 });
    }
    const created = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "EmailTemplate" ("key","name","trigger","stageId","subject","bodyHtml","isActive","autoSend")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING "id"`,
      key, name,
      body?.trigger || "manual",
      body?.stageId || null,
      subject, bodyHtml,
      body?.isActive !== false,
      body?.autoSend === true,
    );
    return NextResponse.json({ id: created[0]?.id }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/email-templates");
  }
}
