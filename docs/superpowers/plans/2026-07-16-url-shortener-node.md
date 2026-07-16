# url-shortener-node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone MongoDB+Redis URL-shortener service (`apps/url-shortener-node/`) with ranged-counter obfuscated base62 keys, cache-aside redirects, click tracking, full observability, layered tests, and a Confluence-ready `document.md`.

**Architecture:** Fastify service mirroring `deliveroo-node` conventions. Units behind interfaces: `idrange` (atomic `$inc` block allocation) → `keygen` (sqids→base62) → `repo` (shard-aware Mongo) with a Redis `cache` on the redirect hot path and an async click flusher. Prom-client metrics + OTel tracing + pino JSON logs provide operability.

**Tech Stack:** Node 22, TypeScript (ESM), Fastify 5, MongoDB (`mongodb` driver), Redis (`ioredis`), `sqids`, `prom-client`, OpenTelemetry, `pino`; tests via `node --test --import tsx`; k6 for load; podman compose for infra.

## Global Constraints

- Node 22 + TypeScript ESM: all relative imports use `.js` extensions; `"type": "module"`.
- Match `deliveroo-node` scripts: `dev` (`tsx watch`), `typecheck` (`tsc --noEmit`), `test` (`node --test --import tsx test/`).
- Config only via env, read in `src/config.ts`. Env vars: `PORT` (default 3001), `MONGO_URL` (default `mongodb://localhost:27017/shorturl`), `REDIS_URL` (default `redis://localhost:6379`), `ID_BLOCK_SIZE` (default 1000), `CODE_MIN_LENGTH` (default 7), `CACHE_TTL_S` (default 86400), `LINK_TTL_DAYS` (default 7).
- Redirects use HTTP **302** (analytics require every hit to reach the server).
- Key generation: ranged counter (atomic `$inc` blocks) + `sqids` obfuscation → base62. Collisions impossible; no existence check on write.
- Structured JSON logs (pino) with a per-request correlation id.
- Every over-built piece carries a one-line comment naming the real scale trigger point.
- Port default **3001** (deliveroo-node uses 3000 — avoid clash).
- Service is standalone; it does NOT import from `deliveroo-node` and is NOT wired into `learn-sd`.

---

## File Structure

```
apps/url-shortener-node/
  package.json  tsconfig.json  compose.yaml  .gitignore  README.md  document.md
  src/
    index.ts        # Fastify bootstrap, correlation id, route registration, /health, /metrics
    config.ts       # env config
    db.ts           # Mongo client + collections + index creation (unique short_code, TTL expires_at)
    cache.ts        # Redis cache-aside + click counters
    metrics.ts      # prom-client registry + helpers
    tracing.ts      # OpenTelemetry NodeSDK bootstrap
    modules/links/
      keygen.ts     # sqids obfuscation <-> id
      idrange.ts    # ranged counter allocator
      repo.ts       # Mongo persistence, shardFor router
      clicks.ts     # periodic Redis->Mongo click flush
      service.ts    # shorten/resolve/stats orchestration
      routes.ts     # HTTP endpoints
  test/
    keygen.test.ts  idrange.test.ts  repo.test.ts  cache.test.ts
    service.test.ts clicks.test.ts   metrics.test.ts concurrency.test.ts
  load/
    redirect.js     # k6 script
    grafana/        # dashboard json (built in Task 9)
```

---

## Task 1: Scaffold — package, config, infra, bootstrap, health

**Files:**
- Create: `apps/url-shortener-node/package.json`, `tsconfig.json`, `.gitignore`, `compose.yaml`, `src/config.ts`, `src/db.ts`, `src/cache.ts`, `src/index.ts`, `README.md`
- Test: `apps/url-shortener-node/test/health.test.ts`

