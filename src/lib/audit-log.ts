import type { NextRequest } from "next/server";
import prisma from "./prisma";

/**
 * Append-only audit log writer.
 *
 *   await writeAuditLog({
 *     req,
 *     actorId: myId,
 *     actorEmail: session.user.email,
 *     action: "leave.approve",
 *     entityType: "LeaveApplication",
 *     entityId: leave.id,
 *     before: { status: "pending" },
 *     after:  { status: "approved", approvedById: myId },
 *   });
 *
 * Audit log failures must NEVER break the underlying action — we catch
 * everything here and just log to console. Uses raw SQL so the helper keeps
 * working when the generated Prisma client is briefly out-of-date with the
 * latest schema (e.g. before `prisma generate` has been re-run on a dev box).
 */
export async function writeAuditLog(args: {
  req?: NextRequest | Request;
  actorId?: number | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: any;
  after?: any;
  metadata?: any;
}): Promise<void> {
  try {
    const ip =
      args.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      args.req?.headers.get("x-real-ip") ||
      null;
    const userAgent = args.req?.headers.get("user-agent") || null;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuditLog"
        ("actorId","actorEmail","action","entityType","entityId","before","after","ip","userAgent","metadata")
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb)`,
      args.actorId ?? null,
      args.actorEmail ?? null,
      args.action,
      args.entityType,
      args.entityId != null ? String(args.entityId) : null,
      args.before !== undefined ? JSON.stringify(args.before) : null,
      args.after  !== undefined ? JSON.stringify(args.after)  : null,
      ip,
      userAgent,
      args.metadata !== undefined ? JSON.stringify(args.metadata) : null
    );
  } catch (e) {
    // Never break the underlying request just because the audit write
    // failed. Surface to console so ops can investigate.
    console.error("[AuditLog] write failed:", e);
  }
}
