import { drainClicks } from "../../cache.js";
import { bumpClicks } from "./repo.js";

// Clicks are counted in Redis on the hot path and reconciled to Mongo off-path.
// Trigger point: batching matters once click volume would otherwise be one Mongo
// write per redirect; below that you could $inc Mongo directly.
export async function flushOnce(): Promise<number> {
  const counts = await drainClicks();
  const n = Object.keys(counts).length;
  if (n > 0) await bumpClicks(counts);
  return n;
}

let timer: NodeJS.Timeout | null = null;
export function startFlusher(intervalMs = 5000): void {
  if (timer) return;
  timer = setInterval(() => {
    // `void flushOnce()` was a crash. void discards the promise rather than
    // handling it, so when Redis dies drainClicks() rejects with nobody
    // listening -- and Node's default since v15 is to kill the process on an
    // unhandled rejection. The request path was carefully defended with
    // try/catch; this background timer was not, so a dead cache took the whole
    // service down. Found by the 2026-08-30 game-day.
    flushOnce().catch((err) => {
      console.warn("[flusher] flushOnce failed, will retry next tick:", err);
    });
  }, intervalMs);
  timer.unref(); // don't keep the process alive just for flushing
}
export function stopFlusher(): void { if (timer) { clearInterval(timer); timer = null; } }