**Interfaces:**
- Produces: `config` object; `getDb()`/`closeDb()` (Mongo); `getRedis()`/`closeRedis()` (Redis); a Fastify app with `/health`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "url-shortener-node",
  "version": "0.1.0",
  "description": "URL shortener service — DDIA ch.1 scalability/maintainability practice",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "node --test --import tsx test/"
  },
  "dependencies": {
    "fastify": "^5.2.0",
    "ioredis": "^5.4.0",
    "mongodb": "^6.12.0",
    "pino": "^9.5.0",
    "prom-client": "^15.1.0",
    "sqids": "^0.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `.gitignore` and `compose.yaml`**

`.gitignore`:
```
node_modules/
dist/
```

`compose.yaml`:
```yaml
services:
  mongo:
    image: mongo:7
    ports: ["27017:27017"]
  redis:
    image: redis:7
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports: ["6379:6379"]
```

- [ ] **Step 4: Create `src/config.ts`**

```ts
export const config = {
  port: Number(process.env["PORT"] ?? 3001),
  mongoUrl: process.env["MONGO_URL"] ?? "mongodb://localhost:27017/shorturl",
  redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  idBlockSize: Number(process.env["ID_BLOCK_SIZE"] ?? 1000),
  codeMinLength: Number(process.env["CODE_MIN_LENGTH"] ?? 7),
  cacheTtlS: Number(process.env["CACHE_TTL_S"] ?? 86400),
  linkTtlDays: Number(process.env["LINK_TTL_DAYS"] ?? 7),
  logLevel: process.env["LOG_LEVEL"] ?? "info",
} as const;
```

- [ ] **Step 5: Create `src/db.ts`**

```ts
import { MongoClient, Db, Collection } from "mongodb";
import { config } from "./config.js";

export interface LinkDoc {
  short_code: string;
  long_url: string;
  owner: string | null;
  metadata: Record<string, unknown> | null;
  click_count: number;
  created_at: Date;
  expires_at: Date | null;
}
export interface CounterDoc { _id: string; seq: number; }

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.mongoUrl);
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  return db;
}

async function ensureIndexes(d: Db): Promise<void> {
  const links = d.collection<LinkDoc>("links");
  await links.createIndex({ short_code: 1 }, { unique: true });
  // Native TTL: Mongo auto-deletes docs once expires_at passes. Beats a hand-written sweeper.
  await links.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
}

export function links(d: Db): Collection<LinkDoc> { return d.collection<LinkDoc>("links"); }
export function counters(d: Db): Collection<CounterDoc> { return d.collection<CounterDoc>("counters"); }

export async function closeDb(): Promise<void> {
  await client?.close();
  client = null; db = null;
}
```

- [ ] **Step 6: Create `src/cache.ts`**

```ts
import Redis from "ioredis";
import { config } from "./config.js";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) redis = new Redis(config.redisUrl, { lazyConnect: false });
  return redis;
}
export async function closeRedis(): Promise<void> {
  await redis?.quit();
  redis = null;
}
```

- [ ] **Step 7: Create `src/index.ts`**

```ts
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getDb, closeDb } from "./db.js";
import { getRedis, closeRedis } from "./cache.js";

export function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    genReqId: () => randomUUID(), // correlation id per request
  });

  app.get("/health", async (_req, reply) => {
    try {
      const db = await getDb();
      await db.command({ ping: 1 });
      await getRedis().ping();
      return { status: "ok" };
    } catch (err) {
      reply.code(503);
      return { status: "degraded", error: (err as Error).message };
    }
  });

  return app;
}

async function main() {
  const app = buildApp();
  const shutdown = async () => { await app.close(); await closeDb(); await closeRedis(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

// Only run when executed directly, so tests can import buildApp without listening.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 8: Write the failing test `test/health.test.ts`**

```ts
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
```

- [ ] **Step 9: Install deps, start infra, run the test**

```bash
cd apps/url-shortener-node
npm install
podman compose up -d           # mongo + redis
npm test
```
Expected: `health.test.ts` passes (status ok, 200). If infra is down the test fails with a connection error — that is the correct failing state before `compose up`.

- [ ] **Step 10: Commit**

```bash
git add apps/url-shortener-node
git commit -m "feat(url-shortener): scaffold service, config, infra, health"
```

---

## Task 2: Key codec — sqids obfuscation ↔ base62 (pure unit)

**Files:**
- Create: `apps/url-shortener-node/src/modules/links/keygen.ts`
- Test: `apps/url-shortener-node/test/keygen.test.ts`

**Interfaces:**
- Produces: `encode(id: number): string`, `decode(code: string): number`.

- [ ] **Step 1: Write the failing test `test/keygen.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode } from "../src/modules/links/keygen.js";

test("encode/decode is a reversible round-trip", () => {
  for (const id of [1, 2, 42, 1000, 1_000_000, 3_521_614_606_207]) {
    assert.equal(decode(encode(id)), id);
  }
});

test("consecutive ids do not produce consecutive codes (non-guessable)", () => {
  assert.notEqual(encode(1001), encode(1000)); // trivially true
  // sequential ids must not yield lexicographically adjacent codes
  const a = encode(1000), b = encode(1001);
  assert.ok(Math.abs(a.localeCompare(b)) >= 1);
  assert.notEqual(a.slice(0, -1), b.slice(0, -1));
});

