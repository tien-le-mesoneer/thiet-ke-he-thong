# Observability stack

Monorepo-wide telemetry backend. Implements
[the OTel design spec](../../docs/superpowers/specs/2026-07-17-observability-otel-design.md).

**Services run on the host; only the backends are containerised.** Apps export
OTLP to `localhost:7318`, the Collector fans out from there.

```
apps (host, OTEL_ENABLED=1) ──OTLP:7318──► OTel Collector ──► Tempo ──┐
                                                 │                    ▼
                                                 └─:7889──► Prometheus ──► Grafana
```

## Ports

Everything is published on the **7xxx block** so it never collides with the
usual defaults (3000, 9090, 4317/4318) or with macOS AirPlay on 5000/7000.
Each port keeps its upstream default's digits, so the mapping is memorable:

| Service | Host | Container | Mnemonic |
|---|---|---|---|
| Grafana | **7080** | 3000 | web UI |
| Prometheus | **7090** | 9090 | `9090` → `7090` |
| Tempo *(slice 2)* | **7200** | 3200 | `3200` → `7200` |
| Collector OTLP gRPC | **7317** | 4317 | `4317` → `7317` |
| Collector OTLP HTTP | **7318** | 4318 | `4318` → `7318` |
| Collector health | **7133** | 13133 | `13133` → `7133` |
| Collector app-metrics | **7889** | 8889 | `8889` → `7889` |
| Collector self-metrics | *unpublished* | 8888 | reachable only in-network |

**Only the host side is remapped.** Container-internal ports keep their upstream
defaults, so every scrape target, dashboard, and config stays standard. Override
any of them in [`.env`](.env).

## Run

```bash
podman compose -f infra/observability/compose.yaml up -d
```

| Service | URL | Notes |
|---|---|---|
| Grafana | http://localhost:7080 | anonymous admin, no login |
| Prometheus | http://localhost:7090 | |
| Collector OTLP | `localhost:7318` (HTTP), `7317` (gRPC) | what apps export to |
| Tempo | http://localhost:7200 | trace storage; query it via Grafana, it has no UI |
| Collector health | http://localhost:7133 | |

Then start an instrumented app:

```bash
cd apps/url-shortener-node && npm run dev:otel
```

`dev:otel` sets `OTEL_ENABLED=1` and `OTEL_SERVICE_NAME=url-shortener`.
**Without `OTEL_ENABLED=1` the SDK never starts** — tests and plain `npm run dev`
carry zero OTel overhead.

## View it

