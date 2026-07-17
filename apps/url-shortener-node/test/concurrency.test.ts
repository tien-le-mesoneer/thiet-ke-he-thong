import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.js";
import { getDb, links, counters, closeDb } from "../src/db.js";
import { getRedis, closeRedis } from "../src/cache.js";

const app = buildApp();
before(async () => { await app.ready(); });
beforeEach(async () => {
  const db = await getDb(); await links(db).deleteMany({}); await counters(db).deleteMany({}); await getRedis().flushdb();
});
after(async () => { await app.close(); await closeDb(); await closeRedis(); });

test("200 concurrent shortens all produce unique codes", async () => {
  const results = await Promise.all(
    Array.from({ length: 200 }, () =>
      app.inject({ method: "POST", url: "/api/v1/urls", payload: { longUrl: "https://x.y/z" } })
        .then((r) => r.json().code as string)),
  );
  assert.equal(new Set(results).size, 200); // no collisions under contention
});