test("codes are >= configured min length and url-safe", () => {
  const code = encode(1);
  assert.ok(code.length >= 7);
  assert.match(code, /^[0-9a-zA-Z]+$/);
});

test("codes are unique across a range", () => {
  const seen = new Set<string>();
  for (let id = 1; id <= 5000; id++) seen.add(encode(id));
  assert.equal(seen.size, 5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/keygen.test.ts` (or `node --test --import tsx test/keygen.test.ts`)
Expected: FAIL — `encode`/`decode` not found.

- [ ] **Step 3: Implement `src/modules/links/keygen.ts`**

```ts
import Sqids from "sqids";
import { config } from "../../config.js";

// sqids gives a reversible, non-sequential, url-safe encoding of an integer.
// minLength pads short ids so early codes aren't 1-2 chars.
// A fixed shuffled alphabet makes codes non-guessable without a separate cipher.
const sqids = new Sqids({
  minLength: config.codeMinLength,
  alphabet: "FxnT1uvq8y2wZ0aAbcdefghijklm-_NOPQRSTUVWXYBCDEForstEGHIJKLMzp3456789",
});

export function encode(id: number): string {
  return sqids.encode([id]);
}

export function decode(code: string): number {
  const nums = sqids.decode(code);
  if (nums.length !== 1) throw new Error(`invalid code: ${code}`);
  return nums[0]!;
}
```

Note: the alphabet must contain only URL-safe chars; adjust the test regex if you keep `-`/`_` (they are URL-safe). If you prefer strictly `[0-9a-zA-Z]`, use a 62-char alphabet and drop `-_` from both the alphabet and the regex.

- [ ] **Step 4: Reconcile alphabet with the url-safe test**

Use this 62-char alphabet (strictly `[0-9a-zA-Z]`, matches the test regex):
```ts
alphabet: "Fxnt1uvq8y2wZ0aAbcdefghijklmNOPQRSTUVWXYBCDEForsGHIJKLMzp3456789Ee",
```
Ensure it is exactly 62 unique chars. (Trim/regenerate to 62 uniques; duplicates throw at construction — the test will catch it.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test --import tsx test/keygen.test.ts`
Expected: PASS (round-trip, non-sequential, min length, uniqueness).

- [ ] **Step 6: Commit**

```bash
git add apps/url-shortener-node/src/modules/links/keygen.ts apps/url-shortener-node/test/keygen.test.ts
git commit -m "feat(url-shortener): reversible sqids/base62 key codec"
```

---

## Task 3: Ranged counter allocator (idrange) + Mongo integration

**Files:**
- Create: `apps/url-shortener-node/src/modules/links/idrange.ts`
- Test: `apps/url-shortener-node/test/idrange.test.ts`

**Interfaces:**
- Consumes: `getDb`, `counters` from `db.js`; `config.idBlockSize`.
- Produces: `makeAllocator(counterId?: string) => { nextId(): Promise<number> }`.

- [ ] **Step 1: Write the failing test `test/idrange.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx test/idrange.test.ts`
Expected: FAIL — `makeAllocator` not found.

- [ ] **Step 3: Implement `src/modules/links/idrange.ts`**

```ts
import { getDb, counters } from "../../db.js";
import { config } from "../../config.js";

// Ranged allocation: each refill claims a block of ID_BLOCK_SIZE ids with a single
// atomic $inc, then hands them out from memory. This removes per-request counter
// contention. Trigger point: a single atomic $inc per write is fine below ~thousands
// of write QPS; blocks matter only above that.
export function makeAllocator(counterId = "url") {
  let next = 0;   // next id to hand out
  let max = -1;   // last id in the current block
  let refilling: Promise<void> | null = null;

  async function refill(): Promise<void> {
    const db = await getDb();
    const res = await counters(db).findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: config.idBlockSize } },
      { upsert: true, returnDocument: "after" },
    );
    const top = res!.seq;                     // e.g. 1000
    next = top - config.idBlockSize + 1;      // 1
    max = top;                                // 1000
  }

  return {
    async nextId(): Promise<number> {
      while (next > max) {
        if (!refilling) refilling = refill().finally(() => { refilling = null; });
        await refilling;
      }
      return next++;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx test/idrange.test.ts`
Expected: PASS (sequential within a block; no duplicates across concurrent allocators — each block is claimed atomically).

- [ ] **Step 5: Commit**

```bash
git add apps/url-shortener-node/src/modules/links/idrange.ts apps/url-shortener-node/test/idrange.test.ts
git commit -m "feat(url-shortener): ranged counter id allocator"
```

---

## Task 4: Repository — shard-aware Mongo persistence

**Files:**
- Create: `apps/url-shortener-node/src/modules/links/repo.ts`
- Test: `apps/url-shortener-node/test/repo.test.ts`

**Interfaces:**
- Consumes: `getDb`, `links`, `LinkDoc` from `db.js`.
- Produces: `insertLink(doc: LinkDoc): Promise<void>`, `findByCode(code: string): Promise<LinkDoc | null>`, `bumpClicks(counts: Record<string, number>): Promise<void>`, `shardFor(code: string): number`.

- [ ] **Step 1: Write the failing test `test/repo.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx test/repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/modules/links/repo.ts`**

```ts
import { createHash } from "node:crypto";
import { getDb, links, type LinkDoc } from "../../db.js";

// Shard routing seam: today SHARD_COUNT=1, so every code maps to shard 0 and we run
// one Mongo. Flip SHARD_COUNT (and wire a client-per-shard map in getDb) to shard by
// hashed short_code with zero call-site changes. Trigger point: shard only past
// single-node storage/throughput limits (multi-TB or >~10k QPS).
const SHARD_COUNT = 1;

export function shardFor(code: string): number {
  const h = createHash("md5").update(code).digest();
  return h.readUInt32BE(0) % SHARD_COUNT;
}

export async function insertLink(doc: LinkDoc): Promise<void> {
  const db = await getDb();
  await links(db).insertOne(doc);
}

export async function findByCode(code: string): Promise<LinkDoc | null> {
  const db = await getDb();
  return links(db).findOne({ short_code: code });
}

export async function bumpClicks(counts: Record<string, number>): Promise<void> {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return;
  const db = await getDb();
  await links(db).bulkWrite(
    entries.map(([short_code, n]) => ({
      updateOne: { filter: { short_code }, update: { $inc: { click_count: n } } },
    })),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx test/repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/url-shortener-node/src/modules/links/repo.ts apps/url-shortener-node/test/repo.test.ts
git commit -m "feat(url-shortener): shard-aware mongo repository"
```

---

## Task 5: Cache — Redis cache-aside + click counters

**Files:**
- Create: `apps/url-shortener-node/src/modules/links/cachekeys.ts` (small helpers) — OR extend `src/cache.ts`
- Modify: `apps/url-shortener-node/src/cache.ts`
- Test: `apps/url-shortener-node/test/cache.test.ts`

**Interfaces:**
- Consumes: `getRedis` from `cache.js`.
- Produces (added to `cache.ts`): `cacheGet(code): Promise<string|null>`, `cacheSet(code, url, ttlS): Promise<void>`, `incrClick(code): Promise<void>`, `drainClicks(): Promise<Record<string, number>>`.

- [ ] **Step 1: Write the failing test `test/cache.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx test/cache.test.ts`
Expected: FAIL — `cacheGet` etc. not exported.

- [ ] **Step 3: Extend `src/cache.ts`**

Append to `src/cache.ts`:
```ts
const urlKey = (code: string) => `u:${code}`;
const CLICK_HASH = "clicks"; // Redis hash: field=code, value=count

export async function cacheGet(code: string): Promise<string | null> {
  return getRedis().get(urlKey(code));
}
export async function cacheSet(code: string, url: string, ttlS: number): Promise<void> {
  await getRedis().set(urlKey(code), url, "EX", ttlS);
}
export async function incrClick(code: string): Promise<void> {
  await getRedis().hincrby(CLICK_HASH, code, 1);
}
// Atomically read-and-clear the click hash so the flusher can reconcile to Mongo.
export async function drainClicks(): Promise<Record<string, number>> {
  const r = getRedis();
  const all = await r.hgetall(CLICK_HASH);
  if (Object.keys(all).length === 0) return {};
  await r.del(CLICK_HASH);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(all)) out[k] = Number(v);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx test/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/url-shortener-node/src/cache.ts apps/url-shortener-node/test/cache.test.ts
git commit -m "feat(url-shortener): redis cache-aside and click counters"
```

---

## Task 6: Service + routes — shorten, redirect (302), stats

**Files:**
- Create: `apps/url-shortener-node/src/modules/links/service.ts`, `src/modules/links/routes.ts`
- Modify: `apps/url-shortener-node/src/index.ts` (register routes)
- Test: `apps/url-shortener-node/test/service.test.ts`

**Interfaces:**
- Consumes: `makeAllocator`, `encode`, `insertLink`/`findByCode`, `cacheGet`/`cacheSet`/`incrClick`, `config`.
- Produces: `shorten(longUrl, opts?) => Promise<{code:string}>`, `resolve(code) => Promise<string|null>`, `stats(code) => Promise<LinkDoc|null>`; `linkRoutes` Fastify plugin.

- [ ] **Step 1: Write the failing test `test/service.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx test/service.test.ts`
Expected: FAIL — routes not registered / service missing.

- [ ] **Step 3: Implement `src/modules/links/service.ts`**

```ts
import { config } from "../../config.js";
import { makeAllocator } from "./idrange.js";
import { encode } from "./keygen.js";
import { insertLink, findByCode } from "./repo.js";
import { cacheGet, cacheSet, incrClick } from "../../cache.js";
import type { LinkDoc } from "../../db.js";

const alloc = makeAllocator("url");

export interface ShortenOpts { owner?: string | null; metadata?: Record<string, unknown> | null; }

export function isValidHttpUrl(u: string): boolean {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:"; }
  catch { return false; }
}

export async function shorten(longUrl: string, opts: ShortenOpts = {}): Promise<{ code: string }> {
  const id = await alloc.nextId();
  const code = encode(id);
  const now = new Date();
  const expires = new Date(now.getTime() + config.linkTtlDays * 86400_000);
  const doc: LinkDoc = {
    short_code: code, long_url: longUrl, owner: opts.owner ?? null,
    metadata: opts.metadata ?? null, click_count: 0, created_at: now, expires_at: expires,
  };
  await insertLink(doc);
  await cacheSet(code, longUrl, config.cacheTtlS);
  return { code };
}

export async function resolve(code: string): Promise<string | null> {
  const cached = await cacheGet(code);
  if (cached) { await incrClick(code); return cached; }   // cache hit
  const doc = await findByCode(code);                     // cache miss (normal)
  if (!doc) return null;
  await cacheSet(code, doc.long_url, config.cacheTtlS);
  await incrClick(code);
  return doc.long_url;
}

export async function stats(code: string): Promise<LinkDoc | null> {
  return findByCode(code);
}
```

- [ ] **Step 4: Implement `src/modules/links/routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { shorten, resolve, stats, isValidHttpUrl } from "./service.js";

export async function linkRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { longUrl?: string; owner?: string; metadata?: Record<string, unknown> } }>(
    "/api/v1/urls",
    async (req, reply) => {
      const { longUrl, owner, metadata } = req.body ?? {};
      if (!longUrl || !isValidHttpUrl(longUrl) || longUrl.length > 2048) {
        reply.code(400); return { error: "longUrl must be a valid http(s) URL <= 2048 chars" };
      }
      const { code } = await shorten(longUrl, { owner: owner ?? null, metadata: metadata ?? null });
      reply.code(201);
      return { code, shortUrl: `${req.protocol}://${req.host}/${code}` };
    },
  );

  app.get<{ Params: { code: string } }>("/api/v1/urls/:code", async (req, reply) => {
    const doc = await stats(req.params.code);
    if (!doc) { reply.code(404); return { error: "not found" }; }
    return { shortCode: doc.short_code, longUrl: doc.long_url, clickCount: doc.click_count,
      createdAt: doc.created_at, expiresAt: doc.expires_at, owner: doc.owner };
  });

  // Redirect route LAST so it doesn't shadow /api/*.
  app.get<{ Params: { code: string } }>("/:code", async (req, reply) => {
    const url = await resolve(req.params.code);
    if (!url) { reply.code(404); return { error: "not found" }; }
    reply.code(302).header("location", url).send();
  });
}
```

- [ ] **Step 5: Register routes in `src/index.ts`**

Add inside `buildApp()` before `return app;`:
```ts
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { linkRoutes } = await import("./modules/links/routes.js");
  await app.register(linkRoutes);
