import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getRedis, closeRedis, cacheGet, cacheSet, incrClick, drainClicks } from "../src/cache.js";

before(() => { getRedis(); });
beforeEach(async () => { await getRedis().flushdb(); });
after(async () => { await closeRedis(); });

test("set then get returns the url", async () => {
  await cacheSet("abc1234", "https://example.com", 60);
  assert.equal(await cacheGet("abc1234"), "https://example.com");
});

test("get returns null on miss", async () => {
  assert.equal(await cacheGet("nope"), null);
});

test("incrClick accumulates and drainClicks returns then clears", async () => {
  await incrClick("abc1234"); await incrClick("abc1234"); await incrClick("xyz9876");
  const drained = await drainClicks();
  assert.equal(drained["abc1234"], 2);
  assert.equal(drained["xyz9876"], 1);
  assert.deepEqual(await drainClicks(), {}); // cleared after drain
});
