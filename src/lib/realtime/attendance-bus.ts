// In-process pub/sub for live attendance updates (SSE). The app runs as a
// SINGLE pm2 instance (fork mode), so the webhook that records a punch and the
// SSE route that streams to the browser share this one emitter. If this ever
// moves to pm2 cluster / multiple instances, swap this for Postgres
// LISTEN/NOTIFY (the only change needed — same publish/subscribe surface).
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per open SSE connection — don't cap
const CHANNEL = "attendance-punch";

/** Notify any open dashboards for this user that their attendance changed. */
export function publishPunch(userId: number): void {
  emitter.emit(CHANNEL, userId);
}

/** Subscribe to punches for one user. Returns an unsubscribe fn. */
export function subscribePunch(userId: number, onPunch: () => void): () => void {
  const handler = (uid: number) => { if (uid === userId) onPunch(); };
  emitter.on(CHANNEL, handler);
  return () => { emitter.off(CHANNEL, handler); };
}