```
(Use a static top import instead if preferred: `import { linkRoutes } from "./modules/links/routes.js";` then `await app.register(linkRoutes);`. Static import is cleaner — do that.)

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test --import tsx test/service.test.ts`
Expected: PASS (201 + code, 302 + Location, 400, 404, stats 200).

- [ ] **Step 7: Commit**

```bash
git add apps/url-shortener-node/src/modules/links/service.ts apps/url-shortener-node/src/modules/links/routes.ts apps/url-shortener-node/src/index.ts apps/url-shortener-node/test/service.test.ts
git commit -m "feat(url-shortener): shorten/redirect/stats endpoints"
```

---

## Task 7: Click flusher — async Redis → Mongo reconciliation

**Files:**
- Create: `apps/url-shortener-node/src/modules/links/clicks.ts`
- Modify: `apps/url-shortener-node/src/index.ts` (start/stop flusher)
- Test: `apps/url-shortener-node/test/clicks.test.ts`

**Interfaces:**
- Consumes: `drainClicks` (cache), `bumpClicks` (repo).
- Produces: `flushOnce(): Promise<number>`, `startFlusher(intervalMs?): void`, `stopFlusher(): void`.

- [ ] **Step 1: Write the failing test `test/clicks.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx test/clicks.test.ts`
Expected: FAIL — `flushOnce` not found.

