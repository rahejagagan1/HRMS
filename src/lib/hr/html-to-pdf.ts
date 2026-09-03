// HTML → PDF via headless Chromium (puppeteer-core + system Chrome).
//
// Switched from LibreOffice → Chromium because LibreOffice's HTML
// importer mangles modern CSS (position:absolute, flex, mm widths,
// background-image positioning, display:block on inline elements).
// We hit at least four user-visible bugs with it: full-page logo
// blow-ups, duplicate letterheads, signature stuck inline with
// "Regards,", and giant native-size cursive in the PDF.
//
// Chromium IS the same engine that renders the in-app iframe
// preview, so PDF output is guaranteed to match what HR sees on
// screen byte-for-byte. We use puppeteer-core (no bundled
// chromium download — looks up system Chrome / Chromium /
// chromium-browser at runtime).

import puppeteer, { type Browser, type LaunchOptions } from "puppeteer-core";
import { existsSync } from "node:fs";
import { platform } from "node:os";

// Cache the launched browser across requests so we don't pay
// startup latency on every PDF generation. The browser is closed
// when the Node process exits.
let browserPromise: Promise<Browser> | null = null;

function findChromePath(): string | null {
  // Explicit override wins — point PUPPETEER_EXECUTABLE_PATH at any
  // Chrome / Chromium / Edge binary (handy on servers or non-standard installs).
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath) {
    try { if (existsSync(envPath)) return envPath; } catch { /* ignore */ }
  }
  // Common system Chrome / Chromium locations across the
  // platforms the dashboard runs on (Ubuntu VPS, dev macOS,
  // dev Windows). The first existing path wins.
  const candidates = platform() === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
        "C:\\Program Files\\Chromium\\Application\\chrome.exe",
        // Edge is Chromium-based and ships on every Windows machine — a
        // reliable fallback so local dev can render PDFs without installing Chrome.
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : platform() === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
      ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

async function getBrowser(): Promise<Browser> {
  // A cached promise is only reusable while it points at a LIVE browser.
  // Two ways the old unconditional cache went permanently bad:
  //   • the very first launch rejected (Chromium missing, transient EACCES)
  //     — the rejected promise stayed cached, so every later request threw
  //     the same stale error and the letter route fell back to HTML forever
  //   • the browser died later (OOM kill, `pkill chrome`, VPS deploy) —
  //     newPage() then threw on a disconnected instance
  // Either way the only cure was restarting Node. Now a bad browser is
  // dropped so the next call retries from scratch.
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.connected) return existing;
    } catch {
      /* fall through to a fresh launch */
    }
    browserPromise = null;
  }
  const executablePath = findChromePath();
  if (!executablePath) {
    throw new Error(
      "No system Chrome / Chromium found. Install with:\n" +
      "  Ubuntu : sudo apt-get install -y chromium-browser\n" +
      "  macOS  : brew install --cask google-chrome\n" +
      "  Windows: install Chrome via https://www.google.com/chrome/"
    );
  }
  const opts: LaunchOptions = {
    executablePath,
    headless: true,
    args: [
      // Sandbox needs setuid bits or kernel namespaces; the VPS
      // typically runs as root so disable it to avoid the launcher
      // bailing out with EACCES.
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
  const launching = puppeteer.launch(opts).then((browser) => {
    // Drop the cache the moment Chromium goes away, so the next caller
    // launches a fresh one instead of reusing a corpse.
    browser.once("disconnected", () => {
      if (browserPromise === launching) browserPromise = null;
    });
    return browser;
  });
  browserPromise = launching;
  // Don't leave a rejected promise parked in the cache.
  launching.catch(() => {
    if (browserPromise === launching) browserPromise = null;
  });
  return launching;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // setContent waits for network idle so data: URIs / inline
    // styles all finish before we snapshot to PDF.
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      // Page whitespace comes from the CSS `@page { margin: 16mm 16mm 18mm
      // 16mm }` in wrapLetterPreviewHtml. We MUST honour the CSS page box
      // (preferCSSPageSize) rather than pass a `margin` option here:
      // Chromium gives the CSS @page margin precedence over the page.pdf
      // margin option, so the option was being silently ignored and every
      // letter rendered with content flush to the left edge (0mm margin).
      // @page size is A4, so we don't pass `format` either.
      preferCSSPageSize: true,
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}
