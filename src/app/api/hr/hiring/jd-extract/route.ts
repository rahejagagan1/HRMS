// Extract plain text from an uploaded JD file so HR can preview +
// edit it inline inside the Create Job Posting wizard.
//
// POST /api/hr/hiring/jd-extract
//   body: multipart/form-data { file: PDF | DOC | DOCX | RTF | TXT }
//   resp: { text: string }
//
// Parsers (tried in order based on file extension):
//   • .pdf            → pdf-parse
//   • .docx           → mammoth (extractRawText)
//   • .doc            → mammoth too — best-effort; some legacy .doc
//                       binaries won't parse and return an empty string
//                       (HR can type the JD by hand in that case)
//   • .rtf            → strip RTF control codes with a small regex
//   • .txt            → return as-is
//
// 5 MB cap (matches the existing JD upload). HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import mammoth from "mammoth";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf"]);

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  console.log("[jd-extract] POST received");
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File must be 5 MB or smaller" }, { status: 400 });
    }
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }
    console.log(`[jd-extract] parsing ${ext} (${file.size} bytes) "${file.name}"`);

    const buf = Buffer.from(await file.arrayBuffer());
    let text = "";

    if (ext === ".pdf") {
      // pdf-parse v2 ships an OO API (PDFParse class with getText())
      // — totally different from v1's `pdfParse(buf)` function call.
      // First attempt of this endpoint used the v1 signature and
      // hung indefinitely because the function didn't exist; the
      // user saw "Reading file content…" forever. Use the v2 class
      // pattern + a per-call destroy() so worker handles don't leak.
      //
      // Dynamic import (vs require()) because pdf-parse v2 is ESM-
      // first ("type": "module") and Turbopack's server bundler
      // routes ESM packages through import() correctly while
      // require() can silently mis-resolve.
      type PDFParseCtor = new (opts: { data: Uint8Array }) => {
        getText: () => Promise<{ text: string }>;
        destroy: () => Promise<void>;
      };
      const mod = await import("pdf-parse") as unknown as { PDFParse: PDFParseCtor };
      const PDFParse = mod.PDFParse;
      let parser: InstanceType<PDFParseCtor> | null = null;
      try {
        parser = new PDFParse({ data: new Uint8Array(buf) });
        const r = await parser.getText();
        text = String(r?.text ?? "");
      } catch (e: any) {
        console.error("[jd-extract] pdf-parse failed:", e?.message ?? e);
        return NextResponse.json(
          { error: "Couldn't read the PDF. If it's a scanned image, the text isn't extractable — convert to a Word doc and re-upload." },
          { status: 422 },
        );
      } finally {
        try { await parser?.destroy(); } catch { /* noop */ }
      }
    } else if (ext === ".docx" || ext === ".doc") {
      try {
        const result = await mammoth.extractRawText({ buffer: buf });
        text = String(result?.value ?? "");
      } catch (e: any) {
        console.error("[jd-extract] mammoth failed:", e?.message ?? e);
        return NextResponse.json(
          { error: ext === ".doc"
            ? "Legacy .doc binary couldn't be parsed. Save as .docx and re-upload."
            : "Couldn't read the Word document — file may be corrupt." },
          { status: 422 },
        );
      }
    } else if (ext === ".rtf") {
      // Strip RTF control words / groups. Not a full parser — covers
      // the common case (paragraphs, bold/italic, unicode escapes).
      // HR sees plain text; formatting is intentionally dropped so
      // the inline editor stays simple.
      const raw = buf.toString("utf8");
      text = raw
        .replace(/\\par[d]?/g, "\n")
        .replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u(-?\d+)\??/g, (_m, n) => String.fromCharCode(parseInt(n, 10) & 0xffff))
        .replace(/\{[^{}]*\}/g, "")
        .replace(/\\[a-z]+-?\d* ?/gi, "")
        .replace(/[{}]/g, "")
        .trim();
    } else if (ext === ".txt") {
      text = buf.toString("utf8");
    }

    // Normalise whitespace — collapse triple+ newlines, strip CR.
    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    // Strip page-break artefacts: "-- 1 of 2 --", "Page 1 of 2",
    // "1 of 2", "Page 1", etc. PDF-to-text converters often emit
    // these as page separators and they look unprofessional on the
    // candidate-facing JD render.
    text = text
      .split("\n")
      .filter((ln) => !/^[\s\-–—]*(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?[\s\-–—]*$/i.test(ln.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    console.log(`[jd-extract] done in ${Date.now() - t0}ms — ${text.length} chars`);

    return NextResponse.json({ text });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/jd-extract");
  }
}
