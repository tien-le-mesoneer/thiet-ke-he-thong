import { config } from "../../config.js";
import { makeAllocator } from "./idrange.js";
import { encode } from "./keygen.js";
import { insertLink, findByCode } from "./repo.js";
import { cacheGet, cacheSet, incrClick } from "../../cache.js";
import type { LinkDoc } from "../../db.js";

const alloc = makeAllocator("url");

export interface ShortenOpts { owner?: string | null; metadata?: Record<string, unknown> | null; }

export function isValidHttpUrl(u: string): boolean {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:"; }
  catch { return false; }
}

export async function shorten(longUrl: string, opts: ShortenOpts = {}): Promise<{ code: string }> {
  const id = await alloc.nextId();
  const code = encode(id);
  const now = new Date();
  const expires = new Date(now.getTime() + config.linkTtlDays * 86400_000);
  const doc: LinkDoc = {
    short_code: code, long_url: longUrl, owner: opts.owner ?? null,
    metadata: opts.metadata ?? null, click_count: 0, created_at: now, expires_at: expires,
  };
  await insertLink(doc);
  await cacheSet(code, longUrl, config.cacheTtlS);
  return { code };
}

export async function resolve(code: string): Promise<string | null> {
  const cached = await cacheGet(code);
  if (cached) { await incrClick(code); return cached; }   // cache hit
  const doc = await findByCode(code);                     // cache miss (normal)
  if (!doc) return null;
  await cacheSet(code, doc.long_url, config.cacheTtlS);
  await incrClick(code);
  return doc.long_url;
}

export async function stats(code: string): Promise<LinkDoc | null> {
  return findByCode(code);
}