**Dashboard: [SLO — Redirect Latency](http://localhost:7080/d/slo-redirect-latency/slo-e28094-redirect-latency)**
— the one to open first: SLI, error budget remaining, and burn rate by window.

**Dashboard: [OTel Pipeline Health](http://localhost:7080/d/otel-pipeline-health/otel-pipeline-health)**
— `http://localhost:7080/d/otel-pipeline-health/otel-pipeline-health`

It answers one question: *is telemetry actually arriving?* It runs on the
Collector's **own** self-telemetry, so it works before any app metrics exist.

| Panel | Read it as |
|---|---|
| Spans accepted vs exported | the two lines must overlap; a gap = Collector dropping |
| Spans lost inside the Collector | flat zero is healthy |
| Spans accepted / dropped / uptime / RSS | at-a-glance stats; uptime resets = a crash |
| Batch size sent | batches growing = pipeline saturating |
| What triggered each batch send | timeout→size crossover = the "quiet → busy" moment |

To put traffic through it:

```bash
cd apps/url-shortener-node
npm run dev:otel &          # host app, OTLP -> localhost:7318
k6 run load/redirect.js     # 2 min ramp to 200 VUs
```

### The span loss had a surprising cause

Slice 1 measured 26.6% of spans vanishing app-side and blamed the SDK's
`BatchSpanProcessor` queue. Half right. Re-measured after slice 2 pointed traces
at Tempo — same app, same SDK, same 2048-span queue, **100% sampling**:

| traces exported to | throughput | requests | spans arrived | lost |
|---|---|---|---|---|
| `debug` (stdout, verbose) | 8,166 req/s | 980,125 | 718,942 | **26.6%** |
| Tempo (OTLP gRPC) | 10,466 req/s | 471,176 | 471,177 | **0%** |

Higher load, zero loss. The `debug` exporter was formatting every span to stdout,
throttling the Collector, which backpressured the app until its queue overflowed.
**The debugging aid was the bottleneck.**

Sampling is still wired up (`npm run load:otel`, 10% default, measured 9.93%) —
now for cost rather than correctness.

⚠️ **`tsx watch` does not propagate the sampler env** to the server it re-spawns,
so `dev:otel` always traces at 100%. That is why `load:otel` exists as a separate
non-watch script — use it for load tests and the game-day.

### ⚠️ The dashboard cannot see the biggest drop

"Spans lost inside the Collector" stays at **zero** while spans are being lost —
because they never reach the Collector. Measured 2026-08-24:

| load | requests | spans expected | accepted | **lost** |
|---|---|---|---|---|
| 6,956 req/s | 487,108 | 487,108 | 402,549 | **17.4%** |
| 8,166 req/s | 980,125 | 980,125 | 718,942 | **26.6%** |

All of it is app-side, in the SDK's `BatchSpanProcessor` queue (default
`maxQueueSize` 2048), and **nothing logs a warning**. The loss scales with load.

Two consequences, both now in the spec:
- **The SLI must come from metrics, not traces.** Histograms aggregate
  in-process and don't drop per event. A trace explains a spike; it can't count one.
- **The fix is sampling, not a bigger queue** — a bigger queue only moves the cliff.

## Burn-rate alerts

`prometheus/rules.yml` records the error ratio at five windows and pairs them
into multi-window, multi-burn-rate alerts (Google SRE workbook style). Each
alert needs a **long** window (is this real?) *and* a **short** one (is it still
happening?) — the long one rejects brief spikes, the short one lets the alert
clear promptly on recovery instead of smouldering.

| Alert | Burn | Long / short | Meaning | Severity |
|---|---|---|---|---|
| `RedirectLatencyBudgetBurnCritical` | 14.4× | 1h / 5m | 2% of the 30d budget per hour — gone in ~2 days | page |
| `RedirectLatencyBudgetBurnHigh` | 6× | 6h / 30m | 5% per 6h — working hours, not 3am | warning |
| `RedirectLatencyBudgetBurnSlow` | 1× | 3d / 6h | exactly sustainable, so no headroom for a real incident | ticket |
| `RedirectLatencySLIMissing` | — | 10m | the SLI has no data at all | warning |

### The blind spot this makes visible

The SLI filters to `status="302"`, so in a **total outage it goes absent, not
bad** — every request 500s, leaving no successful redirects to be slow, and a
latency-only dashboard stays serenely green while the service is down.
`RedirectLatencySLIMissing` is the stopgap that surfaces it. The real fix is a
separate availability SLO, which this build has not yet written.

### Testing the alerts

An alert that has never fired is a wish. Rather than melting the service to find
out, the rules are unit-tested against synthetic series:

```bash
podman run --rm --entrypoint promtool \
  -v "$PWD/infra/observability/prometheus:/p:ro" -w /p \
  docker.io/prom/prometheus:v3.2.1 test rules rules_test.yml
```

Four cases, all passing: a 20× burn fires critical; healthy traffic (0.1× burn)
fires nothing; an 8× burn fires *high* but **not** critical — the case that
catches a copy-paste error between the two expressions; and an absent SLI trips
the guard.

## Verify the pipeline

The Collector's own telemetry is the source of truth for "did my data arrive":

```bash
curl -s 'http://localhost:7090/api/v1/query?query=otelcol_receiver_accepted_spans_total'
```

`otelcol_receiver_accepted_spans_total` should climb as you drive traffic, and
`otelcol_exporter_sent_spans_total` should match it. A gap between the two means
the Collector is dropping data — check `podman logs sd-observability_otel-collector_1`.

Note port **8888** (Collector self-metrics) is deliberately *not* published to the
host; Prometheus reaches it inside the compose network. Query it via Prometheus,
not curl.

**Careful with `sum()` right after a restart.** A restarted Collector resets its
counters, but Prometheus keeps the old series for ~5 minutes, so a bare
`sum(otelcol_receiver_accepted_spans_total)` silently adds the dead instance's
final value to the live one. Use `increase(...[5m])` when you want "what happened
recently" — it is immune to both the reset and the stale series.

## Slice status

| Slice | State |
|---|---|
| 1 — Collector + Prometheus + Grafana, traces over OTLP, pipeline-health dashboard | ✅ done |
| 3 — prom-client → OTel metrics + latency histogram w/ 50 ms bucket | ✅ done |
| 2 — Tempo; traces visible in Grafana | ✅ done |
| 4 — SLI recording rule + multi-window burn-rate alert + SLO dashboard | ✅ done |
| 5 — k6 load + game-day (kill Redis, spike → trace → log) | ⬜ |

Slice 3 jumped ahead of slice 2 deliberately: once traces proved lossy under
load, the metric path became the one the SLI depends on, and Tempo is only
visualisation.

## The SLI

The SLO is **99% of redirects served in under 50 ms**. A latency SLI is
**counted, not averaged** — `good / total`, where *good* is the bucket count at
or below the threshold:

```promql
sum(http_request_duration_seconds_bucket{route="/:code",status="302",le="0.05"})
/
sum(http_request_duration_seconds_count{route="/:code",status="302"})
```

Measured 2026-08-24 over 322,924 requests at 8,070 req/s: **99.8943%** — passing,
with 10.6% of the 1% error budget consumed.

**Why counted rather than interpolated.** Not because interpolation is wildly
inaccurate — on matched data (364,240 requests, k6 `p(99)=22.47 ms`)
`histogram_quantile` returns 22.82 ms, off by just 1.6%.

The reason is **bucket width**. Interpolation assumes latency is uniformly
distributed inside a bucket; it never is. With the 50 ms boundary present the
SLI is counted exactly — 363,609 / 364,240 = 99.8268%, **17.3%** of budget.
Delete that one boundary and the enclosing bucket becomes `0.025 → 0.1`;
interpolating the same SLI yields 99.5633%, or **43.7%** of budget. Identical
data, **2.5× the reported burn** — and that factor grows with the bucket.

Use `histogram_quantile` for dashboards and trends; never for the error budget.

## Note on the app-level stack

`apps/url-shortener-node/compose.yaml` used to carry its own Prometheus + Grafana
on 9090/3002, scraping the app's prom-client endpoint directly. **Removed** — this
stack supersedes it, and leaving two Grafanas fighting over one port was exactly
the collision the 7xxx move exists to prevent. Until slice 3 retires prom-client,
its metrics are still readable directly at `localhost:3001/metrics`.
