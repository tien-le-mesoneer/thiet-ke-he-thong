import { createHash } from "node:crypto";
import { getDb, links, type LinkDoc } from "../../db.js";

// Shard routing seam: today SHARD_COUNT=1, so every code maps to shard 0 and we run
// one Mongo. Flip SHARD_COUNT (and wire a client-per-shard map in getDb) to shard by
// hashed short_code with zero call-site changes. Trigger point: shard only past
// single-node storage/throughput limits (multi-TB or >~10k QPS).
const SHARD_COUNT = 1;

export function shardFor(code: string): number {
  const h = createHash("md5").update(code).digest();
  return h.readUInt32BE(0) % SHARD_COUNT;
}

export async function insertLink(doc: LinkDoc): Promise<void> {
  const db = await getDb();
  await links(db).insertOne(doc);
}

export async function findByCode(code: string): Promise<LinkDoc | null> {
  const db = await getDb();
  return links(db).findOne({ short_code: code });
}

export async function bumpClicks(counts: Record<string, number>): Promise<void> {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return;
  const db = await getDb();
  await links(db).bulkWrite(
    entries.map(([short_code, n]) => ({
      updateOne: { filter: { short_code }, update: { $inc: { click_count: n } } },
    })),
  );
}
