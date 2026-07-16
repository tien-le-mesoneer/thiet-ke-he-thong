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
