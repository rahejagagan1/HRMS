// Parse an uploaded resume → onboard-form prefill, using the local
// Ollama model on the VPS.
//
// POST /api/hr/onboard/parse-resume
//   body: multipart/form-data { file: PDF | DOC | DOCX | TXT | RTF }
//   resp: { patch, fileName }   — patch = subset of onboard form fields
//
// Text extraction mirrors /api/hr/hiring/jd-extract (pdf-parse v2 +
// mammoth). Image / scanned resumes aren't supported yet (no vision
// model installed). HR-admin only.
import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import mammoth from "mammoth";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { extractResumeFields, buildResumePatch } from "@/lib/resume-parse";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";
export const maxDuration = 120; // Ollama on CPU can take a while

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf"]);

export async function POST(req: NextRequest) {
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
      return NextResponse.json(
        { error: "Unsupported file. Upload a PDF, Word doc, or text resume. (Image / scanned resumes aren't supported yet.)" },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let text = "";

    if (ext === ".pdf") {
      type PDFParseCtor = new (opts: { data: Uint8Array }) => {
        getText: () => Promise<{ text: string }>;
        destroy: () => Promise<void>;
      };
      const mod = await import("pdf-parse") as unknown as { PDFParse: PDFParseCtor };
      let parser: InstanceType<PDFParseCtor> | null = null;
      try {
        parser = new mod.PDFParse({ data: new Uint8Array(buf) });
        const r = await parser.getText();
        text = String(r?.text ?? "");
      } catch (e: any) {
        console.error("[parse-resume] pdf-parse failed:", e?.message ?? e);
        return NextResponse.json(
          { error: "Couldn't read the PDF. If it's a scanned image, the text isn't extractable — upload a Word doc instead." },
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
        console.error("[parse-resume] mammoth failed:", e?.message ?? e);
        return NextResponse.json(
          { error: ext === ".doc" ? "Legacy .doc couldn't be read. Save as .docx and re-upload." : "Couldn't read the Word document." },
          { status: 422 },
        );
      }
    } else if (ext === ".rtf") {
      const raw = buf.toString("utf8");
      text = raw
        .replace(/\\par[d]?/g, "\n")
        .replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\{[^{}]*\}/g, "")
        .replace(/\\[a-z]+-?\d* ?/gi, "")
        .replace(/[{}]/g, "")
        .trim();
    } else {
      text = buf.toString("utf8");
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 20) {
      return NextResponse.json(
        { error: "No readable text found in the file. If it's a scanned image, upload a text-based PDF or Word doc." },
        { status: 422 },
      );
    }

    const fields = await extractResumeFields(text);
    const patch = buildResumePatch(fields);
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Couldn't pull any usable details from this resume." }, { status: 422 });
    }
    return NextResponse.json({ patch, fileName: file.name });
  } catch (e: any) {
    // Surface the friendly Ollama-reach / timeout messages from the lib.
    const msg = e?.message || "";
    if (/Ollama|resume model|timed out/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    return serverError(e, "POST /api/hr/onboard/parse-resume");
  }
}
