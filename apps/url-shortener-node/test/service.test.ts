import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.js";
import { getDb, links, counters, closeDb } from "../src/db.js";
import { getRedis, closeRedis } from "../src/cache.js";

const app = buildApp();
before(async () => { await app.ready(); });
beforeEach(async () => {
  const db = await getDb();
  await links(db).deleteMany({}); await counters(db).deleteMany({});
  await getRedis().flushdb();
});
after(async () => { await app.close(); await closeDb(); await closeRedis(); });

test("POST /api/v1/urls returns a code, GET /:code 302-redirects", async () => {
  const create = await app.inject({ method: "POST", url: "/api/v1/urls",
    payload: { longUrl: "https://example.com/very/long" } });
  assert.equal(create.statusCode, 201);
  const code = create.json().code as string;
  assert.ok(code.length >= 7);

  const redirect = await app.inject({ method: "GET", url: `/${code}` });
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, "https://example.com/very/long");
});

test("POST rejects a non-http(s) url with 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/v1/urls", payload: { longUrl: "ftp://x" } });
  assert.equal(res.statusCode, 400);
});

test("GET unknown code returns 404", async () => {
  const res = await app.inject({ method: "GET", url: "/doesnotexist" });
  assert.equal(res.statusCode, 404);
});

test("stats endpoint reflects a click after a redirect (via flush path)", async () => {
  const create = await app.inject({ method: "POST", url: "/api/v1/urls", payload: { longUrl: "https://a.b/c" } });
  const code = create.json().code as string;
  await app.inject({ method: "GET", url: `/${code}` });
  const stats = await app.inject({ method: "GET", url: `/api/v1/urls/${code}` });
  assert.equal(stats.statusCode, 200);
  assert.equal(stats.json().longUrl, "https://a.b/c");
});
