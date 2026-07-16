# URL Shortener Service — Design Spec

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan
**Location:** `apps/url-shortener-node/` (new service in the polyglot monorepo)

## Purpose

A standalone URL-shortener service, built as hands-on reinforcement of the Week-1
design exercise ([docs/exercises/1-url-shortener.md](../../exercises/1-url-shortener.md))
and a deliberate, full-scale practice of the **scalability** and
**maintainability** principles from DDIA ch. 1. It shortens long URLs to ~7-char
codes, redirects on lookup, and tracks click counts. Future use: shortening
product URLs (metadata seam included, product features deferred).

**Deliberately over-built for learning.** At the realistic scale (~58 read QPS,
<1 TB / 5 yr) a single database would suffice. This service builds the full
machinery (cache, ranged ID allocation, shard-routing, observability) on purpose,
and every heavy piece carries a comment naming the **real trigger point** where
it would actually be justified. Right-sizing is documented, not skipped.

## Non-goals (YAGNI)

- Product-specific features (catalog integration, campaigns) — only a metadata seam now.
- Custom-domain branding, user accounts/auth beyond an optional `owner` field.
- Running N physical shards locally — the shard-routing seam is built and tested against 1 shard; flipping to N is a documented, call-site-free change.
- Wiring into the `learn-sd` study weeks — this is a parallel build, not a graded week.

## Tech stack

Node 22 + TypeScript + Fastify + **MongoDB** + **Redis**, mirroring
`deliveroo-node` conventions (ESM `.js` imports, config via env, JSON logging via
pino, per-module `routes.ts`/`service.ts`, `node --test` + `tsx`). Containers via
podman compose.

**Why MongoDB (not Postgres):** pure key-value access (`code → longUrl`, no
joins); **native TTL indexes** for the unused-link expiry; **first-class sharding**
(hashed shard key) serving the full-scale goal; flexible schema for the future
product-URL metadata; and hands-on practice of the document model from DDIA ch. 2
(polyglot persistence — deliveroo stays relational). Trade-off: the monorepo
gains a second datastore (more operational surface) — a deliberate learning choice.

## Architecture

Standalone Fastify service. Own MongoDB database (`shorturl`) + Redis. Two hot
paths: write (`POST /api/v1/urls`) and the dominant read (`GET /:code` redirect).
Each unit sits behind an interface so pieces swap without touching routes
(evolvability).

```
apps/url-shortener-node/
  src/
    index.ts                  # Fastify bootstrap, /health, route registration, JSON logs
    config.ts                 # env: PORT, MONGO_URL, REDIS_URL, ID_BLOCK_SIZE, CODE_LENGTH, CACHE_TTL_S, LINK_TTL_DAYS
    db.ts                     # Mongo client + collections; index setup (unique short_code, TTL on expires_at, shard-key note)
    cache.ts                  # Redis cache-aside (code→longUrl) + INCR click counters; interface hides Redis
    metrics.ts                # prom-client registry: latency histogram, cache-hit counter, id-block counter
    tracing.ts                # OpenTelemetry setup (redirect → cache → mongo spans)
    modules/links/
      routes.ts               # POST /api/v1/urls, GET /:code (302), GET /api/v1/urls/:code (stats)
      service.ts              # orchestration: shorten(), resolve(), stats()
      idrange.ts              # ranged counter: atomic $inc block allocation from counters coll; in-memory range
      keygen.ts               # id -> Feistel/Sqids obfuscation -> base62 (~7 chars) and reverse
      repo.ts                 # Mongo access via shardFor(code) router (1 shard now, N later)
      clicks.ts               # periodic flush of Redis click counters -> Mongo
  test/                       # node --test suites (unit, integration, concurrency)
  compose.yaml                # mongo + redis (+ optional prometheus/grafana)
  README.md
```

### Components

| Unit | Responsibility | Interface (consumed by) |
|---|---|---|
| **HTTP** (`index.ts`, `routes.ts`) | Fastify; `/health`, shorten, redirect (302), stats | — |
| **service.ts** | orchestrates shorten/resolve/stats | `shorten(longUrl, opts) → {code}`; `resolve(code) → longUrl \| null`; `stats(code)` |
| **idrange.ts** | hands out ids from an in-memory block, refills atomically | `nextId() → Promise<bigint>` |
| **keygen.ts** | reversible id↔code (obfuscate → base62) | `encode(id) → code`; `decode(code) → id` |
| **cache.ts** | Redis cache-aside + click INCR | `get(code)`, `set(code,url,ttl)`, `incrClick(code)`, `drainClicks()` |
| **repo.ts** | Mongo persistence, shard-aware | `insert(doc)`, `findByCode(code)`, `bumpClicks(map)`; internal `shardFor(code)` |
| **clicks.ts** | flush Redis counters → Mongo on interval | `startFlusher()`, `stopFlusher()` |