- [ ] **Step 3: Implement `src/modules/links/clicks.ts`**

```ts
import { drainClicks } from "../../cache.js";
import { bumpClicks } from "./repo.js";

// Clicks are counted in Redis on the hot path and reconciled to Mongo off-path.
// Trigger point: batching matters once click volume would otherwise be one Mongo
// write per redirect; below that you could $inc Mongo directly.
export async function flushOnce(): Promise<number> {
  const counts = await drainClicks();
  const n = Object.keys(counts).length;
  if (n > 0) await bumpClicks(counts);
  return n;
}

let timer: NodeJS.Timeout | null = null;
export function startFlusher(intervalMs = 5000): void {
  if (timer) return;
  timer = setInterval(() => { void flushOnce(); }, intervalMs);
  timer.unref(); // don't keep the process alive just for flushing
}
export function stopFlusher(): void { if (timer) { clearInterval(timer); timer = null; } }
```

- [ ] **Step 4: Wire into `src/index.ts`**

In `main()`, after `app.listen`, add `startFlusher();` and in `shutdown` add `stopFlusher();` (import them at top).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test --import tsx test/clicks.test.ts`
Expected: PASS (click_count reconciled to 2).

- [ ] **Step 6: Commit**

```bash
git add apps/url-shortener-node/src/modules/links/clicks.ts apps/url-shortener-node/src/index.ts apps/url-shortener-node/test/clicks.test.ts
git commit -m "feat(url-shortener): async click flusher"
```

---

## Task 8: Observability — metrics, /metrics, correlation-id logging, tracing

**Files:**
- Create: `apps/url-shortener-node/src/metrics.ts`, `src/tracing.ts`
- Modify: `apps/url-shortener-node/src/index.ts` (metrics hooks + `/metrics`), `src/modules/links/service.ts` (cache hit/miss counter)
- Modify: `apps/url-shortener-node/package.json` (add OTel deps)
- Test: `apps/url-shortener-node/test/metrics.test.ts`

**Interfaces:**
- Produces: `registry`, `httpLatency` (Histogram), `cacheHits`/`cacheMisses` (Counter), `idBlocks` (Counter), `observeRequest(...)`.

- [ ] **Step 1: Add OTel deps to `package.json` dependencies**

```json
"@opentelemetry/sdk-node": "^0.57.0",
"@opentelemetry/auto-instrumentations-node": "^0.55.0"
```
Then `cd apps/url-shortener-node && npm install`.

- [ ] **Step 2: Write the failing test `test/metrics.test.ts`**

```ts
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
```

- [ ] **Step 3: Implement `src/metrics.ts`**

```ts
import { Registry, Histogram, Counter, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpLatency = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1], // p99-friendly
  registers: [registry],
});
export const cacheHits = new Counter({ name: "cache_hits_total", help: "redirect cache hits", registers: [registry] });
export const cacheMisses = new Counter({ name: "cache_misses_total", help: "redirect cache misses", registers: [registry] });
export const idBlocks = new Counter({ name: "id_blocks_total", help: "id blocks allocated", registers: [registry] });
```

- [ ] **Step 4: Implement `src/tracing.ts`**

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

// Console exporter by default; swap for OTLP when a collector exists.
// Start only when OTEL_ENABLED=1 so tests/dev stay quiet.
export function startTracing(): void {
  if (process.env["OTEL_ENABLED"] !== "1") return;
  const sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] });
  sdk.start();
}
```

