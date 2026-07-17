import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, links, counters, closeDb } from "../src/db.js";
import type { LinkDoc } from "../src/db.js";

// Simulate Redis being fully down: every cache.js operation rejects.
// Fix 1 (service.resolve) must still succeed by falling back to Mongo directly.
const cacheMock = mock.module("../src/cache.js", {
  namedExports: {
    cacheGet: async () => { throw new Error("ECONNREFUSED: redis down"); },
    cacheSet: async () => { throw new Error("ECONNREFUSED: redis down"); },
    incrClick: async () => { throw new Error("ECONNREFUSED: redis down"); },
    drainClicks: async () => ({}) as Record<string, number>,
  },
});

const { resolve } = await import("../src/modules/links/service.js");

before(async () => {
  const db = await getDb();
  await links(db).deleteMany({});
  await counters(db).deleteMany({});
});

after(async () => {
  cacheMock.restore();
  await closeDb();
});

test("resolve() falls back to Mongo and still returns the url when Redis is down", async () => {
  const db = await getDb();
  const doc: LinkDoc = {
    short_code: "redisdown1",
    long_url: "https://example.com/redis-down-fallback",
    owner: null,
    metadata: null,
    click_count: 0,
    created_at: new Date(),
    expires_at: null,
  };
  await links(db).insertOne(doc);

  const url = await resolve("redisdown1");
  assert.equal(url, "https://example.com/redis-down-fallback");
});

test("resolve() returns null for an unknown code even when Redis is down", async () => {
  const url = await resolve("doesnotexist-redisdown");
  assert.equal(url, null);
});
