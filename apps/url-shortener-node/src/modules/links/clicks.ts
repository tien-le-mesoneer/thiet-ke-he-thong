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
  timer = setInterval(() => { void flushOnce(); }, intervalMs);
  timer.unref(); // don't keep the process alive just for flushing
}
export function stopFlusher(): void { if (timer) { clearInterval(timer); timer = null; } }
