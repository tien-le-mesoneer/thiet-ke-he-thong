# Application-Wide Observability (OpenTelemetry-first) — Design Spec

**Date:** 2026-07-17
**Status:** Approved design, open decisions resolved 2026-08-24, pending implementation plan
**Scope:** Monorepo-wide — `apps/deliveroo-node`, `apps/url-shortener-node`, a new shared `packages/observability-node`, and a new `infra/observability/` stack.

## Purpose

Make observability an application-wide, architect-grade capability rather than a
single-service afterthought. Standardize on **OpenTelemetry** as the one
instrumentation contract for metrics, traces, and (correlated) logs across every
Node service; feed a single **OTel Collector** that also scrapes the databases
natively; visualize in Grafana organized around **RED** (services) and **USE**
(datastores); and prove it works against **one SLO** with a **burn-rate alert**
and a **game-day**. Doubles as the Phase-4 observability milestone of the study
plan.

**Right-sizing (the deliberate 1% discipline):** at the real scale (~58 QPS) this
is educational scaffolding. Build the smallest thing that teaches the real lesson
— SLO → RED/USE → correlation (spike → trace → logs) → burn-rate alert →
game-day — not a tool zoo. Every deliberately-skipped piece is documented with
its real trigger point.

## Non-goals (YAGNI / documented trigger points)

