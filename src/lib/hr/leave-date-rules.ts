// Shared date-rule helpers for leave-style request forms (Leave / WFH /
// On Duty / Half Day / Comp Off).
//
// Rule: regular employees can't pick past dates — past-dated leave goes
// through Regularization instead. The back-dating tier CAN pick past dates
// because HR often needs to file a request on someone's behalf for a missed
// day. That tier is the restricted-leave tier (CEO / role=hr_manager /
// isDeveloper) PLUS the whole HR department (orgLevel="hr_manager", which is
// set on every HR employee) — see canBackDateLeave below.
//
// Both pieces live here so the form `min` attribute and the server
// validator stay in lock-step.

import { canApplyRestrictedLeave } from "@/lib/access";

/** True for the HR department — the "HR" dept and any HR sub-department
 *  (e.g. "HR Operations & TA"). Matches `EmployeeProfile.department`, surfaced
 *  on the session user in src/lib/auth.ts. */
export function isHrDepartment(department: unknown): boolean {
  return typeof department === "string" && /^hr\b/i.test(department.trim());
}

/**
 * Who may pick / submit a PAST date on a leave-style request.
 *
 * = the restricted-leave tier (CEO / role="hr_manager" / isDeveloper) PLUS the
 * whole HR department, identified EITHER by orgLevel (`hr_manager`, set on HR
 * Members + Managers) OR by their `department` being an HR department (covers
 * HR staff whose orgLevel isn't hr_manager — e.g. an HR admin on
 * special_access, or an "HR Operations & TA" member). Kept SEPARATE from
 * `canApplyRestrictedLeave` so granting back-dating does not also widen who can
 * apply restricted leave *types*.
 */
export function canBackDateLeave(user: any): boolean {
  return (
    canApplyRestrictedLeave(user) ||
    user?.orgLevel === "hr_manager" ||
    isHrDepartment(user?.department)
  );
}

/**
 * IST-anchored "today" as a YYYY-MM-DD string. Safe to use as the
 * `min` attribute on a native <input type="date"> or as a comparison
 * floor server-side.
 */
export function istTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/**
 * Returns the `min` value the date picker should enforce for THIS user.
 * Regular employees get today (no past picks); the back-dating tier (see
 * {@link canBackDateLeave} — restricted-leave tier + the HR department) gets
 * `undefined` so they can file back-dated requests on someone's behalf.
 */
export function leaveMinDate(user: any): string | undefined {
  return canBackDateLeave(user) ? undefined : istTodayIso();
}

/**
 * Server-side guard. Returns null when the date is allowed, otherwise
 * an error message string. The caller maps that to a 400 response.
 *
 *   const err = checkPastDateAllowed(body.fromDate, sessionUser);
 *   if (err) return NextResponse.json({ error: err }, { status: 400 });
 *
 * Accepts strings, Date objects, or null. A nullish dateInput returns
 * null (the caller's other validators handle "required" errors).
 */
export function checkPastDateAllowed(
  dateInput: string | Date | null | undefined,
  user: any,
): string | null {
  if (!dateInput) return null;
  if (canBackDateLeave(user)) return null;
  const istToday = istTodayIso();
  const iso = typeof dateInput === "string"
    ? dateInput.slice(0, 10)
    : new Date(dateInput).toISOString().slice(0, 10);
  if (iso < istToday) {
    return "Past dates can't be selected. If you missed a day, please file a Regularization request — or ask HR to back-date on your behalf.";
  }
  return null;
}
