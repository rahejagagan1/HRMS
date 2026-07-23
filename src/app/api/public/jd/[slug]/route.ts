// Public JD streaming endpoint — returns the job's uploaded JD with
// proper Content-Type + inline Content-Disposition so browsers
// render it in the <iframe> on /jobs/[slug] instead of forcing a
// download or refusing to display.
//
// Why this exists: Next.js static serving from /public sometimes
// returns Content-Type: application/octet-stream (or attachment
// disposition) for files with non-ASCII names. Chrome then refuses
// to render the PDF inline. Routing through an API handler lets us
// pin the headers ourselves.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { readFile, stat } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";

export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".rtf":  "application/rtf",
  ".txt":  "text/plain; charset=utf-8",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slug) return NextResponse.json({ error: "Bad slug" }, { status: 400 });

  // Look up the job by public slug. Public access — no auth gate.
  // Only published jobs are served so we don't leak draft JDs.
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "jdFileUrl", "jdFileName", "status"
       FROM "JobOpening"
      WHERE "publicSlug" = $1
      LIMIT 1`,
    slug,
  );
  const job = rows[0];
  if (!job || !job.jdFileUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.status && job.status !== "published") {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  // jdFileUrl is "/uploads/jds/<file>" — resolve to disk path under
  // /public, then guard against path traversal.
  const publicRoot = resolve(process.cwd(), "public");
  const stored = String(job.jdFileUrl);
  if (!stored.startsWith("/uploads/")) {
    return NextResponse.json({ error: "Invalid stored path" }, { status: 400 });
  }
  const filePath = resolve(publicRoot, "." + stored);
  if (!filePath.startsWith(publicRoot)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let buf: Buffer;
  try {
    await stat(filePath);
    buf = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  // Use the original display name from DB for the Content-Disposition
  // filename* parameter so the "Save as" dialog shows something
  // human-friendly, but ASCII-fallback for legacy clients.
  const displayName = job.jdFileName || basename(filePath);
  const asciiFallback = displayName.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(displayName);

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":   mime,
      "Content-Length": String(buf.length),
      // `inline` lets browsers render the PDF in-page instead of
      // prompting a download. The fallback filename is for
      // ancient clients that don't understand filename*.
      "Content-Disposition": `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      // Don't cache — the URL is slug-stable but the underlying file
      // changes whenever HR uploads a replacement. A previous version
      // set max-age=3600 here, which meant the careers-page iframe
      // (and any CDN in front of us) served the old PDF for up to
      // an hour after HR clicked "Replace file". no-store keeps this
      // simple; the JD is small and read from disk per request.
      "Cache-Control": "no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      // Allow same-origin framing so /jobs/[slug] can <iframe> this
      // response. Setting these here (vs. only in next.config.mjs)
      // ensures route-handler headers win — the global (.*) rule
      // also sets X-Frame-Options: DENY and Next.js MERGES the two,
      // which causes Chrome/Brave to reject the iframe with "refused
      // to connect". Route-handler headers replace the config ones,
      // so the public JD viewer works.
      "X-Frame-Options":          "SAMEORIGIN",
      "Content-Security-Policy":  "frame-ancestors 'self'",
    },
  });
}
