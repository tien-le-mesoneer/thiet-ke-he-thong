import { Redis } from "ioredis";
import { config } from "./config.js";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      lazyConnect: false,
      // A cache must fail fast. The defaults are built for a datastore you
      // cannot proceed without: 20 retries per request, plus an offline queue
      // that holds commands while disconnected and then rejects them all at
      // once from inside ioredis -- with no application frame on the stack and
      // nobody awaiting them, which is an unhandled rejection and, since Node
      // 15, a dead process. The 2026-08-30 game-day killed the service twice
      // this way. enableOfflineQueue: false moves the rejection back to the
      // call site, where the existing try/catch handles it as a cache miss.
      connectTimeout: 1000,
      // maxRetriesPerRequest is left at the default. Setting it to 1 failed
      // normal reconnects (9 tests died with "max retries per request limit
      // (which is 1)"), and it is redundant now: withTimeout below abandons the
      // call after CACHE_TIMEOUT_MS regardless of how the driver retries.
      // Driver keeps its resilient defaults for transient blips; the caller
      // owns the latency budget.
      // enableOfflineQueue stays TRUE (the default). Turning it off does give
      // fail-fast, but it also removes the queue that holds commands during
      // normal startup before the connection is ready -- every test failed with
      // "Stream isn't writeable and enableOfflineQueue options is false". The
      // crash this was meant to fix came from an uncaught promise in the click
      // flusher, which is now handled at its source in clicks.ts.
    });
    // ioredis emits connection-level errors as EventEmitter 'error' events,
    // which are NOT caught by try/catch around an awaited command. Without a
    // listener these surface as "[ioredis] Unhandled error event" noise, and on
    // a bare EventEmitter would throw. Callers already treat a failed command
    // as a cache miss, so log and carry on.
    redis.on("error", (err) => {
      console.warn("[redis] connection error (treating as cache miss):", err.message);
    });
  }
  return redis;
}
export async function closeRedis(): Promise<void> {
  await redis?.quit();
  redis = null;
}

/**
 * Cap every cache call at CACHE_TIMEOUT_MS.
 *
 * Neither ioredis setting alone is right. enableOfflineQueue:false fails fast
 * but removes the queue that startup needs, so every command before the socket
 * is ready rejects. Leaving it on fixes startup but lets a dead Redis park the
 * request for ~10s while commands sit in the queue.
 *
 * So the timeout belongs here, in the caller, not in the driver: the cache is
 * an optimisation, and an optimisation is never worth waiting on. Callers
 * already treat a rejection as a cache miss and fall through to Mongo.
 */
const CACHE_TIMEOUT_MS = Number(process.env["CACHE_TIMEOUT_MS"] ?? 100);

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  // When the timeout wins the race, p is still pending and nobody is awaiting
  // it any more. Its eventual rejection would then be unhandled -- which is
  // precisely the failure mode this whole change exists to remove. Swallow it.
  p.catch(() => {});
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`cache ${label} exceeded ${CACHE_TIMEOUT_MS}ms`)),
      CACHE_TIMEOUT_MS,
    );
  });
  // finally clears the timer so a fast call does not hold the event loop open.
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

const urlKey = (code: string) => `u:${code}`;
const CLICK_HASH = "clicks"; // Redis hash: field=code, value=count

export async function cacheGet(code: string): Promise<string | null> {
  return withTimeout(getRedis().get(urlKey(code)), "get");
}
export async function cacheSet(code: string, url: string, ttlS: number): Promise<void> {
  await withTimeout(getRedis().set(urlKey(code), url, "EX", ttlS), "set");
}
export async function incrClick(code: string): Promise<void> {
  await withTimeout(getRedis().hincrby(CLICK_HASH, code, 1), "hincrby");
}
// Atomic read-and-clear so click increments racing between read and delete are not lost.
const DRAIN_LUA = "local v = redis.call('HGETALL', KEYS[1]); redis.call('DEL', KEYS[1]); return v";
export async function drainClicks(): Promise<Record<string, number>> {
  const flat = (await withTimeout(getRedis().eval(DRAIN_LUA, 1, CLICK_HASH) as Promise<string[]>, "drain")) as string[];
  const out: Record<string, number> = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]!] = Number(flat[i + 1]);
  return out;
}
