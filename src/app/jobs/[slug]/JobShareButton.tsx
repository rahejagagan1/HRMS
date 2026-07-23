"use client";

// Tiny client island for the public job page — copies the current URL
// to the clipboard. Falls back to the legacy textarea trick if
// navigator.clipboard isn't available (older mobile browsers).
//
// Lives next to page.tsx because it's the only client interactivity
// the otherwise server-rendered page needs.

import { useState } from "react";
import { Check } from "lucide-react";

export default function JobShareButton({
  title,
  brand,
  className,
  children,
}: {
  title: string;
  brand: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const shareText = `We're hiring — ${title} at ${brand}. Apply here:`;

    // Prefer the native share sheet on mobile — opens WhatsApp, Mail,
    // LinkedIn, etc. directly. Falls back to clipboard on desktop.
    const nav = navigator as any;
    if (nav?.share) {
      try {
        await nav.share({ title: `${title} — ${brand}`, text: shareText, url });
        return;
      } catch {
        // User dismissed the share sheet — fall through to clipboard
        // copy so we still give them a useful result.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button type="button" onClick={onClick} className={className}>
      {copied ? (<><Check size={13} /> Link copied</>) : children}
    </button>
  );
}
