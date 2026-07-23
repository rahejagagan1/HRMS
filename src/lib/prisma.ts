import { PrismaClient } from "@prisma/client";

// Validate critical env vars at startup — fail fast in production
if (process.env.NODE_ENV === "production") {
    const required = ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL"];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        throw new Error(`[Startup] Missing required environment variables: ${missing.join(", ")}`);
    }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    // Dev: drop "query" — verbose and irrelevant to the bug we're
    // hunting most of the time, and makes the dev console unreadable.
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/** Disconnect a prior client without awaiting (we can't await inside
 *  a synchronous resolver). Suppress errors — disconnect is best-
 *  effort; if it fails the GC will eventually clean up the engine. */
function disconnectQuietly(client: PrismaClient | undefined): void {
  if (!client) return;
  try {
    // void on purpose — fire-and-forget; the resolver returns
    // synchronously with the fresh client.
    void client.$disconnect().catch(() => { /* noop */ });
  } catch { /* noop */ }
}

function isPrismaClientStale(client: PrismaClient | undefined): boolean {
  if (!client) return true;
  // After `prisma generate`, new models appear on the client class; a cached global
  // instance from before generate does not get them — leads to undefined.findMany.
  const c = client as unknown as {
    youtubeDashboardQuarterMetrics?: { findMany?: unknown };
    youtubeDashboardChannelQuarterAnalysis?: { findMany?: unknown };
    youtubeDashUserQuarterChannel?: { deleteMany?: unknown };
  };
  return (
    typeof c.youtubeDashboardQuarterMetrics?.findMany !== "function" ||
    typeof c.youtubeDashboardChannelQuarterAnalysis?.findMany !== "function" ||
    typeof c.youtubeDashUserQuarterChannel?.deleteMany !== "function"
  );
}

/**
 * Resolve the singleton. In development, replaces the global instance when it was
 * created before `prisma generate` added new models (avoids undefined.findMany).
 */
function resolveClient(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    globalForPrisma.prisma ??= createPrismaClient();
    return globalForPrisma.prisma;
  }
  if (isPrismaClientStale(globalForPrisma.prisma)) {
    // Disconnect the old (stale) client BEFORE swapping in the new
    // one. Without this, every stale-replace leaks the entire engine
    // connection pool (~17 Postgres connections per client by
    // default) — a few HMR reloads quickly exhaust the database's
    // connection slot limit.
    const previous = globalForPrisma.prisma;
    globalForPrisma.prisma = createPrismaClient();
    disconnectQuietly(previous);
  }
  return globalForPrisma.prisma!;
}

/**
 * In dev, a Proxy so every `prisma.*` access runs resolveClient() — module-level
 * `const prisma = resolveClient()` would stay stale across HMR after `prisma generate`.
 */
export const prisma: PrismaClient =
  process.env.NODE_ENV === "development"
    ? (new Proxy({} as PrismaClient, {
          get(_target, prop, receiver) {
            const client = resolveClient();
            const value = Reflect.get(client, prop, receiver);
            if (typeof value === "function") {
              return (value as (...args: unknown[]) => unknown).bind(client);
            }
            return value;
          },
      }) as PrismaClient)
    : resolveClient();

export default prisma;