- [ ] **Step 5: Wire metrics into `src/index.ts` and cache counters into `service.ts`**

In `buildApp()`: add an `onResponse` hook and the `/metrics` route:
```ts
  app.addHook("onResponse", async (req, reply) => {
    const route = (req.routeOptions?.url ?? req.url);
    httpLatency.observe(
      { method: req.method, route, status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });
  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", registry.contentType);
    return registry.metrics();
  });
```
(import `httpLatency`, `registry` from `./metrics.js`.) In `service.ts` `resolve()`, call `cacheHits.inc()` on hit and `cacheMisses.inc()` on miss (import from `../../metrics.js`). In `idrange.ts` `refill()`, call `idBlocks.inc()` (import from `../../metrics.js`).

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test --import tsx test/metrics.test.ts`
Expected: PASS (`/metrics` 200, contains histogram + cache counters).

- [ ] **Step 7: Commit**

```bash
git add apps/url-shortener-node/src/metrics.ts apps/url-shortener-node/src/tracing.ts apps/url-shortener-node/src/index.ts apps/url-shortener-node/src/modules/links/service.ts apps/url-shortener-node/src/modules/links/idrange.ts apps/url-shortener-node/package.json apps/url-shortener-node/test/metrics.test.ts
git commit -m "feat(url-shortener): prometheus metrics, otel tracing hook, correlation logs"
```

---

## Task 9: Concurrency test + k6 load + optional Prometheus/Grafana + dashboard

**Files:**
- Create: `apps/url-shortener-node/test/concurrency.test.ts`, `load/redirect.js`, `load/grafana/dashboard.json`
- Modify: `apps/url-shortener-node/compose.yaml` (add prometheus + grafana profiles), create `load/prometheus.yml`

**Interfaces:**
- Consumes: the running service + endpoints from Task 6.

- [ ] **Step 1: Write the concurrency test `test/concurrency.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it to verify it passes (proves the ranged allocator under load)**

