import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getDb, links, closeDb, type LinkDoc } from "../src/db.js";
import { getRedis, closeRedis, incrClick } from "../src/cache.js";
import { insertLink } from "../src/modules/links/repo.js";
import { flushOnce } from "../src/modules/links/clicks.js";

before(async () => { await getDb(); });
beforeEach(async () => { const db = await getDb(); await links(db).deleteMany({}); await getRedis().flushdb(); });
after(async () => { await closeDb(); await closeRedis(); });

test("flushOnce moves buffered clicks from redis into mongo", async () => {
  const doc: LinkDoc = { short_code: "abc1234", long_url: "https://x.y", owner: null, metadata: null,
    click_count: 0, created_at: new Date(), expires_at: null };
  await insertLink(doc);
  await incrClick("abc1234"); await incrClick("abc1234");
  const n = await flushOnce();
  assert.equal(n, 1); // one code flushed
  const db = await getDb();
  assert.equal((await links(db).findOne({ short_code: "abc1234" }))?.click_count, 2);
});
