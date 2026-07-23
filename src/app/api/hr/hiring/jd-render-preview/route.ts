// Render an edited JD text to a PDF so HR can preview the final
// output BEFORE publishing a job in the wizard. The actual file is
// not persisted here — the wizard's submit flow handles that via
// /api/hr/hiring/jobs/[id]/jd. This endpoint just runs the same
// text→DOCX→PDF pipeline and streams the result back inline so
// HR can open it in a new tab.
//
// POST /api/hr/hiring/jd-render-preview
//   body: { title: string, text: string }
//   resp: application/pdf (inline)

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { renderJdPdfFromText } from "@/lib/jd-doc-from-text";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const MAX_TEXT = 100_000;

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body  = await req.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title.slice(0, 200) : "Job Description";
    const text  = typeof body?.text  === "string" ? body.text.slice(0, MAX_TEXT)  : "";
    if (!text.trim()) {
      return NextResponse.json({ error: "Empty body — type or paste the JD text first." }, { status: 400 });
    }
    const pdf = await renderJdPdfFromText({ title, text });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type":             "application/pdf",
        "Content-Disposition":      'inline; filename="jd-preview.pdf"',
        "Cache-Control":            "private, no-store",
        "X-Content-Type-Options":   "nosniff",
        "X-Frame-Options":          "SAMEORIGIN",
        "Content-Security-Policy":  "frame-ancestors 'self'",
      },
    });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/jd-render-preview");
  }
}