### Key generation (ranged counter + obfuscated base62)

1. `idrange.nextId()` returns the next id from an in-memory block; when the block
   is exhausted it atomically claims a new block:
   `counters.findOneAndUpdate({_id:"url"}, {$inc:{seq: ID_BLOCK_SIZE}}, {upsert, returnDocument:"after"})`
   → the returned `seq` is the top of a new `[seq-BLOCK+1, seq]` range. No
   per-request contention (blocks amortize the write).
2. `keygen.encode(id)`: obfuscate the sequential id with a **reversible bijection**
   (Feistel network, or the `sqids` library) so codes are non-sequential /
   non-guessable, then base62-encode → ~7 chars. `decode` reverses it.
3. Collisions are impossible (bijection over unique ids); no DB existence check
   needed on the write path.

Trigger-point note in code: "Ranged blocks remove counter contention above ~X
write QPS; a single atomic $inc per write is fine below that."

## Data model (MongoDB)

`shorturl.links` document:
```
{
  _id: ObjectId,
  short_code: string,     // unique index; the base62 code
  long_url: string,
  owner: string | null,   // future product-URL seam
  metadata: object | null,// future: { productId, campaign, ... }
  click_count: number,    // periodically reconciled from Redis
  created_at: Date,
  expires_at: Date | null // TTL index -> native auto-expiry
}
```
- **Unique index** on `short_code`.
- **TTL index** on `expires_at` (native expiry; satisfies the unused-link requirement).
- **Shard key**: hashed `short_code` (documented; single shard runs now).
`shorturl.counters` document: `{ _id: "url", seq: <int> }`.

## Data flow

**Shorten** (`POST /api/v1/urls`): validate URL (http/https, size) → `nextId()` →
`encode()` → `repo.insert()` → warm cache → return `{ code, shortUrl }`.

**Redirect** (`GET /:code`): `cache.get(code)` → HIT: `302` + `cache.incrClick`;
MISS: `repo.findByCode` → not found/expired `404`; else `302`, repopulate cache,
`incrClick`. Cache miss is normal, not an error.

**Click flush**: `clicks` flusher drains Redis counters every N seconds →
`repo.bumpClicks()` (off the hot path).

## DDIA ch. 1 mapping (explicit, since it's a requirement)

- **Scalability** — load: read-heavy, so Redis cache-aside fronts the redirect
  path; write contention removed via ranged id blocks; data volume via hashed
  shard key; **performance measured as p99 redirect latency** (percentiles, not
  averages).
- **Maintainability** — *operability*: `/health` (Mongo+Redis), JSON logs with
  correlation id, Prometheus metrics, OTel traces; *simplicity*: one
  responsibility per unit; *evolvability*: keygen/cache/repo behind interfaces
  (swap Snowflake or add shards without touching routes).

## Observability

- **Logs**: pino JSON, per-request correlation id.
- **Health**: `/health` pings Mongo + Redis; `503` if a dependency is down.
- **Metrics** (`/metrics`, prom-client): request rate; **latency histogram →
  p50/p95/p99**; cache hit ratio; id-block allocation count; Mongo op latency.
  Optional Grafana + Prometheus in compose.
- **Tracing**: OpenTelemetry spans `redirect → cache lookup → mongo read`.

## Error handling

- Invalid/oversized/non-http(s) URL → `400`.
- Unknown or expired code → `404`.
- Mongo or Redis unavailable → `/health` red; writes return `503`; reads degrade
  (cache miss falls through; if Mongo down, `503`).
- Cache miss → normal path, repopulate; never surfaced as an error.
- Custom-alias collision (if custom aliases are enabled) → `409`.

## Testing (layered — the "enough" bar)

- **Unit**: keygen round-trip (`encode(decode(x))==x`, non-sequential, no
  collisions across a block); base62; idrange block exhaustion → next block.
- **Integration** (real Mongo+Redis via Testcontainers or compose): shorten→
  redirect happy path; `302` + `Location`; TTL expiry; cache hit vs miss; click
  increment + flush reconciliation.
- **Concurrency** (interview-gold, echoes deliveroo Week 3): N parallel shortens
  all produce **unique** codes — proves ranged allocation is correct under
  contention.
- **Load** (k6): ramp redirects; assert **p99 < target** and cache-hit-ratio;
  read the metrics/dashboard to locate the bottleneck (closes the testing↔
  monitoring loop).

## Open questions

- Obfuscation: `sqids` library (safe, batteries-included) vs a hand-rolled Feistel
  (more educational). Default to `sqids`; note Feistel as a learn-deeper swap. Not
  blocking — behind the `keygen` interface either way.
