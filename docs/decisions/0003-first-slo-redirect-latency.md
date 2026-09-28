# 0003 — Make redirect latency the first SLO, counted not interpolated

- **Status:** Accepted — amended by [0008](0008-availability-slo.md)
- **Date:** 2026-08-24

## Context
The observability build needed one SLO to drive alerts and dashboards
end to end. A latency SLO exercises histograms and tail behaviour; an
availability SLO is simpler and teaches less.

## Decision
**99% of redirects (`GET /:code` → 302) served in under 50 ms, over 30 days.**
The SLI is **counted**: good ÷ total, where good is the histogram bucket at
`le="0.05"`. The latency buckets must contain `0.05` exactly, and a test asserts
it. Availability is shown as a dashboard panel, not an SLO.

## Alternatives
- **p99 from `histogram_quantile()`.** Lost: interpolated. Removing the `0.05`
  bucket edge made the reported burn **2.5×** worse from the same data.
- **Availability first.** Lost at the time for teaching value. That was the
  wrong trade — see Consequences.

## Consequences
- The SLI filters `status="302"`, so in a total outage it goes **absent, not
  bad**. The [2026-08-30 game-day](../operations/postmortems/2026-08-30-redis-gameday.md)
  killed the service and every alert stayed green for ~15 minutes.
  [0008](0008-availability-slo.md) closes that gap.
- Changing the SLO threshold means changing the bucket list in the same commit.

## Evidence
- [OTel design spec](../specs/2026-07-17-observability-otel-design.md)
- [progress log](../study/progress.md), 2026-08-24 correction: the claimed "33%
  interpolation error" compared different windows; matched data gave 1.6%, and
  the real argument is bucket width.