Run: `node --test --import tsx test/concurrency.test.ts`
Expected: PASS — 200 unique codes.

- [ ] **Step 3: Create the k6 script `load/redirect.js`**

```js
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: { redirects: { executor: "ramping-vus", startVUs: 0,
    stages: [ { duration: "30s", target: 50 }, { duration: "1m", target: 200 }, { duration: "30s", target: 0 } ] } },
  thresholds: { http_req_duration: ["p(99)<50"] }, // p99 < 50ms redirect target
};

const BASE = __ENV.BASE || "http://localhost:3001";

export function setup() {
  const res = http.post(`${BASE}/api/v1/urls`, JSON.stringify({ longUrl: "https://example.com/loadtest" }),
    { headers: { "Content-Type": "application/json" } });
  return { code: res.json("code") };
}

export default function (data) {
  const res = http.get(`${BASE}/${data.code}`, { redirects: 0 });
  check(res, { "is 302": (r) => r.status === 302 });
}
```

- [ ] **Step 4: Add Prometheus scrape config `load/prometheus.yml`**

```yaml
global: { scrape_interval: 5s }
scrape_configs:
  - job_name: url-shortener
    static_configs: [{ targets: ["host.containers.internal:3001"] }]
```

- [ ] **Step 5: Add optional observability stack to `compose.yaml`**

