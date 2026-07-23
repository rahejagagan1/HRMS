"use client";

// Meta (Facebook) Pixel — loaded only where this component is mounted
// (currently the public /jobs subtree via src/app/jobs/layout.tsx, so
// the authed dashboard stays untracked). Reads the pixel id from
// NEXT_PUBLIC_META_PIXEL_ID; when the env var is absent (e.g. local
// dev) the component renders nothing and fbqTrack() is a no-op, so
// dev traffic never pollutes the ad account's event data.

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

// Safe event helper for the rest of the app. Retries briefly because
// callers' effects can run before the afterInteractive pixel script
// has installed window.fbq — without the retry those events are lost.
export function fbqTrack(event: string, params?: Record<string, unknown>) {
  if (!PIXEL_ID || typeof window === "undefined") return;
  let tries = 0;
  const send = () => {
    if (window.fbq) { window.fbq("track", event, params); return; }
    if (tries++ < 20) setTimeout(send, 250);
  };
  send();
}

export default function MetaPixel() {
  const pathname = usePathname();
  const firstLoad = useRef(true);

  // The base snippet fires PageView for the initial load; Next.js
  // client-side navigations don't reload the page, so route changes
  // need their own PageView or Meta only ever sees the landing URL.
  useEffect(() => {
    if (!PIXEL_ID) return;
    if (firstLoad.current) { firstLoad.current = false; return; }
    window.fbq?.("track", "PageView");
  }, [pathname]);

  if (!PIXEL_ID) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
