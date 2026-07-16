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
// Atomic read-and-clear so click increments racing between read and delete are not lost.
const DRAIN_LUA = "local v = redis.call('HGETALL', KEYS[1]); redis.call('DEL', KEYS[1]); return v";
export async function drainClicks(): Promise<Record<string, number>> {
  const flat = (await getRedis().eval(DRAIN_LUA, 1, CLICK_HASH)) as string[];
  const out: Record<string, number> = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]!] = Number(flat[i + 1]);
  return out;
}
