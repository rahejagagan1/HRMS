// HR-admin: parked new-joiner documents.
//
//   GET    → opportunistic sweep (attach any whose person now exists) +
//            list the still-pending ones.
//   DELETE ?id=  → cancel a parked doc HR made by mistake.
//
// Anonymity/PII note: the parked PDFs are letters HR generated, so no
// special gating beyond the same leadership/HR access the generator uses.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import {
  listPendingDocuments,
  cancelPendingDocument,
  attachDuePendingDocuments,
} from "@/lib/hr/pending-documents";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Catch up: attach any parked docs whose person now exists (covers
    // joiners created via ClickUp sync or any path we don't hook).
    const justAttached = await attachDuePendingDocuments();
    const pending = await listPendingDocuments();
    return NextResponse.json({ pending, justAttached });
  } catch (e) {
    return serverError(e, "GET /api/hr/pending-documents");
  }
}

export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const ok = await cancelPendingDocument(id);
    return NextResponse.json({ ok });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/pending-documents");
  }
}
