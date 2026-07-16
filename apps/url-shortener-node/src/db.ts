import { MongoClient, Db, Collection } from "mongodb";
import { config } from "./config.js";

export interface LinkDoc {
  short_code: string;
  long_url: string;
  owner: string | null;
  metadata: Record<string, unknown> | null;
  click_count: number;
  created_at: Date;
  expires_at: Date | null;
}
export interface CounterDoc { _id: string; seq: number; }

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.mongoUrl);
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  return db;
}

async function ensureIndexes(d: Db): Promise<void> {
  const links = d.collection<LinkDoc>("links");
  await links.createIndex({ short_code: 1 }, { unique: true });
  // Native TTL: Mongo auto-deletes docs once expires_at passes. Beats a hand-written sweeper.
  await links.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
}

export function links(d: Db): Collection<LinkDoc> { return d.collection<LinkDoc>("links"); }
export function counters(d: Db): Collection<CounterDoc> { return d.collection<CounterDoc>("counters"); }

export async function closeDb(): Promise<void> {
  await client?.close();
  client = null; db = null;
}
