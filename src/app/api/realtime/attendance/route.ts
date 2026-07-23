// Server-Sent Events stream for live attendance updates. The dashboard opens
// one EventSource to this route; when a punch (e.g. a biometric scan) is
// recorded for this user, the webhook publishes to the in-process bus and we
// push an event here instantly — the client then revalidates its attendance
// data. No polling delay.
//
// Auth is the normal session (the browser sends its cookie), so this is NOT a
// public route — each connection only ever receives ITS OWN user's punches.
//
// Reverse proxy: Caddy streams fine, just disable buffering for this path:
//   handle /api/realtime/* { reverse_proxy localhost:3005 { flush_interval -1 } }
import { requireAuth, resolveUserId } from "@/lib/api-auth";
import { subscribePunch } from "@/lib/realtime/attendance-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const userId = await resolveUserId(session);
  if (!userId) return new Response("User not found", { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
      };
      send("retry: 5000\n\n");          // client auto-reconnect backoff
      send("event: ready\ndata: ok\n\n");
      // Push on each punch for this user.
      unsubscribe = subscribePunch(userId, () => send(`event: punch\ndata: ${Date.now()}\n\n`));
      // Keepalive comment so idle proxies don't drop the connection.
      heartbeat = setInterval(() => send(": keepalive\n\n"), 25_000);
    },
    cancel() {
      unsubscribe();
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
