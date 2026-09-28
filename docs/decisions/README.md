# Architecture decision records

One decision per file. A decision is **immutable once accepted**: if it changes,
write a new ADR that supersedes it, and set the old one's status to
`Superseded by NNNN`. The history of *why we changed our mind* is the point.

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-url-shortener-mongo-and-redis.md) | url-shortener uses MongoDB + Redis, deliberately over-built | Accepted | 2026-07-16 |
| [0002](0002-otel-sdk-otlp-collector.md) | Telemetry: OTel SDK → OTLP → Collector; drop prom-client | Accepted | 2026-08-24 |
| [0003](0003-first-slo-redirect-latency.md) | First SLO is redirect latency, counted not interpolated | Accepted, amended by 0008 | 2026-08-24 |
| [0004](0004-host-ports-7xxx-block.md) | Host ports on the 7xxx block | Accepted | 2026-08-24 |
| [0005](0005-tests-on-throwaway-stores.md) | Tests run on dedicated `_test` stores behind a guard | Accepted | 2026-08-24 |
| [0006](0006-containerise-apps-per-area-compose.md) | Apps in containers, one compose file per area, two memory ceilings | Accepted | 2026-08-30 |
| [0007](0007-broker-kafka-vs-rabbitmq.md) | Broker: Kafka, recording that RabbitMQ is the better engineering answer | **Proposed** | 2026-09-14 |
| [0008](0008-availability-slo.md) | Add a redirect availability SLO | Accepted | 2026-09-21 |

0001–0006 and 0008 were written on 2026-09-28 from decisions that already
existed in specs and the progress log; the date is when the decision was made.
0007 is a full measured comparison and much longer than the rest.

## Template

```markdown
# NNNN — Title in the imperative

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
What forced a choice. Numbers, not adjectives.

## Decision
One paragraph. What we do.

## Alternatives
What else was on the table, and the one reason each lost.

## Consequences
What gets easier, what gets harder, what we now have to maintain.

## Evidence
Links to the spec, measurement, log entry, or postmortem.
```
