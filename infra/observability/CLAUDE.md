# infra/observability

Monorepo telemetry stack. Apps run on the **host** and export OTLP; only the
backends are containerised. Design spec: `docs/specs/2026-07-17-observability-otel-design.md`.

```
app ──OTLP:7318──► Collector ──► Tempo ──┐
                       │                 ▼
                       └─:7889──► Prometheus ──► Grafana
```

## Run

```bash
podman network create sd-net          # once; apps join this to reach the Collector
podman compose -f infra/observability/compose.yaml up -d
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
- **Temporary stacks add scrape targets by dropping a file into
  `prometheus/scrape/`**, not by editing `prometheus.yml` — and remove it when
  they come down, or Prometheus keeps a permanently-DOWN job. The dropped-in
  file must be a **mapping with a `scrape_configs:` key**; a bare list exits 2
  with `cannot unmarshal !!seq into config.ScrapeConfigs`.
- **Tempo needs 30–60s to become `/ready`.** Slower than everything else; not a
  fault.

## Alerts

`prometheus/rules.yml` — **two** SLOs, 22 rules, 9 promtool tests.

| SLO | Target | Budget / 30d | SLI |
|---|---|---|---|
| Redirect latency | 99% under 50 ms | 1% | `le="0.05"` bucket / total 302s |
| Redirect availability | 99.9% non-5xx | 0.1% = 43.2 min | 5xx / **all** requests to `/:code` |

Both use the same multi-window burn-rate shape: 14.4× critical (1h+5m), 6×
warning (6h+30m), 1× ticket (3d+6h). Availability thresholds are 10× smaller
because its budget is 10× tighter, and its `for:` is shorter — a slow redirect
can wait two minutes, a 5xx storm cannot.

Change a rule → run the unit tests:

```bash
podman run --rm --entrypoint promtool -v "$PWD/infra/observability/prometheus:/p:ro" -w /p docker.io/prom/prometheus:v3.2.1 test rules rules_test.yml
```

**The SLI is counted, not interpolated** — `good/total` from bucket `le="0.05"`.
That bucket edge must match the SLO threshold exactly; without it the reported
burn inflates ~2.5×. `histogram_quantile()` is for dashboards only.

**The latency SLI filters `status="302"`, so a total outage makes it go
*absent*, not *bad*** — the game-day's worst finding. That gap is now closed by
the availability SLO, whose denominator counts failures and so reads 100% error
instead of vanishing. Two guards cover the case neither SLI can see — a dead
process exports nothing at all, and after ~5 min Prometheus ages the series out:
`RedirectTrafficAbsent` (2 min, critical, unfiltered by status) and the older
`RedirectLatencySLIMissing` (10 min, warning, 302-only).

**404 is not an availability error.** An unknown short code is a correct
answer; only 5xx counts. A test asserts this, because a crawler walking random
codes would otherwise drain a 43-minute budget in minutes.

## Status

All five slices done: pipeline, Tempo, OTel metrics + SLI, burn-rate alerts,
and the 2026-08-30 game-day (which found three real bugs and the availability
gap now closed above). Details in `README.md` and the [game-day postmortem](../../docs/operations/postmortems/2026-08-30-redis-gameday.md).
