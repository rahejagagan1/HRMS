import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { eventBus, type RealtimeEvent } from "@/lib/event-bus";

// Long-lived stream — never cache, never prerender.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 25_000;   // < typical proxy idle timeouts (30s default on Caddy/Nginx)
const RETRY_HINT_MS = 3_000;   // browser EventSource auto-reconnect interval

export async function GET(req: NextRequest) {
    const { session, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const userId = (session!.user as { dbId?: number }).dbId;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            let closed = false;

            const safeEnqueue = (chunk: string) => {
                if (closed) return;
                try { controller.enqueue(encoder.encode(chunk)); }
                catch { /* controller already closed — ignore */ }
            };

            // Tell the browser how long to wait before reconnecting after a drop.
            safeEnqueue(`retry: ${RETRY_HINT_MS}\n\n`);
            safeEnqueue(`event: ready\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

            const unsubscribe = eventBus.subscribe((event: RealtimeEvent) => {
                // Per-user filters — prevent leaking other users' data over the wire.
                if (typeof event.targetUserId === "number" && event.targetUserId !== userId) return;
                if (typeof event.excludeUserId === "number" && event.excludeUserId === userId) return;
                safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
            });

            // Comment-line heartbeat keeps proxies / load balancers from killing
            // the connection during quiet periods.
            const heartbeat = setInterval(() => {
                safeEnqueue(`: ping ${Date.now()}\n\n`);
            }, HEARTBEAT_MS);

            const cleanup = () => {
                if (closed) return;
                closed = true;
                clearInterval(heartbeat);
                unsubscribe();
                try { controller.close(); } catch { /* already closed */ }
            };

            req.signal.addEventListener("abort", cleanup);
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type":  "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection":    "keep-alive",
            // Disable buffering on Nginx (and Caddy with the equivalent flag);
            // without this the browser may not see events until the buffer fills.
            "X-Accel-Buffering": "no",
        },
    });
}
