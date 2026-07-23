// Tiny helper that resolves a Gravatar URL from an email address.
//
// Gravatar serves a 200×200 (configurable) avatar at
//   https://www.gravatar.com/avatar/<md5(lowercase(trim(email)))>?s=<size>&d=<fallback>
//
// `d=404` makes Gravatar return HTTP 404 when no avatar is set for
// the email — that's what lets the React <img onError> handler fall
// back cleanly to the initials avatar. Other useful `d` values
// (mp / identicon / robohash / blank) all return a 200 image, so
// we'd never know whether the photo was real or a placeholder.
//
// MD5 isn't available in Web Crypto's SubtleCrypto, so this is a
// minimal pure-TS implementation. Don't reach for it elsewhere —
// MD5 is broken for crypto. It's fine here because Gravatar's
// public addressing scheme is literally MD5(email).

import { createHash } from "node:crypto";

export function gravatarUrl(email: string | null | undefined, size = 160): string | null {
  if (!email) return null;
  const norm = String(email).trim().toLowerCase();
  if (!norm || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(norm)) return null;
  const hash = createHash("md5").update(norm).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}
