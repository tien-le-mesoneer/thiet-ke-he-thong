# Application-Wide Observability (OpenTelemetry-first) — Design Spec

**Date:** 2026-07-17
**Status:** Approved design, pending implementation plan
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
- Reads `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`) from env.
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
- Define **one SLO**: url-shortener redirect availability (non-5xx) ≥ 99.9% over 30 days (or p99 < 50 ms — pick availability as the SLI).
- `rules.yml`: a recording rule for the SLI + a **multi-window multi-burn-rate** alert (fast + slow windows, Google-SRE style) that fires on error-budget burn. Surfaced in the SLO dashboard; no external routing.

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
- **A DB down** → its Collector receiver reports the target down (visible as missing/zero USE metrics), which is itself signal.
- **Cardinality guard:** route label uses the matched route template (never raw path) — carry forward the `?? "unknown"` fix so unmatched paths can't explode cardinality.

## Testing

- **`packages/observability-node`:** unit — with `OTEL_ENABLED=1` the SDK starts without throwing and registers the expected instrumentations; with it unset, importing is a no-op. Custom-metric helper returns a usable counter/histogram.
- **App suites stay green** (deliveroo + url-shortener) with OTEL unset — proves zero-overhead default and no regression from the prom-client→OTel migration.
- **Collector config validation:** `otelcol validate` (or container `--dry-run`) on `otel-collector-config.yaml`.
- **Stack smoke test:** bring up the stack + one app with `OTEL_ENABLED=1`, drive one request, assert (a) the service appears as a Prometheus target/metric, (b) a trace lands in Tempo, (c) the log line carries a `trace_id`.
- **Game-day is the integration test** for the SLO/alert path (manual, documented).

## Open questions

- Collector metrics export: `prometheus` (pull, Collector exposes `/metrics`) vs `prometheusremotewrite` (push). Default to **pull** (simpler, Prometheus scrapes the Collector). Behind config; not blocking.
- Whether to port url-shortener's custom counters in the same task as the migration or a follow-up — sequencing decision for the plan, not the design.
