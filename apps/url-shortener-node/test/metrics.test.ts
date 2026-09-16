import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.js";
import { closeDb } from "../src/db.js";
import { closeRedis } from "../src/cache.js";
import { httpLatency, cacheHits } from "../src/metrics.js";
import { LATENCY_BUCKETS_S, SLO_THRESHOLD_S } from "../src/otel.js";

const app = buildApp();
before(async () => { await app.ready(); });
after(async () => { await app.close(); await closeDb(); await closeRedis(); });

test("latency buckets contain the SLO threshold exactly", () => {
  // The SLI is good/total counted from bucket counts at or below 50ms.
  // Lose this boundary and the error budget can only be interpolated, which
  // is not the same number and not defensible.
  assert.ok(
    (LATENCY_BUCKETS_S as readonly number[]).includes(SLO_THRESHOLD_S),
    `bucket boundaries must include the ${SLO_THRESHOLD_S}s SLO threshold`,
  );
});

test("latency buckets straddle the threshold and are strictly ascending", () => {
  const b = [...LATENCY_BUCKETS_S];
  assert.deepEqual(b, [...b].sort((x, y) => x - y), "buckets must ascend");
  assert.equal(new Set(b).size, b.length, "buckets must be unique");
  assert.ok(b.some((x) => x < SLO_THRESHOLD_S), "need a bucket below the threshold");
  assert.ok(b.some((x) => x > SLO_THRESHOLD_S), "need a bucket above the threshold");
});

test("instruments are safe no-ops when OTEL_ENABLED is unset", () => {
  // No MeterProvider is registered in tests, so these resolve to no-op
  // instruments. Recording must still be harmless — telemetry must never be
  // able to break request handling.
  assert.doesNotThrow(() => {
    httpLatency.record(0.012, { method: "GET", route: "/:code", status: "302" });
    cacheHits.add(1);
  });
});

test("the prom-client /metrics route is gone", async () => {
  // Metrics now leave over OTLP; a scrape endpoint would be a second, silently
  // diverging source of truth.
  const res = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(res.statusCode, 404);
});