- **No Loki / log aggregation** — logs stay stdout JSON tagged with `trace_id`; grep-by-trace is enough at this scale. (Trigger: multiple instances / can't tail one process.)
- **No Alertmanager paging** — the burn-rate alert is a Prometheus rule surfaced in Grafana; no PagerDuty/Slack routing. (Trigger: a real on-call rotation.)
- **No standalone DB exporters** — the Collector's native DB receivers replace `postgres_exporter`/`mongodb_exporter`/`redis_exporter`.
- **No per-DB community dashboard fleet** — one focused USE dashboard. (Trigger: DB-specific deep-dives.)
- **No new business features** in either app — only instrumentation.

## Tech stack

OpenTelemetry (`@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`,
OTLP exporter, pino log-correlation), OTel Collector (contrib image, for the DB
receivers), Prometheus (metrics + rules), Tempo (traces), Grafana (provisioned).
Node services stay Fastify/TS/ESM; npm **workspaces** introduced at the repo root.
Containers via podman compose.

## Architecture

Two Node services boot with a shared OTel bootstrap (preloaded via `node --import`)
that auto-instruments HTTP + DB clients and exports OTLP to a Collector. The
Collector fans out: metrics → Prometheus, traces → Tempo, and it *also* scrapes
the three datastores natively. Grafana reads Prometheus + Tempo, with exemplars
linking metric spikes to traces; logs stay on stdout carrying `trace_id` for
manual correlation.

```
apps/deliveroo-node ─┐  (OTLP: traces+metrics)
apps/url-shortener ──┤
                     ▼
              OTel Collector ──── metrics ──► Prometheus ──┐
   (also scrapes pg/mongo/redis via receivers)  traces ──► Tempo ──┤
                                                                   ▼
                                                                Grafana
                                                        (RED + USE dashboards,
                                                         exemplars → traces,
                                                         SLO + burn-rate panel)
   stdout JSON logs (with trace_id) ── grep/tail for log correlation
```

### File structure

```
package.json                                  # NEW root: private, workspaces ["apps/*","packages/*"]
packages/observability-node/
  package.json  tsconfig.json  README.md
  src/index.ts                                # OTel bootstrap: SDK + auto-instr + OTLP + pino correlation
  src/metrics.ts                              # helpers to register custom OTel metrics (counter/histogram)
  test/*.test.ts
apps/deliveroo-node/                          # add otel preload + custom metrics; depend on @sd/observability-node
apps/url-shortener-node/                      # migrate tracing.ts → shared bootstrap; port cache/id counters to OTel
infra/observability/
  .env                                        # host port map (7xxx block)
  compose.yaml                                # otel-collector, prometheus, tempo, grafana
  otel-collector-config.yaml                  # OTLP receivers + postgresql/mongodb/redis receivers; export to prometheus+tempo
  prometheus/prometheus.yml                   # scrape the Collector; load rules
  prometheus/rules.yml                        # SLI recording rule + multi-window burn-rate alert
  grafana/provisioning/datasources/*.yaml     # Prometheus + Tempo datasources
  grafana/provisioning/dashboards/*.yaml      # dashboard provider
  grafana/dashboards/red.json  use.json  slo.json
  gameday.md                                  # chaos exercise + script
  README.md
```

## Components

### 1. `packages/observability-node` — shared OTel bootstrap
- One responsibility: configure OTel once for any Node service.
- Reads `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT` from env. The stack publishes OTLP on the host at **7318** (HTTP) / **7317** (gRPC) — see `infra/observability/.env` for the full 7xxx port map — so the apps set the endpoint explicitly rather than relying on the SDK's `localhost:4318` default.
- Starts `NodeSDK` with `getNodeAutoInstrumentations()` (HTTP/Fastify, `pg`, `mongodb`, `ioredis`) → traces + HTTP server RED metrics with no per-route code.
- Injects `trace_id`/`span_id` into pino logs (`@opentelemetry/instrumentation-pino` or a manual log hook).
- Guarded: a no-op unless `OTEL_ENABLED=1`, so tests/dev stay quiet (reuses the pattern already proven in url-shortener's `tracing.ts`).
- `metrics.ts` exports helpers `counter(name, help)` / `histogram(...)` bound to the OTel meter so apps add domain metrics (cache hits, orders placed) to the same pipeline.
- Interface consumed via `node --import @sd/observability-node` (preload) + `import { counter } from "@sd/observability-node"`.

### 2. App wiring
- **url-shortener-node:** replace `src/tracing.ts` + the prom-client `metrics.ts`/`/metrics` route with the shared bootstrap; re-express `cache_hits_total`/`cache_misses_total`/`id_blocks_total` as OTel counters via the helper. `OTEL_SERVICE_NAME=url-shortener`.
- **deliveroo-node:** add the preload → auto-instrumented traces + RED metrics + trace-tagged logs. Add domain counters `orders_placed_total`, `payment_failures_total`. `OTEL_SERVICE_NAME=deliveroo`.
- Each app gains `dev:otel` / `start:otel` scripts (preload + `OTEL_ENABLED=1`).

### 3. `infra/observability/` — the stack
- **OTel Collector (contrib):** `otlp` receiver (http/grpc) for app signals; `postgresql`, `mongodb`, `redis` receivers scraping the datastores via host ports (5432/27017/6379); exporters `prometheus` (or `prometheusremotewrite`) and `otlp`→Tempo.
- **Prometheus:** scrapes the Collector's Prometheus endpoint; loads `rules.yml`.
- **Tempo:** receives traces from the Collector.
- **Grafana:** provisioned Prometheus + Tempo datasources; provisioned dashboards; exemplars enabled so p99 panels link to traces.

### 4. SLO + burn-rate alert
- Define **one SLO** (decided 2026-08-24): url-shortener redirect **latency** — 99% of redirects served in < 50 ms over 30 days. The SLI is a latency percentile, not availability, so the pipeline exercises histogram buckets and tail behaviour end-to-end.
  - Baseline: k6 measured p99 = 18.06 ms at low load, but a 2026-08-24 ramp to 200 VUs (980k requests, 8,166 req/s) measured **p99 = 41.65 ms — 83% of the 50 ms budget**. The target is real but the headroom is thin at peak, so the burn-rate alert in slice 4 will actually have something to fire on. Distribution from that run: mean 11.4 ms, p50 9.92 ms, p90 21.04 ms, p95 25.94 ms, p99 41.65 ms, max 145.19 ms — the mean sits next to the median and says nothing about the tail, which is the whole argument for percentile SLIs.
  - **Latency SLIs are counted, not averaged.** The SLI is `good / total` where *good* = requests in buckets ≤ 50 ms, taken from an OTel **explicit-bucket histogram** with a boundary exactly at the threshold. Never `avg()` or `quantile()` a p99 across instances or windows — recompute from summed bucket counts.
  - Bucket boundaries must straddle the target, e.g. `[5, 10, 25, 50, 100, 250, 500, 1000] ms`; a missing 50 ms boundary makes the SLI uncomputable.
  - **Implemented and measured 2026-08-24.** Buckets live in `apps/url-shortener-node/src/otel.ts` as `LATENCY_BUCKETS_S`, enforced by an OTel `View` with `ExplicitBucketHistogramAggregation`, and guarded by a unit test asserting the 0.05 boundary exists. First real reading over 322,924 requests at 8,070 req/s: **SLI = 99.8943%**, 10.6% of the error budget consumed.
  - **Evidence that counting beats interpolating.** An earlier draft of this spec claimed a 33% gap between k6's client-side p99 and `histogram_quantile()`. That comparison was invalid — the two numbers came from different time windows. On matched data (364,240 requests, k6 `p(99)=22.47 ms`) `histogram_quantile` returns 22.82 ms, an error of only **1.6%**. Interpolation is not, in general, wildly wrong.
  - The real argument is about **bucket width, not interpolation per se**, and it is sharper. Interpolation assumes a uniform distribution inside the bucket, which latency never has. With the 0.05 boundary present, the SLI is counted exactly: 363,609 / 364,240 = **99.8268%**, consuming **17.3%** of the budget. Remove that one boundary and the nearest enclosing bucket becomes `0.025 → 0.1`; estimating the same SLI by interpolation gives 99.5633%, i.e. **43.7%** of the budget — the same data reporting **2.5× the error-budget burn**. That factor is bounded only by how wide the bucket is, which is why the boundary must sit exactly at the threshold.
  - So `histogram_quantile` is fine for dashboards and trends; the error budget uses the counted ratio.
- `rules.yml`: a recording rule for the SLI + a **multi-window multi-burn-rate** alert (fast + slow windows, Google-SRE style) that fires on error-budget burn. Surfaced in the SLO dashboard; no external routing.
- **Implemented 2026-08-24.** Error ratio recorded at 5m/30m/1h/6h/3d; three burn alerts (14.4× critical on 1h+5m, 6× warning on 6h+30m, 1× ticket on 3d+6h) plus an `absent()` guard. Validated with `promtool check rules` (11 rules) and unit-tested with `promtool test rules` — four cases including the two negatives that matter: healthy traffic must fire nothing, and an 8× burn must fire *high* without firing critical.
- **Known gap, deliberately surfaced rather than hidden:** the latency SLI filters to `status="302"`, so during a total outage it goes **absent, not bad** — no successful redirects exist to be slow, and a latency-only dashboard stays green while the service is down. `RedirectLatencySLIMissing` makes this visible; the real fix is a separate **availability SLO**, still unwritten. This is the direct consequence of the 2026-08-24 decision to demote availability to a dashboard panel.
- Availability stays a **dashboard panel**, not the SLO — tracked, but not the thing with an error budget.

### 5. Game-day
- `gameday.md` + a script: with the stack + apps + k6 load running, kill Redis (and/or inject latency), and observe: the SLO burn-rate panel reacting, the USE cache-hit/saturation signal dropping, and the failing request's trace in Tempo. Confirms the pipeline answers "what broke and why" end-to-end.

## Data flow

Request → app (auto-instrumented) emits span + metric, log line stamped with
`trace_id` → OTLP to Collector → metrics to Prometheus, trace to Tempo. DB stats
pulled by the Collector receivers → Prometheus. Grafana queries both; a p99 spike
exemplar jumps to the trace; the trace_id greps the logs.

## Error handling / robustness

- **`OTEL_ENABLED` unset → full no-op** (SDK never starts); existing test suites stay green with zero OTel overhead.
- **Collector down** → app OTLP export fails silently (batch dropped); the app keeps serving. Never let telemetry failure break request handling.
- **Span loss under load is real and silent.** Measured 2026-08-24: at 8,166 req/s the app emitted 1.00 span per redirect, so 980,125 requests should have produced 980,125 spans; the Collector accepted **718,942 — 26.6% dropped**, with `otelcol_receiver_refused_spans_total = 0` and `otelcol_exporter_send_failed_spans_total = 0`. Nothing was lost in the Collector; the loss is app-side, in the SDK's `BatchSpanProcessor` queue (default `maxQueueSize` 2048), and it logs nothing by default.
  - **Consequence: traces must not be the source of truth for the SLI.** The SLI comes from metrics (histogram buckets), which are aggregated in-process and do not drop per-event. Traces are for explaining a spike, not for counting one.
  - Mitigation is **sampling, not a bigger queue** — a `parentbased_traceidratio` sampler at a few percent under load, keeping 100% in dev. Raising `maxQueueSize` only moves the cliff.
  - Add app-side SDK self-telemetry so the drop is visible instead of inferred by arithmetic.
- **A DB down** → its Collector receiver reports the target down (visible as missing/zero USE metrics), which is itself signal.
- **Cardinality guard:** route label uses the matched route template (never raw path) — carry forward the `?? "unknown"` fix so unmatched paths can't explode cardinality.
- **Second cardinality guard, learned the hard way (2026-08-24):** the Collector's prometheus exporter must keep `resource_to_telemetry_conversion` **disabled**. Enabling it copies every resource attribute onto every series — `process_pid`, `process_command_args` (the full argv, hundreds of bytes), `process_executable_path`, `host_id` — taking each series from 1 label to 17, and `process_pid` alone mints a fresh time series on every restart. The exporter already derives `job=` from `service.name` and `instance=` from `service.instance.id`, which is the identity actually needed.

## Testing

- **`packages/observability-node`:** unit — with `OTEL_ENABLED=1` the SDK starts without throwing and registers the expected instrumentations; with it unset, importing is a no-op. Custom-metric helper returns a usable counter/histogram.
- **App suites stay green** (deliveroo + url-shortener) with OTEL unset — proves zero-overhead default and no regression from the prom-client→OTel migration.
- **Collector config validation:** `otelcol validate` (or container `--dry-run`) on `otel-collector-config.yaml`.
- **Stack smoke test:** bring up the stack + one app with `OTEL_ENABLED=1`, drive one request, assert (a) the service appears as a Prometheus target/metric, (b) a trace lands in Tempo, (c) the log line carries a `trace_id`.
- **Game-day is the integration test** for the SLO/alert path (manual, documented).

## Decisions (resolved 2026-08-24)

- **url-shortener metrics path — full OTel migration.** The OTel SDK exports traces + metrics over OTLP to the Collector; the prom-client `/metrics` route is removed rather than kept alongside. One instrumentation contract, one pipeline. Cost accepted: the existing prom-client instrumentation is rewritten, and the k6 dashboards are re-pointed at the Prometheus metrics the Collector exposes.
- **First SLO — p99 latency** (see §4). Availability is demoted to a dashboard panel.

## Open questions

- Collector metrics export: `prometheus` (pull, Collector exposes `/metrics`) vs `prometheusremotewrite` (push). Default to **pull** (simpler, Prometheus scrapes the Collector). Behind config; not blocking.
- Whether to port url-shortener's custom counters in the same task as the migration or a follow-up — sequencing decision for the plan, not the design.
