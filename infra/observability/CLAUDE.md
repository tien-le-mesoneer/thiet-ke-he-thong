# infra/observability

Monorepo telemetry stack. Apps run on the **host** and export OTLP; only the
backends are containerised. Design spec: `docs/superpowers/specs/2026-07-17-observability-otel-design.md`.

```
app ──OTLP:7318──► Collector ──► Tempo ──┐
                       │                 ▼
                       └─:7889──► Prometheus ──► Grafana
```

## Run

```bash
podman compose -f infra/observability/compose.yaml start   # or `up -d` first time
```

Grafana **7080** · Prometheus **7090** · Tempo **7200** · OTLP **7318**/7317 ·
health **7133** · app-metrics **7889**. All ports in `.env`.

## Rules

- **Host ports only.** Container-internal ports keep upstream defaults; never
  remap those, or every scrape target and vendored config breaks.
- **Ports live on 7xxx**, clear of 3000/9090/4317 and macOS AirPlay (5000/7000).
  Each keeps its upstream default's digits — 9090→7090, 4318→7318.
- **8888 (Collector self-metrics) is unpublished on purpose.** Query it through
  Prometheus, not curl.
- **`resource_to_telemetry_conversion` stays disabled.** Enabling it stamps
  `process_pid` and the full argv onto every series — 17 labels instead of 1,
  and new series on every restart.
- **Never `avg()` a percentile** across instances or windows. Sum buckets, then
  recompute.
- **After a restart, `sum()` on a counter double-counts** for ~5 min — Prometheus
  keeps the dead instance's series. Use `increase(...[5m])`.
- **Tempo needs 30–60s to become `/ready`.** Slower than everything else; not a
  fault.

## Alerts

`prometheus/rules.yml` — SLO is 99% of redirects under 50 ms / 30 days.
Multi-window burn-rate: 14.4× critical (1h+5m), 6× warning (6h+30m), 1× ticket
(3d+6h), plus an `absent()` guard.

Change a rule → run the unit tests:

```bash
podman run --rm --entrypoint promtool -v "$PWD/infra/observability/prometheus:/p:ro" -w /p docker.io/prom/prometheus:v3.2.1 test rules rules_test.yml
```

**The SLI is counted, not interpolated** — `good/total` from bucket `le="0.05"`.
That bucket edge must match the SLO threshold exactly; without it the reported
burn inflates ~2.5×. `histogram_quantile()` is for dashboards only.

**Known gap:** the SLI filters `status="302"`, so a total outage makes it go
*absent*, not *bad*. `RedirectLatencySLIMissing` covers it; a real availability
SLO is still unwritten.

## Status

Slices 1–4 done (pipeline, Tempo, OTel metrics + SLI, burn-rate alerts).
Slice 5 — game-day — remains. Details in `README.md`.
