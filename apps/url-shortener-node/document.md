# url-shortener-node — Service Documentation

## 1. Overview

`url-shortener-node` is a URL shortener service: `POST` a long URL, get back a short code; visiting the short code 302-redirects to the original URL. It also tracks per-code click counts and exposes stats.

This is a practice build for the system-design study plan (DDIA chapter 1 — scalability and maintainability). It is deliberately **built full-scale to learn**, not because a URL shortener at real-world scale needs all of this on day one: a Redis cache-aside layer, a ranged/block ID allocator, a shard-routing seam, and Prometheus + OpenTelemetry instrumentation are all present from the start so the exercise covers what each piece is *for* and *when it earns its keep*. Every over-built piece carries an explicit trigger point (see §10 Scaling notes) — the point in code where a comment says "this becomes necessary above X load," rather than leaving that judgment implicit.

Stack: Node 22, TypeScript, Fastify, MongoDB, Redis, containers via Podman.

## 2. Architecture

| Component | Role |
|---|---|
| Fastify HTTP server | Routes, request lifecycle, correlation-id logging |
| MongoDB (`links` collection) | System of record for short code → long URL, click counts, expiry |
| MongoDB (`counters` collection) | Backing store for the ranged ID allocator |
| Redis | Cache-aside for redirects; hot-path click counter (hash), reconciled to Mongo periodically |
| Ranged allocator + keygen | Produces short codes: atomic counter block + sqids obfuscation |
| Click flusher | Background timer draining Redis click counts into Mongo |
| prom-client | `/metrics` endpoint, Prometheus text format |
| OpenTelemetry SDK (optional) | Distributed tracing, enabled via preload flag |

### Data flow — write path (shorten)

```
client
  │  POST /api/v1/urls { longUrl }
  ▼
Fastify route ──► service.shorten()
                     │
                     ├─► allocator.nextId()  ──► Mongo `counters` (atomic $inc by ID_BLOCK_SIZE, refills in-memory block)
                     │
                     ├─► keygen.encode(id)   ──► sqids → base62 short code (~7 chars)
                     │
                     ├─► repo.insertLink()   ──► Mongo `links` (short_code, long_url, owner, metadata, click_count=0, created_at, expires_at)
                     │
                     └─► cache.cacheSet()    ──► Redis SET u:<code> = longUrl EX CACHE_TTL_S
                     ▼
              201 { code, shortUrl }
```

### Data flow — read path (redirect)

```
client
  │  GET /:code
  ▼
Fastify route ──► service.resolve(code)
                     │
                     ├─► cache.cacheGet(code) ──► Redis GET u:<code>
                     │        │
                     │        ├─ hit  ─► incrClick(code) (Redis HINCRBY clicks) ─► 302 Location: longUrl
                     │        │
                     │        └─ miss ─► repo.findByCode(code) ──► Mongo `links`
                     │                       │
                     │                       ├─ found ─► cacheSet() to repopulate Redis, incrClick(), 302 Location: longUrl
                     │                       └─ not found ─► 404
```

Click counts accumulate in the Redis hash `clicks` (field = code) and are drained atomically (Lua `HGETALL` + `DEL`) every 5s by a background flusher, which batches a `bulkWrite` of `$inc click_count` into Mongo — see §9 for why this is batched rather than a direct Mongo `$inc` per redirect.

**Redis-down behavior:** `service.resolve()` treats any Redis error (on `cacheGet`, `incrClick`, or the repopulating `cacheSet`) as non-fatal — a thrown `cacheGet` is treated as a cache miss and falls through to Mongo, and a failing `incrClick`/`cacheSet` is logged and swallowed. Net effect: redirects keep returning `302` by reading Mongo directly when Redis is unavailable (degraded but functional); the only things lost are click increments and cache warming, not availability.

## 3. API reference

### `POST /api/v1/urls`

Create a short link.

Request:
```json
{ "longUrl": "https://example.com/some/long/path", "owner": "optional-owner-id", "metadata": { "any": "json" } }
```
- `longUrl` required, must be a valid `http:`/`https:` URL, max 2048 chars.
- `owner`, `metadata` optional.

Responses:
- `201 Created`
  ```json
  { "code": "abc1234", "shortUrl": "http://host/abc1234" }
  ```
- `400 Bad Request` — `{ "error": "longUrl must be a valid http(s) URL <= 2048 chars" }`

### `GET /:code`

Redirect to the original URL. Registered last so it doesn't shadow `/api/*` or `/health`/`/metrics`.

- `302 Found`, `Location: <longUrl>`, empty body.
- `404 Not Found` — `{ "error": "not found" }` — unknown or expired code.

Each successful resolution (hit or miss-then-found) increments the code's click counter in Redis.

### `GET /api/v1/urls/:code`

Stats for a short code.

- `200 OK`
  ```json
  {
    "shortCode": "abc1234",
    "longUrl": "https://example.com/some/long/path",
    "clickCount": 42,
    "createdAt": "2026-07-01T00:00:00.000Z",
    "expiresAt": "2026-07-08T00:00:00.000Z",
    "owner": null
  }
  ```
