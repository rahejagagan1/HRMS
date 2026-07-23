/**
 * In-memory pub/sub used to fan realtime events from API routes out to all
 * connected SSE clients. Works on a single Node.js process (PM2 fork mode,
 * which is what the VPS uses). If the app ever scales to multiple processes
 * or moves to serverless, swap this for a Redis/NATS adapter — only this
 * file changes.
 */

export type RealtimeEvent = {
    /** Dot-namespaced type, e.g. "user.role.changed", "leave.request.approved". */
    type: string;
    /** Optional: deliver only to this user's open SSE connections. */
    targetUserId?: number;
    /** Optional: skip the user who triggered the change (so they don't double-update). */
    excludeUserId?: number;
    /** Free-form payload — keep it small; clients use it to scope mutations. */
    data?: Record<string, unknown>;
    /** Filled in by `emit`. */
    timestamp?: number;
};

type Listener = (event: RealtimeEvent) => void;

class EventBus {
    private listeners = new Set<Listener>();

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    emit(event: RealtimeEvent): void {
        const enriched = { ...event, timestamp: Date.now() };
        for (const listener of this.listeners) {
            try { listener(enriched); }
            catch (err) { console.error("[event-bus] listener threw:", err); }
        }
    }

    get connectionCount(): number {
        return this.listeners.size;
    }
}

// HMR-safe singleton. Next.js dev mode reloads modules; we stash the bus on
// globalThis so existing SSE connections keep working across reloads.
const g = globalThis as unknown as { __nbEventBus?: EventBus };
export const eventBus: EventBus = g.__nbEventBus ?? (g.__nbEventBus = new EventBus());
