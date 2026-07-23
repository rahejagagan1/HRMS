// Shared JD HTML normalisation.
//
// JDs extracted from an uploaded PDF store EVERY visual line as its own
// <p> (PDF-to-text extractors emit one line per printed line, and Quill
// turns each line into a paragraph block). Rendered at any width other
// than the original PDF's line width, those fragments wrap and leave
// stubs ("who can", "-on") on their own lines.
//
// mergeSoftWrappedJdParagraphs glues consecutive <p> fragments back into
// one flowing paragraph so the text reflows naturally at ANY container
// width. Used by all four JD surfaces so they can't disagree:
//   • public careers page   (src/app/jobs/[slug]/page.tsx → JdHtmlPanel)
//   • Edit JD modal preview (src/components/hr/hiring/JobsTab.tsx)
//   • editor load           (plainTextToQuillHtml HTML pass-through)
//   • generated PDF         (src/lib/jd-doc-from-text.ts → buildBodyXml)

// A <p> merges into the previous one only when the previous block's
// visible text does NOT end a sentence/clause — i.e. it's mid-sentence,
// which is the signature of a soft wrap. Terminal punctuation (optionally
// followed by closing quotes/brackets) keeps paragraphs separate, so
// deliberately authored one-sentence-per-paragraph content survives.
const TERMINAL_RE = /[.!?:;…]["'”’)\]]*$/;

export function mergeSoftWrappedJdParagraphs(html: string): string {
  if (!html || !html.trim().startsWith("<")) return html;

  // Tokenise the top-level blocks Quill emits. Anything between/around
  // blocks (stray text) means the shape isn't what we expect — bail out
  // and return the input untouched rather than risk mangling it.
  const blockRe = /<(p|h[1-6]|ul|ol|div|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  type Tok = { tag: string; attrs: string; inner: string; raw: string };
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = blockRe.exec(html)) !== null) {
    if (html.slice(last, m.index).trim()) return html;
    toks.push({ tag: m[1].toLowerCase(), attrs: m[2] ?? "", inner: m[3] ?? "", raw: m[0] });
    last = m.index + m[0].length;
  }
  if (html.slice(last).trim() || toks.length === 0) return html;

  const textOf = (inner: string) =>
    inner
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/ /g, " ")
      .trim();

  const out: string[] = [];
  let buf: Tok | null = null;
  const flush = () => {
    if (buf) {
      out.push(`<p${buf.attrs}>${buf.inner}</p>`);
      buf = null;
    }
  };

  for (const t of toks) {
    const isP = t.tag === "p";
    const txt = isP ? textOf(t.inner) : "";
    // Blank spacer paragraphs (<p><br></p>) and non-<p> blocks
    // (headings, lists) always break a merge run and pass through.
    if (!isP || !txt) {
      flush();
      out.push(t.raw);
      continue;
    }
    if (buf && !TERMINAL_RE.test(textOf(buf.inner)) && buf.attrs.trim() === t.attrs.trim()) {
      buf.inner = `${buf.inner} ${t.inner}`;
    } else {
      flush();
      buf = { tag: t.tag, attrs: t.attrs, inner: t.inner, raw: t.raw };
    }
  }
  flush();
  return out.join("");
}
