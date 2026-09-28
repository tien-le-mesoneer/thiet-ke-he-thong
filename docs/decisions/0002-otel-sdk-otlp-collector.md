# 0002 — Instrument with the OTel SDK over OTLP to a Collector; drop prom-client

- **Status:** Accepted
- **Date:** 2026-08-24

## Context
url-shortener exposed a `prom-client` `/metrics` route and printed traces to
the console. Two metric paths would mean two sources of truth, and nothing
collected the traces.

## Decision
Traces and metrics both leave the app through the OpenTelemetry SDK over OTLP to
one Collector. The Collector exports metrics to Prometheus (scraped from
`:8889`) and traces to Tempo. `prom-client` and the `/metrics` route are
removed. The SDK is preloaded with `--import` and is a no-op unless
`OTEL_ENABLED=1`.

## Alternatives
- **Keep `prom-client` for metrics, OTel for traces only.** Lost: two metric
  pipelines, two label conventions.
- **Apps push straight to Prometheus / Tempo.** Lost: every app would need to
  know every backend; the Collector is the one place to batch, sample, and
  reroute.

## Consequences
- `metrics.getMeter()` binds to whatever provider is global **when it is first
  called** and never re-binds, so the SDK must start before `metrics.js` loads.
- `tsx watch` does not pass env to the process it respawns, so a sampler or
  OTLP endpoint set on a watch script is silently ignored. Load tests and
  containers use watch-free scripts.
- `resource_to_telemetry_conversion` must stay off (17 labels per series when on).

## Evidence
- [OTel design spec](../specs/2026-07-17-observability-otel-design.md)
- [progress log](../study/progress.md), 2026-08-24 slice 3 and the cardinality fix
