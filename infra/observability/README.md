# Observability stack

Monorepo-wide telemetry backend. Implements
[the OTel design spec](../../docs/superpowers/specs/2026-07-17-observability-otel-design.md).

**Services run on the host; only the backends are containerised.** Apps export
OTLP to `localhost:7318`, the Collector fans out from there.

```
apps (host, OTEL_ENABLED=1) ──OTLP:7318──► OTel Collector ──► debug (stdout)   [traces, slice 1]
                                                 │
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
| Collector health | http://localhost:7133 | |

Then start an instrumented app:

```bash
cd apps/url-shortener-node && npm run dev:otel
```

`dev:otel` sets `OTEL_ENABLED=1` and `OTEL_SERVICE_NAME=url-shortener`.
**Without `OTEL_ENABLED=1` the SDK never starts** — tests and plain `npm run dev`
carry zero OTel overhead.

## View it

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
| 2 — Tempo; traces visible in Grafana | ⬜ next |
| 3 — prom-client → OTel metrics + latency histogram w/ 50 ms bucket | ⬜ |
| 4 — SLI recording rule + multi-window burn-rate alert + SLO dashboard | ⬜ |
| 5 — k6 load + game-day (kill Redis, spike → trace → log) | ⬜ |

Until slice 3, **app metrics still come from prom-client on the app's own
`/metrics`** and do not flow through the Collector — `localhost:8889` is
legitimately empty right now.

## Note on the app-level stack

`apps/url-shortener-node/compose.yaml` used to carry its own Prometheus + Grafana
on 9090/3002, scraping the app's prom-client endpoint directly. **Removed** — this
stack supersedes it, and leaving two Grafanas fighting over one port was exactly
the collision the 7xxx move exists to prevent. Until slice 3 retires prom-client,
its metrics are still readable directly at `localhost:3001/metrics`.
