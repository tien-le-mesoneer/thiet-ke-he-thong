import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.js";
import { closeDb } from "../src/db.js";
import { closeRedis } from "../src/cache.js";

const app = buildApp();
before(async () => { await app.ready(); });
after(async () => { await app.close(); await closeDb(); await closeRedis(); });

test("GET /health returns ok when mongo+redis are up", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "ok");
});
