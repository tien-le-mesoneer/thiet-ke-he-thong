import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getDb, links, closeDb, type LinkDoc } from "../src/db.js";
import { insertLink, findByCode, bumpClicks, shardFor } from "../src/modules/links/repo.js";

before(async () => { await getDb(); });
beforeEach(async () => { const db = await getDb(); await links(db).deleteMany({}); });
after(async () => { await closeDb(); });

function doc(code: string): LinkDoc {
  return { short_code: code, long_url: "https://example.com/x", owner: null, metadata: null,
    click_count: 0, created_at: new Date(), expires_at: null };
}

test("insert then find by code", async () => {
  await insertLink(doc("abc1234"));
  const found = await findByCode("abc1234");
  assert.equal(found?.long_url, "https://example.com/x");
});

test("findByCode returns null for unknown code", async () => {
  assert.equal(await findByCode("missing"), null);
});

test("bumpClicks increments the stored counter", async () => {
  await insertLink(doc("abc1234"));
  await bumpClicks({ abc1234: 5 });
  assert.equal((await findByCode("abc1234"))?.click_count, 5);
});

test("shardFor is deterministic and in range", () => {
  const s = shardFor("abc1234");
  assert.equal(s, shardFor("abc1234"));
  assert.ok(s >= 0 && s < 1); // single shard now
});