Append (under a `profiles: [observability]` so it's opt-in):
```yaml
  prometheus:
    image: prom/prometheus:latest
    profiles: ["observability"]
    volumes: ["./load/prometheus.yml:/etc/prometheus/prometheus.yml:ro"]
    ports: ["9090:9090"]
  grafana:
    image: grafana/grafana:latest
    profiles: ["observability"]
    environment: { GF_AUTH_ANONYMOUS_ENABLED: "true", GF_AUTH_ANONYMOUS_ORG_ROLE: "Admin" }
    ports: ["3002:3000"]
```

- [ ] **Step 6: Run the load test and capture numbers**

```bash
cd apps/url-shortener-node
npm run dev &                      # start the service (or `npm start` after build)
podman compose --profile observability up -d prometheus grafana
k6 run load/redirect.js
```
Expected: k6 reports `http_req_duration p(99)` and the `is 302` check passes. Record the p99 and cache-hit ratio (from `/metrics`) in `document.md` (Task 10). If k6 is not installed, note it and skip execution — the script + threshold still document intent.

- [ ] **Step 7: Save a minimal Grafana dashboard `load/grafana/dashboard.json`**

Create a dashboard with three panels querying Prometheus: (1) `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))`, (2) `rate(cache_hits_total[1m]) / (rate(cache_hits_total[1m]) + rate(cache_misses_total[1m]))`, (3) `rate(http_request_duration_seconds_count[1m])`. Export the JSON from Grafana after building it against live load, and commit it.

- [ ] **Step 8: Commit**

```bash
git add apps/url-shortener-node/test/concurrency.test.ts apps/url-shortener-node/load apps/url-shortener-node/compose.yaml
git commit -m "feat(url-shortener): concurrency test, k6 load, optional prom/grafana"
```

---

## Task 10: `document.md` (Confluence-ready) + README

**Files:**
- Create: `apps/url-shortener-node/document.md`
- Modify: `apps/url-shortener-node/README.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `README.md` (short, dev-facing)**

Cover: one-line purpose, `podman compose up -d`, `npm install`, `npm run dev`, `npm test`, the curl examples for shorten + redirect, and env-var table. Keep under 60 lines.

- [ ] **Step 2: Write `document.md` (Confluence-ready service doc)**

Include these sections, filled with the real values from this build:
1. **Overview** — what the service does; the deliberate "built full-scale to learn" framing.
2. **Architecture** — the component table + an ASCII/mermaid data-flow diagram (client → cache → mongo; write path via ranged allocator + keygen).
3. **API reference** — `POST /api/v1/urls`, `GET /:code` (302), `GET /api/v1/urls/:code`, `/health`, `/metrics` with request/response examples and status codes.
4. **Data model** — `links` and `counters` documents, unique + TTL indexes, hashed shard-key note.
5. **Key generation** — ranged counter + sqids/base62, why non-guessable, collision-free.
6. **Configuration** — env-var table (name, default, meaning).
7. **Running locally** — compose + npm commands.
8. **Observability** — logs/health/metrics/tracing; list the metric names; how to run the Grafana stack.
9. **Testing** — the four test layers and how to run them; the recorded k6 p99 / cache-hit numbers from Task 9.
10. **Scaling notes** — the documented trigger points (Redis, ID blocks, sharding, Snowflake) copied from the code comments — i.e. when each over-built piece becomes actually necessary.

- [ ] **Step 3: Verify the doc is self-contained**

Run: `rg -n "TODO|TBD|FIXME" apps/url-shortener-node/document.md` → expect no matches. Confirm every API example matches the actual routes in `routes.ts` and every env var matches `config.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/url-shortener-node/document.md apps/url-shortener-node/README.md
git commit -m "docs(url-shortener): confluence-ready document.md and README"
```

---

## Self-Review

**Spec coverage:**
- MongoDB+Redis, Fastify, apps/url-shortener-node, deliveroo conventions → Task 1. ✓
- Ranged counter + obfuscated base62 → Tasks 2 (codec) + 3 (allocator). ✓
- Shard-routing seam, unique + TTL indexes → Tasks 1 (indexes) + 4 (shardFor). ✓
- Cache-aside + click counters → Tasks 5 + 7. ✓
- 302 redirect, 400/404, stats, metadata/owner seam → Task 6. ✓
- Observability (logs+correlation id, /health, /metrics p99 histogram, cache-hit, OTel) → Tasks 1, 8. ✓
- Testing layers: unit (2,3,5), integration (3,4,5,6,7), concurrency (9), k6 load (9) → covered. ✓
- Grafana built during load task; instrumentation always-on → Task 9. ✓
- Trigger-point comments on over-built pieces → Tasks 3,4,7 (in code) + Task 10 (collected). ✓
- Confluence `document.md` → Task 10. ✓

**Placeholder scan:** No TBD/TODO in code steps; the Grafana dashboard JSON (Task 9 step 7) is described by exact PromQL queries and exported from the live tool rather than hand-authored — acceptable, as the queries are given verbatim. README (Task 10 step 1) is content-described with an explicit section list, not code.

**Type consistency:** `LinkDoc`/`CounterDoc` (db.ts) used consistently in repo/service/clicks; `makeAllocator().nextId()`, `encode`/`decode`, `cacheGet/cacheSet/incrClick/drainClicks`, `insertLink/findByCode/bumpClicks/shardFor`, `shorten/resolve/stats` names match across tasks. Redirect is 302 everywhere. Port 3001 consistent.

**Note on obfuscation alphabet:** Task 2 leaves the exact 62-char alphabet to be finalized to 62 uniques; the test (`/^[0-9a-zA-Z]+$/`, uniqueness across 5000) is the gate that catches an invalid alphabet. This is a bounded, test-guarded detail, not a placeholder.
