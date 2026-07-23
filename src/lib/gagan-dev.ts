// Identity gate for the ONE developer (Gagan) allowed to use the
// clock-out-on-behalf control on the employee attendance page.
//
// Deliberately a specific email — NOT the broader `isDeveloper` flag / the
// DEVELOPER_EMAILS allow-list. The requirement is that ONLY Gagan sees and can
// use it: no other developer, no CEO, no HR manager, no admin. Hardcoded (not
// read from env) so the exact same value resolves identically on the client
// (where the button is shown) and on the server (where the API enforces it) —
// a NEXT_PUBLIC_ env split could otherwise let the two drift.
export const GAGAN_DEVELOPER_EMAIL = "rahejagagan1@gmail.com";

/** True only for Gagan's developer account (case-insensitive). */
export function isGaganDeveloper(email?: string | null): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === GAGAN_DEVELOPER_EMAIL;
}
