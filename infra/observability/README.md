# Observability stack

Monorepo-wide telemetry backend. Implements
[the OTel design spec](../../docs/superpowers/specs/2026-07-17-observability-otel-design.md).

**Services run on the host; only the backends are containerised.** Apps export
OTLP to `localhost:4318`, the Collector fans out from there.

```
apps (host, OTEL_ENABLED=1) ──OTLP:4318──► OTel Collector ──► debug (stdout)   [traces, slice 1]
                                                 │
                                                 └─:8889──► Prometheus ──► Grafana
```

## Run

```bash
podman compose -f infra/observability/compose.yaml up -d
```

| Service | URL | Notes |
|---|---|---|
| Grafana | http://localhost:3002 | anonymous admin, no login |
| Prometheus | http://localhost:9090 | |
| Collector OTLP | `localhost:4318` (HTTP), `4317` (gRPC) | what apps export to |
| Collector health | http://localhost:13133 | |

Then start an instrumented app:

```bash
cd apps/url-shortener-node && npm run dev:otel
```

`dev:otel` sets `OTEL_ENABLED=1` and `OTEL_SERVICE_NAME=url-shortener`.
**Without `OTEL_ENABLED=1` the SDK never starts** — tests and plain `npm run dev`
carry zero OTel overhead.

## Verify the pipeline

The Collector's own telemetry is the source of truth for "did my data arrive":

```bash
curl -s 'http://localhost:9090/api/v1/query?query=otelcol_receiver_accepted_spans_total'
```

`otelcol_receiver_accepted_spans_total` should climb as you drive traffic, and
`otelcol_exporter_sent_spans_total` should match it. A gap between the two means
the Collector is dropping data — check `podman logs sd-observability_otel-collector_1`.

Note port **8888** (Collector self-metrics) is deliberately *not* published to the
host; Prometheus reaches it inside the compose network. Query it via Prometheus,
not curl.

## Slice status

| Slice | State |
|---|---|
| 1 — Collector + Prometheus + Grafana, traces over OTLP | ✅ done |
| 2 — Tempo; traces visible in Grafana | ⬜ next |
| 3 — prom-client → OTel metrics + latency histogram w/ 50 ms bucket | ⬜ |
| 4 — SLI recording rule + multi-window burn-rate alert + SLO dashboard | ⬜ |
| 5 — k6 load + game-day (kill Redis, spike → trace → log) | ⬜ |

Until slice 3, **app metrics still come from prom-client on the app's own
`/metrics`** and do not flow through the Collector — `localhost:8889` is
legitimately empty right now.

## Note on the app-level stack

`apps/url-shortener-node/compose.yaml` has its own Prometheus + Grafana under the
`observability` profile, scraping the app's prom-client endpoint directly. It is
superseded by this stack and should be removed in slice 3 when prom-client goes
away. Both bind Grafana to 3002 — don't run them at once.
