# apps/url-shortener-node

Fastify + TypeScript (ESM) URL shortener. MongoDB for links, Redis for the
redirect cache. The reference service for the observability build.

## Run

```bash
podman network create sd-net                              # once, shared with observability
podman compose -f apps/url-shortener-node/compose.yaml up -d   # app + mongo + redis, all capped

# or run the app on the host against the containerised datastores:
npm run dev              # no telemetry
npm run dev:otel         # watch mode, traces at 100%
npm run load:otel        # NO watch, 10% sampling — use for load tests
npm test                 # 26 tests
```

⚠️ **`tsx watch` does not propagate env to the server it re-spawns.** A sampler
set on `dev:otel` is silently ignored. That is why `load:otel` exists.

## Memory

The app runs in a container so its memory is actually bounded — a host process
gets no cgroup, so nothing enforces a limit on it. **Two ceilings, and you need
both:**

| | bounds | set by |
|---|---|---|
| `mem_limit: 256m` | RSS — kernel kills past it | compose |
| `NODE_MAX_HEAP_MB: 100` | the V8 heap inside that | `NODE_OPTIONS` |

RSS runs ~1.8x the heap (code, stacks, native buffers sit outside it), so a
100 MB heap needs ~256m of room. Measured floors: **50 MB heap dies at startup**
("Reached heap limit", 921 ms in), 75 MB works, 100 MB is the safe choice.
Verified under load: 8,190 req/s, p99 9.89 ms, 155.8 MB of 256, no OOM.

Mongo is capped at 512m **and** `--wiredTigerCacheSizeGB 0.25`, because
WiredTiger sizes its cache from *host* RAM and cannot see the container limit.
At 100m with no cache cap it looked fine at idle and was OOM-killed by the test
suite.

## Design

- `src/otel.ts` — OTel bootstrap, preloaded via `--import`. **No-op unless
  `OTEL_ENABLED=1`.** Must start before `metrics.js` loads: `metrics.getMeter()`
  binds to whatever provider is global at call time and never re-binds.
- `src/metrics.ts` — OTel instruments. **No prom-client, no `/metrics` route** —
  metrics leave over OTLP only, so there is one source of truth.
- `LATENCY_BUCKETS_S` contains **`0.05` — the SLO threshold**. A test asserts it.
  Change the SLO, change the bucket; they are one decision.
- Route label uses the matched template (`/:code`), never the raw path —
  otherwise every unknown short code becomes its own time series.
- `src/modules/links/idrange.ts` — ids come from a Mongo counter in blocks;
  short codes are a deterministic sqids encoding of the id.

## Tests

**Tests hit a real Mongo and Redis.** `npm test` targets `shorturl_test` +
Redis db 1, and `test/setup.ts` refuses to start unless both point somewhere
disposable. Never bypass that guard — a run against the dev database resets the
id counter while leaving links behind, and the app then re-issues short codes
that already exist (`E11000`).

`counters` and `links` are coupled by that id→code mapping: reset one, reset both.

## Load testing

`load/redirect.js` — ramps to 200 VUs, threshold `p(99)<50` matching the SLO.
`setup()` throws if it cannot get a code; without that the run silently measures
the 404 path and still reports a plausible p99.

Baselines: p99 ≈ 13–25 ms at 8–10k req/s; ~41 ms at 200 VUs.