- `404 Not Found` — `{ "error": "not found" }`

Note: `clickCount` reflects the last flush (up to ~5s stale), since hot-path clicks are counted in Redis and reconciled to Mongo asynchronously (see §9).

### `GET /health`

Liveness/readiness probe — pings Mongo and Redis.

- `200 OK` — `{ "status": "ok" }`
- `503 Service Unavailable` — `{ "status": "degraded", "error": "<message>" }` when either dependency is unreachable.

### `GET /metrics`

Prometheus scrape endpoint. Returns text in `prom-client`'s default content type; includes default Node process metrics plus the app metrics listed in §8.

## 4. Data model

### `links` collection

| Field | Type | Notes |
|---|---|---|
| `short_code` | string | unique index; the sqids-encoded id |
| `long_url` | string | target URL |
| `owner` | string \| null | optional owner/tenant id |
| `metadata` | object \| null | free-form JSON attached at creation |
| `click_count` | number | reconciled periodically from Redis, not real-time |
| `created_at` | Date | |
| `expires_at` | Date \| null | TTL field |

Indexes:
- `{ short_code: 1 }` unique — enforces one document per code, also the lookup path for redirects/stats.
- `{ expires_at: 1 }` with `expireAfterSeconds: 0` — native Mongo TTL index; Mongo's background reaper deletes expired links automatically instead of a hand-rolled sweeper job.

**Expiry is fixed-window, not sliding:** `expires_at` is set once at creation to `created_at + LINK_TTL_DAYS` (default 7 days) and never extended by later reads/redirects. Mongo's TTL background sweeper runs periodically (not instantly), so deletion can lag the `expires_at` timestamp by up to ~60s. Separately, the Redis cache entry (`CACHE_TTL_S`, default 1 day) has its own, shorter TTL — so a code that just passed its Mongo expiry may still 302 briefly from a still-warm cache entry until that entry ages out, and even after Mongo expiry a request can briefly still find the document until the sweeper actually deletes it.

### `counters` collection

| Field | Type | Notes |
|---|---|---|
| `_id` | string | counter name, e.g. `"url"` |
| `seq` | number | monotonically increasing; incremented by `ID_BLOCK_SIZE` per refill |

### Shard-key seam

`repo.ts` defines `shardFor(code)`, which MD5-hashes the short code and mods by `SHARD_COUNT` (currently hardcoded to `1`, so every code resolves to shard 0 and there is exactly one Mongo). The hashing scheme is chosen so that flipping `SHARD_COUNT` above 1 and wiring a client-per-shard map in `db.ts` requires no changes at any call site — `shardFor` is already the single seam where shard routing would plug in. See §10 for the trigger point.

## 5. Key generation

Short codes are generated in two steps:

1. **Ranged counter allocation** (`idrange.ts`): rather than doing an atomic `$inc` on every single shorten request, the allocator claims a block of `ID_BLOCK_SIZE` (default 1000) sequential integers from Mongo's `counters` collection in one atomic `findOneAndUpdate`, then hands out ids from that in-memory block until it's exhausted, at which point it refills. This removes per-request counter contention against Mongo.
2. **sqids obfuscation → base62** (`keygen.ts`): the plain integer id is encoded with `sqids` using a fixed, shuffled 62-character alphabet (`[0-9a-zA-Z]`) and a minimum length of `CODE_MIN_LENGTH` (default 7). This is reversible (`decode` recovers the integer), non-sequential in appearance, URL-safe, and non-guessable — a client can't enumerate codes by incrementing, even though the underlying ids are sequential and collision-free by construction (each integer id is issued exactly once by the allocator).

Net effect: codes are collision-free (guaranteed by the counter, not by chance), reversible (no separate code→id mapping table needed), and non-guessable (obfuscated alphabet), with the allocator removing counter contention as a bottleneck.

## 6. Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `MONGO_URL` | `mongodb://localhost:27017/shorturl` | Mongo connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `ID_BLOCK_SIZE` | `1000` | Ids claimed per counter refill (see §5, §10) |
| `CODE_MIN_LENGTH` | `7` | Minimum short-code length |
| `CACHE_TTL_S` | `86400` | Redirect cache TTL, seconds (24h) |
| `LINK_TTL_DAYS` | `7` | Link expiry, days — drives `expires_at`, enforced by the Mongo TTL index |
| `LOG_LEVEL` | `info` | pino log level |
| `OTEL_ENABLED` | unset | Set to `1` to start OpenTelemetry tracing (used by `dev:otel`/`start:otel`) |

## 7. Running locally

```sh
# 1. start Mongo + Redis (Podman)
podman compose up -d

# 2. install deps
npm install

# 3. run the service
npm run dev

# 4. exercise it
curl -s -X POST localhost:3001/api/v1/urls -H 'Content-Type: application/json' \
  -d '{"longUrl":"https://example.com/some/long/path"}'
curl -si localhost:3001/<code>
curl -s localhost:3001/api/v1/urls/<code>
curl -s localhost:3001/health
curl -s localhost:3001/metrics
```

