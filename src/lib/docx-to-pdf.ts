// Convert a .docx buffer to a .pdf buffer.
//
// Two converter strategies, tried in order:
//   1. LibreOffice headless (`soffice`) via the `libreoffice-convert`
//      npm wrapper. Cross-platform. Standard production path —
//      install LibreOffice once on the VPS.
//   2. Microsoft Word COM via PowerShell. Windows-only, requires
//      Office installed. Used as a local-dev fallback so engineers
//      can test PDF generation without installing LibreOffice.
//
// If neither is available the function throws — the caller can catch
// and fall back to sending the .docx as the attachment.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir, platform } from "node:os";
import { join, sep } from "node:path";

/** Top-level entry — tries LibreOffice, then Word COM. */
export async function docxToPdf(docxBytes: Buffer): Promise<Buffer> {
  // Try LibreOffice first — same code path on Linux + Windows once
  // soffice is in PATH (or libreoffice-convert finds it).
  try {
    return await convertWithLibreOffice(docxBytes);
  } catch (e: any) {
    // Common failure: soffice not in PATH on the dev machine.
    // Don't swallow silently — log so HR can see why we fell back.
    console.warn("[docx-to-pdf] LibreOffice unavailable, trying Word COM. Reason:", e?.message ?? e);
  }
  if (platform() === "win32") {
    return await convertWithWordCom(docxBytes);
  }
  throw new Error(
    "No DOCX → PDF converter available. Install LibreOffice on this server (`apt install libreoffice --no-install-recommends`).",
  );
}

// ── Strategy 1: LibreOffice via libreoffice-convert ─────────────────
async function convertWithLibreOffice(docxBytes: Buffer): Promise<Buffer> {
  // libreoffice-convert exports a callback-style `convert`; wrap in
  // a Promise. Dynamic require so the missing package doesn't crash
  // imports if it isn't installed yet.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const libre = require("libreoffice-convert") as {
    convert: (input: Buffer, ext: string, filter: string | undefined, cb: (err: Error | null, out: Buffer) => void) => void;
  };
  return await new Promise<Buffer>((resolve, reject) => {
    libre.convert(docxBytes, ".pdf", undefined, (err, out) => {
      if (err) return reject(err);
      resolve(out);
    });
  });
}

// ── Strategy 2: Microsoft Word COM via PowerShell (Windows-only) ───
async function convertWithWordCom(docxBytes: Buffer): Promise<Buffer> {
  // Write the docx to a temp file → PowerShell opens it in Word →
  // SaveAs PDF → we read the PDF back.
  const dir = await mkdtemp(join(tmpdir(), "nb-offer-"));
  const docxPath = join(dir, "in.docx");
  const pdfPath  = join(dir, "out.pdf");
  try {
    await writeFile(docxPath, docxBytes);

    // wdFormatPDF = 17. Hide Word's UI + bypass any "save changes?"
    // prompts in case the doc has formula recalcs etc.
    // Paths escape any single quote a temp dir might contain (rare
    // but safe).
    const ps = [
      "$ErrorActionPreference='Stop'",
      "$word = New-Object -ComObject Word.Application",
      "$word.Visible = $false",
      "$word.DisplayAlerts = 0",
      `$doc = $word.Documents.Open('${docxPath.replace(/'/g, "''")}', $false, $true)`,
      `$doc.SaveAs2('${pdfPath.replace(/'/g, "''")}', 17)`,
      "$doc.Close($false)",
      "$word.Quit()",
      "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null",
      "[GC]::Collect()",
    ].join("; ");

    await runPowerShell(ps);
    return await readFile(pdfPath);
  } finally {
    // Best-effort cleanup; ignore failures (e.g. file still locked by
    // Word for a fraction of a second after Quit).
    try { await rm(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
    );
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`PowerShell exited ${code}: ${stderr.trim() || "(no stderr)"}`));
    });
  });
}
