import { Redis } from "ioredis";
import { config } from "./config.js";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) redis = new Redis(config.redisUrl, { lazyConnect: false });
  return redis;
}
export async function closeRedis(): Promise<void> {
  await redis?.quit();
  redis = null;
}

const urlKey = (code: string) => `u:${code}`;
const CLICK_HASH = "clicks"; // Redis hash: field=code, value=count

export async function cacheGet(code: string): Promise<string | null> {
  return getRedis().get(urlKey(code));
}
export async function cacheSet(code: string, url: string, ttlS: number): Promise<void> {
  await getRedis().set(urlKey(code), url, "EX", ttlS);
}
export async function incrClick(code: string): Promise<void> {
  await getRedis().hincrby(CLICK_HASH, code, 1);
}
// Atomically read-and-clear the click hash so the flusher can reconcile to Mongo.
export async function drainClicks(): Promise<Record<string, number>> {
  const r = getRedis();
  const all = await r.hgetall(CLICK_HASH);
  if (Object.keys(all).length === 0) return {};
  await r.del(CLICK_HASH);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(all)) out[k] = Number(v);
  return out;
}