Optional observability stack (Prometheus + Grafana), gated behind the `observability` compose profile:

```sh
podman compose --profile observability up -d
# Prometheus: http://localhost:9090 (scrapes host.containers.internal:3001/metrics every 5s)
# Grafana:    http://localhost:3002 (anonymous admin access enabled for local use)
```

**Known caveat:** the Grafana service comes up with anonymous admin access but no auto-provisioned datasource. The exported dashboard (`load/grafana/dashboard.json`) references Prometheus panels by datasource `uid: "prometheus"`; you need to add a Prometheus datasource in Grafana's UI (Connections → Data sources → Prometheus, URL `http://prometheus:9090`) and confirm its uid matches, or edit the dashboard JSON's datasource uid to match whatever Grafana assigns, before the dashboard will render.

## 8. Observability

- **Logs**: pino, JSON, structured. Fastify's `genReqId` is set to `randomUUID()`, so every request gets a correlation id (`reqId`) threaded through its log lines — useful for tracing a single request across log output.
- **Health**: `GET /health` pings Mongo (`db.command({ping:1})`) and Redis (`PING`); returns `503` with an error message if either is unreachable, `200 {"status":"ok"}` otherwise. Suitable as a container/k8s readiness+liveness probe.
- **Metrics**: `GET /metrics`, Prometheus text format via `prom-client`. Includes Node's default process metrics plus:
  - `http_request_duration_seconds` — histogram, labels `method`, `route`, `status`; buckets tuned for p99 visibility (`0.001`–`1`s). Recorded on every response via an `onResponse` hook.
  - `cache_hits_total` — counter, incremented on Redis cache hit during redirect resolution.
  - `cache_misses_total` — counter, incremented on Redis cache miss (falls through to Mongo).
  - `id_blocks_total` — counter, incremented once per allocator refill (i.e., once per `ID_BLOCK_SIZE` ids issued).
- **Tracing**: OpenTelemetry, off by default. `npm run dev:otel` / `npm run start:otel` set `OTEL_ENABLED=1` and preload `src/tracing.ts` via `--import` before any instrumented module loads, using `@opentelemetry/auto-instrumentations-node` with a console span exporter (swap for OTLP once a collector exists). Confirmed emitting HTTP and DNS spans in local testing.

## 9. Testing

Four layers, all under `test/`, run serially (`node --test --test-concurrency=1`) so concurrency tests aren't disturbed by parallel test execution:

- **Unit** — `keygen.test.ts`: encode/decode round-trip, base62 charset, uniqueness.
- **Integration** — `idrange.test.ts`, `repo.test.ts`, `cache.test.ts`, `service.test.ts`, `clicks.test.ts`, `health.test.ts`, `metrics.test.ts`: allocator block refill behavior, Mongo repo operations, Redis cache-aside get/set, shorten/resolve/stats service logic, click drain-and-flush, `/health`, `/metrics`.
- **Concurrency** — `concurrency.test.ts`: 200 parallel `shorten()` calls verified to produce unique codes (no collisions from racing allocator refills).
- **Load (k6)** — `load/redirect.js`: ramping VUs (0→50→200→0 over 30s/1m/30s) hitting the redirect path, threshold `p(99)<50ms`. Recorded result: **p99 = 18.06 ms**, cache-hit ratio ~100% (steady-state redirects served from Redis after the initial cache-miss).

Run:
```sh
npm test                                  # unit + integration + concurrency
k6 run load/redirect.js                   # load test (requires the service running, and k6 installed)
```

## 10. Scaling notes — trigger points for the over-built pieces

Each piece here was included from the start to practice the pattern, with an explicit note (also present as a code comment) on the load level at which it stops being optional:

- **Redis cache (cache-aside) / click counters**: batching Redis→Mongo click reconciliation matters once click volume would otherwise mean one Mongo write per redirect; below that volume, a direct `$inc` on Mongo per redirect would be simpler and fine (`clicks.ts`).
- **Ranged ID allocator (block claims of `ID_BLOCK_SIZE`)**: a single atomic `$inc` per write is perfectly adequate below roughly thousands of writes/sec; blocks only start mattering to remove counter contention above that (`idrange.ts`).
- **Hashed shard-key seam (`shardFor`)**: sharding is worth doing only once you exceed single-node storage or throughput limits — roughly multi-TB of data or >~10k QPS. Below that, the single-shard (`SHARD_COUNT = 1`) configuration used here is correct, and the seam exists so scaling out later requires no call-site changes (`repo.ts`).
- **Snowflake-style distributed id generation**: not implemented in this build — the ranged-counter allocator is a simpler alternative that avoids clock-skew and node-id coordination concerns, and is sufficient as long as there's a single counter authority (Mongo). A Snowflake-style generator would become relevant if/when the counter itself needs to be sharded across independent writers with no central coordination.
