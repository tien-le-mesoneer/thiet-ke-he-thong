import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.js";
import { closeDb } from "../src/db.js";
import { closeRedis } from "../src/cache.js";

const app = buildApp();
before(async () => { await app.ready(); });
after(async () => { await app.close(); await closeDb(); await closeRedis(); });

test("GET /metrics exposes prometheus metrics incl. latency histogram", async () => {
  await app.inject({ method: "GET", url: "/health" }); // generate one observation
  const res = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /http_request_duration_seconds/);
  assert.match(res.body, /cache_hits_total|cache_misses_total/);
});
