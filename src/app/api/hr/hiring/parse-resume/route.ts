// HR-side resume parser — POST /api/hr/hiring/parse-resume
//
// Same multipart shape as the candidate-facing /api/jobs/parse-resume
// but goes through the FULL extraction pipeline:
//
//   1. pdfjs text extraction (heuristic)
//   2. Tesseract OCR fallback for scanned PDFs
//   3. Ollama / Llama 3.2 3B LLM fallback (resume-llm-extract.ts)
//
// The candidate-facing parser is heuristic-only (kept lean because
// public traffic + no auth means we can't reliably hit the LLM).
// HR-admin requests can absorb the few extra seconds of OCR + LLM
// to get a much better hit rate on multi-column / sidebar resumes
// that the heuristic alone misses.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_EXTS = new Set([".pdf", ".doc", ".docx"]);

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const file = form.get("resume");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Resume must be 8 MB or smaller" }, { status: 400 });
    }
    const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({
        parsed: {},
        warning: `We couldn't auto-fill from a "${ext || "unknown"}" file — please fill in the form manually.`,
      });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // Full pipeline: extractResumeData handles heuristic + OCR +
    // LLM internally. Skills / education / urls all populated.
    let extracted: any = {};
    try {
      const { extractResumeData, extractText } = await import("@/lib/resume-auto-extract");
      // First grab raw text so we can sniff name / email / phone
      // even when extractResumeData's higher-level pipeline misses
      // them (it doesn't return those fields, only urls + skills +
      // education + languages).
      const text = await extractText(buf, file.name);
      const sniff = sniffNameEmailPhone(text);
      // Then run the full extractor for the structured fields.
      const data = await extractResumeData(buf, file.name);
      extracted = {
        fullName:    sniff.fullName,
        email:       sniff.email,
        phone:       sniff.phone,
        linkedinUrl: data.linkedinUrl,
        portfolioUrl: data.portfolioUrl,
        // Stringified so the client can store them as-is on
        // JobApplication.educationDetails / skills (text columns
        // holding JSON, matches the apply-form storage shape).
        educations:  data.educations,
        skills:      data.skills,
        languages:   data.languages,
      };
    } catch (e: any) {
      console.error("[hr/hiring/parse-resume] extract failed:", e?.message ?? e);
    }

    const hasAnything = !!(
      extracted.fullName || extracted.email || extracted.phone ||
      (Array.isArray(extracted.educations) && extracted.educations.length) ||
      (Array.isArray(extracted.skills) && extracted.skills.length)
    );
    if (!hasAnything) {
      return NextResponse.json({
        parsed: {},
        warning: "We couldn't read this resume even after OCR + LLM — please fill in the override fields manually.",
      });
    }
    return NextResponse.json({ parsed: extracted });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/parse-resume");
  }
}

/** Best-effort name/email/phone sniffer from raw resume text.
 *  extractResumeData doesn't return these — they're not in its
 *  structured schema — so we pull them here with simple regexes.
 *  Name detection is greedy (first line that looks like a personal
 *  name) since the LLM doesn't help with single-token fields. */
function sniffNameEmailPhone(text: string): { fullName: string; email: string; phone: string } {
  let fullName = "";
  let email = "";
  let phone = "";
  if (!text) return { fullName, email, phone };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 15);
  // Email — first @-shape on the page.
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) email = emailMatch[0];
  // Phone — Indian mobile or generic 10-digit. Indian carriers
  // start with 6-9; +91 prefix optional.
  const phoneMatch = text.match(/(?:\+?91[-.\s]?)?[6-9]\d{9}/);
  if (phoneMatch) phone = phoneMatch[0];
  // Name — first line that's all letters / spaces / hyphens /
  // apostrophes, 2-5 words, between 4 and 60 chars. Skip lines
  // that match obvious labels (Resume, CV, Curriculum Vitae).
  for (const ln of lines) {
    const cleaned = ln.replace(/^[•\-*▪◦]\s+/, "").trim();
    if (cleaned.length < 4 || cleaned.length > 60) continue;
    if (/^(resume|cv|curriculum\s+vitae|profile|name)\b/i.test(cleaned)) continue;
    if (!/^[A-Za-z][A-Za-z .'-]{2,58}[A-Za-z.]$/.test(cleaned)) continue;
    const words = cleaned.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    fullName = cleaned;
    break;
  }
  return { fullName, email, phone };
}
