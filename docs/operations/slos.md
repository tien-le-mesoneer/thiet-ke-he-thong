# Service level objectives

Both SLOs cover **url-shortener's redirect route**, `GET /:code`. deliveroo has
none yet — it isn't instrumented. Rules live in
`infra/observability/prometheus/rules.yml`; tests in `rules_test.yml`.

| | Latency | Availability |
|---|---|---|
| **Objective** | 99% of redirects under 50 ms | 99.9% of requests without a 5xx |
| **Window** | 30 days | 30 days |
| **Budget** | 1% of redirects | 0.1% = **43.2 minutes** |
| **Good event** | `status="302"` and `le="0.05"` | any status that isn't `5..` |
| **Denominator** | successful redirects (`302`) | **all** requests to `/:code` |
| **In a total outage** | goes **absent** | reads **100% error** |
| **Decision** | [ADR 0003](../decisions/0003-first-slo-redirect-latency.md) | [ADR 0008](../decisions/0008-availability-slo.md) |

The denominator row is the whole reason there are two. See the
[game-day postmortem](postmortems/2026-08-30-redis-gameday.md).

**404 is good for availability.** An unknown short code is a correct answer.
A test asserts that a 100% 404 rate fires nothing.

## Burn-rate alerts

Same structure for both: each alert pairs a **long** window (is this real?)
with a **short** one (is it still happening?), so it ignores blips and clears
promptly after recovery.

| Burn | Spends | Windows | Latency alert (`for`) | Availability alert (`for`) | Severity |
|---|---|---|---|---|---|
| 14.4× | 2% of budget / hour | 1h + 5m | `…LatencyBudgetBurnCritical` (2m) | `…AvailabilityBudgetBurnCritical` (1m) | critical |
| 6× | 5% / 6 hours | 6h + 30m | `…LatencyBudgetBurnHigh` (15m) | `…AvailabilityBudgetBurnHigh` (10m) | warning |
| 1× | on track to exhaust in 30d | 3d + 6h | `…LatencyBudgetBurnSlow` (1h) | `…AvailabilityBudgetBurnSlow` (1h) | ticket |

Availability's thresholds are 10× smaller (budget 0.001, not 0.01) and its
`for:` is shorter: a slow redirect can wait two minutes, a 5xx storm can't.

## Guards — when there's nothing to measure

| Alert | Fires when | `for` | Severity |
|---|---|---|---|
| `RedirectTrafficAbsent` | no requests to `/:code` at all, any status | 2m | critical |
| `RedirectLatencySLIMissing` | no *successful* redirects | 10m | warning |

A dead process exports nothing, and Prometheus drops its series after ~5
minutes. Neither SLI can go bad without data, so these exist.

## Change an SLO

1. Change the threshold in `rules.yml` **and** in the app. For latency, the
   bucket list in `apps/url-shortener-node/src/otel.ts` must contain the new
   threshold exactly — `SLO_THRESHOLD_S` and a test enforce it.
2. Run the unit tests (podman machine must be up):
   ```bash
   podman run --rm --entrypoint promtool -v "$PWD/infra/observability/prometheus:/p:ro" -w /p docker.io/prom/prometheus:v3.2.1 test rules rules_test.yml
   ```
3. Write an ADR that supersedes or amends the current one.

## Gaps

- **No Alertmanager.** Alerts fire into the Prometheus and Grafana UIs and page nobody.
- **No availability dashboard.** Latency has 7 panels; availability has none.
- **No SLO for deliveroo.**

All three are on the [roadmap](../roadmap.md).
