import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getDb, counters, closeDb } from "../src/db.js";
import { makeAllocator } from "../src/modules/links/idrange.js";

before(async () => { await getDb(); });
beforeEach(async () => { const db = await getDb(); await counters(db).deleteMany({}); });
after(async () => { await closeDb(); });

test("nextId yields strictly increasing ids starting at 1", async () => {
  const alloc = makeAllocator("test-a");
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) ids.push(await alloc.nextId());
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
});

test("concurrent allocators never hand out a duplicate id", async () => {
  const allocs = [makeAllocator("test-b"), makeAllocator("test-b"), makeAllocator("test-b")];
  const results = await Promise.all(
    allocs.flatMap((a) => Array.from({ length: 400 }, () => a.nextId())),
  );
  assert.equal(new Set(results).size, results.length); // all unique
});
