const MOBILE_UA_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

// Server-side check: looks at the request's User-Agent and Sec-CH-UA-Mobile
// headers. Both can be spoofed by curl/Postman, but the combination catches
// every normal mobile browser including ones in "Request Desktop Site" mode
// (Chromium sends Sec-CH-UA-Mobile: ?1 even when the UA claims to be desktop).
export function isMobileRequest(headers: Headers | { get(name: string): string | null }): boolean {
  const ua = headers.get("user-agent") || "";
  const chMobile = headers.get("sec-ch-ua-mobile") || "";
  if (chMobile === "?1") return true;
  if (MOBILE_UA_REGEX.test(ua)) return true;
  return false;
}

// Client-side check: combines UA regex with signals that the server can't see
// (userAgentData.mobile, touch points, pointer media query). Catches Request
// Desktop Site mode where the UA string alone is desktop.
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;

  const ua = navigator.userAgent || "";
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;

  if (uaData?.mobile === true) return true;
  if (MOBILE_UA_REGEX.test(ua)) return true;
  if (ua.includes("Macintosh") && navigator.maxTouchPoints > 1) return true;
  if (
    navigator.maxTouchPoints > 1 &&
    window.matchMedia?.("(pointer: coarse)").matches &&
    window.matchMedia?.("(max-width: 1024px)").matches
  ) return true;

  return false;
}
