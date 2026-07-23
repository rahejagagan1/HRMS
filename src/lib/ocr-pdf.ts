// OCR fallback for PDFs whose bold text is rendered as vector
// outlines rather than selectable characters (Canva / Figma /
// InDesign templates often do this). When pdfjs text extraction
// returns suspiciously little, we re-render each page as a high-
// res PNG and run OCR over the pixels.
//
// Pipeline (pure JS + WebAssembly, no native binaries):
//   1. mupdf (WASM build of MuPDF) renders the page to a Pixmap and
//      encodes it as a PNG buffer in one step. We tried pdfjs + a
//      Node Canvas implementation (@napi-rs/canvas, skia-canvas,
//      node-canvas) first — every one of them choked on pdfjs v5's
//      strict Canvas Path API expectations. mupdf sidesteps the
//      whole canvas dance and just writes the bytes.
//   2. tesseract.js (WASM) OCRs each PNG. Module-level cache for
//      the Tesseract worker so the first-call cold start
//      (~10 MB English language model download) only happens once.
//
// Both deps ship as npm packages with prebuilt WASM — nothing to
// apt-install, no platform-specific build steps, works the same on
// Windows dev and the Linux VPS.

let cachedWorker: any = null;
let depsAvailable: boolean | null = null;

/** Returns true when mupdf + tesseract.js are loadable AND a
 *  worker can actually start. Cached after the first probe so
 *  repeat candidate-GET calls don't redo the dynamic imports.
 *  Also catches the case where the deps import fine but
 *  Tesseract's worker fails to spawn (Webpack/Turbopack mangled
 *  the worker script path) — without this probe, the worker
 *  spawn would later throw an uncaughtException and crash the
 *  request. */
export async function isOcrAvailable(): Promise<boolean> {
  if (depsAvailable != null) return depsAvailable;
  try {
    await import("mupdf");
    const Tesseract: any = await import("tesseract.js");
    // Real probe: try to spawn a worker. If the worker script
    // path is broken (the /ROOT/... bug we hit on the VPS), this
    // throws synchronously here instead of letting the error
    // escape later as an uncaughtException.
    const createWorker = Tesseract.createWorker ?? Tesseract.default?.createWorker;
    const w = await createWorker("eng");
    // Cache the worker so getOcrWorker() reuses it.
    cachedWorker = w;
    depsAvailable = true;
  } catch (e: any) {
    console.warn("[ocr-pdf] OCR unavailable:", e?.message ?? e);
    depsAvailable = false;
  }
  return depsAvailable;
}

async function getOcrWorker(): Promise<any> {
  if (cachedWorker) return cachedWorker;
  const Tesseract: any = await import("tesseract.js");
  const createWorker = Tesseract.createWorker ?? Tesseract.default?.createWorker;
  cachedWorker = await createWorker("eng");
  return cachedWorker;
}

/** Render every page of the PDF to a PNG and OCR each one.
 *  Returns the concatenated text. "" on any failure so the caller
 *  can fall back to the text-only extractor. */
export async function ocrPdf(pdfBytes: Buffer): Promise<string> {
  try {
    if (!(await isOcrAvailable())) return "";

    const mupdf: any = await import("mupdf");
    const doc = mupdf.Document.openDocument(new Uint8Array(pdfBytes), "application/pdf");
    const numPages = doc.countPages();

    const worker = await getOcrWorker();
    const pages: string[] = [];

    for (let i = 0; i < numPages; i++) {
      let page: any;
      try {
        page = doc.loadPage(i);
        // 2.0× scale ≈ 200 DPI — enough resolution for Tesseract
        // to read typical resume body text without ballooning
        // memory + processing time.
        const pix = page.toPixmap(
          mupdf.Matrix.scale(2.0, 2.0),
          mupdf.ColorSpace.DeviceRGB,
        );
        const png = pix.asPNG();
        const { data } = await worker.recognize(png);
        const text = String(data?.text ?? "").trim();
        if (text) pages.push(text);
      } catch (e: any) {
        console.error(`[ocr-pdf] page ${i + 1} failed:`, e?.message ?? e);
      } finally {
        try { page?.destroy?.(); } catch { /* noop */ }
      }
    }
    try { doc.destroy?.(); } catch { /* noop */ }
    return pages.join("\n").trim();
  } catch (e: any) {
    console.error("[ocr-pdf] failed:", e?.message ?? e);
    return "";
  }
}
