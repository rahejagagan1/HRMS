import prisma from "@/lib/prisma";

/**
 * Per-employee toggles for attendance + payroll. Returns the effective
 * (DB row OR role-based default) state for a user.
 *
 * Defaults:
 *   • CEO (orgLevel="ceo")  → both DISABLED
 *   • Developers (email in DEVELOPER_EMAILS env) → both DISABLED
 *   • Everyone else → both ENABLED
 *
 * An explicit EmployeeNotificationPolicy row always wins, so HR can flip
 * the CEO's attendance back on if they want reminders again.
 */
export type EffectivePolicy = {
  attendanceEnabled: boolean;
  payrollEnabled:    boolean;
  source: "override" | "default";
};

/** True when this email is on the DEVELOPER_EMAILS env list. */
export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.DEVELOPER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** Role-based default for someone with no explicit override row. */
export function defaultPolicyFor(args: { orgLevel: string | null; email: string | null | undefined }): EffectivePolicy {
  const isCeo = args.orgLevel === "ceo";
  const isDev = isDeveloperEmail(args.email);
  if (isCeo || isDev) return { attendanceEnabled: false, payrollEnabled: false, source: "default" };
  return { attendanceEnabled: true, payrollEnabled: true, source: "default" };
}

/**
 * Resolve the effective policy for a single user. Tries the DB row
 * first; falls back to the role default. Uses raw SQL for the override
 * lookup so a stale `prisma generate` cache on a running dev/VPS server
 * doesn't break the gate (the typed `notificationPolicy` relation may
 * not exist yet on that client).
 */
export async function getEffectivePolicy(userId: number): Promise<EffectivePolicy> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgLevel: true, email: true },
  });
  if (!u) return { attendanceEnabled: false, payrollEnabled: false, source: "default" };
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ attendanceEnabled: boolean; payrollEnabled: boolean }>>(
      `SELECT "attendanceEnabled", "payrollEnabled" FROM "EmployeeNotificationPolicy" WHERE "userId" = $1 LIMIT 1`,
      userId,
    );
    if (rows.length > 0) {
      return {
        attendanceEnabled: rows[0].attendanceEnabled,
        payrollEnabled:    rows[0].payrollEnabled,
        source: "override",
      };
    }
  } catch (e) {
    console.warn("[notification-policy] override lookup failed:", e);
  }
  return defaultPolicyFor({ orgLevel: u.orgLevel, email: u.email });
}

/** Bulk read used by reminder jobs + dashboards. Returns a Map keyed by userId. */
export async function getPoliciesByUser(userIds: number[]): Promise<Map<number, EffectivePolicy>> {
  const out = new Map<number, EffectivePolicy>();
  if (userIds.length === 0) return out;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, orgLevel: true, email: true },
  });
  let overrideByUser = new Map<number, { attendanceEnabled: boolean; payrollEnabled: boolean }>();
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ userId: number; attendanceEnabled: boolean; payrollEnabled: boolean }>>(
      `SELECT "userId", "attendanceEnabled", "payrollEnabled" FROM "EmployeeNotificationPolicy" WHERE "userId" = ANY($1::int[])`,
      userIds,
    );
    overrideByUser = new Map(rows.map((r) => [r.userId, { attendanceEnabled: r.attendanceEnabled, payrollEnabled: r.payrollEnabled }]));
  } catch (e) {
    console.warn("[notification-policy] bulk override lookup failed:", e);
  }
  for (const u of users) {
    const ov = overrideByUser.get(u.id);
    if (ov) {
      out.set(u.id, { attendanceEnabled: ov.attendanceEnabled, payrollEnabled: ov.payrollEnabled, source: "override" });
    } else {
      out.set(u.id, defaultPolicyFor({ orgLevel: u.orgLevel, email: u.email }));
    }
  }
  return out;
}

/**
 * "Is this user's attendance tracked at all?" One-line guard the clock-
 * in / clock-out routes and dashboards call to skip ineligible users.
 */
export async function isAttendanceEnabled(userId: number): Promise<boolean> {
  return (await getEffectivePolicy(userId)).attendanceEnabled;
}
