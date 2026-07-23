// ─────────────────────────────────────────────────────────────────────────
// can() — the ONE access check used across the whole app.
//
// Replaces every scattered `orgLevel === ...` / `role === ...` / `isDeveloper`
// gate. A user carries a resolved `permissions` array (loaded from their
// designation at login — see ./resolve-permissions) plus the env-driven
// `isDeveloper` flag.
//
// Override rules (preserve current behavior exactly):
//   • Developers (DEVELOPER_EMAILS env) get a BLANKET pass — EXCEPT salary-class
//     permissions, which keep the salary-visibility policy.
//   • Salary-class permissions are granted to the trusted salary developer
//     (SALARY_DEV_EMAIL) always, and otherwise only when the user's designation
//     explicitly grants them (today: CEO / HR Manager).
//   • Everyone else: the permission must be present in their resolved set.
// ─────────────────────────────────────────────────────────────────────────

import { Permission, SALARY_PERMISSIONS, SALARY_DEV_EMAIL } from "./catalog";

export type AccessUser =
  | {
      permissions?: ReadonlyArray<Permission | string> | null;
      isDeveloper?: boolean | null;
      email?: string | null;
    }
  | null
  | undefined;

/** True when this user is the single salary-trusted developer. */
function isSalaryDeveloper(user: NonNullable<AccessUser>): boolean {
  return (
    user.isDeveloper === true &&
    typeof user.email === "string" &&
    user.email.toLowerCase() === SALARY_DEV_EMAIL
  );
}

/** Does this user hold the given permission? */
export function can(user: AccessUser, perm: Permission): boolean {
  if (!user) return false;

  const granted = (user.permissions ?? []).includes(perm);

  // Salary-class: env-developer blanket pass does NOT apply. Only the trusted
  // salary developer is auto-granted; everyone else needs an explicit grant
  // (which the CEO / HR Manager designations carry).
  if (SALARY_PERMISSIONS.has(perm)) {
    return isSalaryDeveloper(user) || granted;
  }

  // Non-salary: developers see everything.
  if (user.isDeveloper === true) return true;

  return granted;
}

/** True when the user holds AT LEAST ONE of the given permissions. */
export function canAny(user: AccessUser, perms: Permission[]): boolean {
  return perms.some((p) => can(user, p));
}

/** True when the user holds ALL of the given permissions. */
export function canAll(user: AccessUser, perms: Permission[]): boolean {
  return perms.every((p) => can(user, p));
}

/** True when this user object carries a resolved permissions array (i.e. came
 *  from the session). Lets the legacy helpers do a safe dual-read: use can()
 *  when permissions are present, fall back to orgLevel/role for bare objects. */
export function hasResolvedPermissions(user: AccessUser): boolean {
  return Array.isArray(user?.permissions);
}
