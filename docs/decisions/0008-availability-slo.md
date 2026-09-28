# 0008 — Add a redirect availability SLO

- **Status:** Accepted
- **Date:** 2026-09-21
- **Amends:** [0003](0003-first-slo-redirect-latency.md)

## Context
The [2026-08-30 game-day](../operations/postmortems/2026-08-30-redis-gameday.md)
killed Redis under load. The service died; every alert stayed green for about 15
minutes. The latency SLI divides by *successful* redirects, so when every request
fails it has nothing to measure — it goes absent, and an absent series satisfies
no threshold. This was a direct consequence of 0003 demoting availability.

## Decision
**99.9% of requests to `/:code` served without a 5xx, over 30 days** — a budget
of 0.1%, 43.2 minutes. The denominator is **all** requests to the route, which
keep counting when they fail, so a total failure reads 100% error instead of
vanishing. Same multi-window burn-rate alerts as latency, with thresholds 10×
smaller and shorter `for:`. Plus `RedirectTrafficAbsent` for the case where the
process is gone and no series exist at all.

## Alternatives
- **Keep only the `absent()` guard from 0003.** Lost: ~15 minutes to notice,
  and it can't tell "traffic stopped" from "everything failing".
- **Count 404 as an error.** Lost: an unknown code is a correct answer, and a
  crawler walking random codes would drain the budget in minutes.

## Consequences
- Two SLOs on one route. The game-day scenario is now a promtool test.
- Still no availability dashboard, and no Alertmanager — alerts fire into the
  UI only. Both on the [roadmap](../roadmap.md).

## Evidence
- `infra/observability/prometheus/rules.yml` sections 4–6; `rules_test.yml`, 9 tests
- [OTel design spec](../specs/2026-07-17-observability-otel-design.md) — "Gap found, then closed"
