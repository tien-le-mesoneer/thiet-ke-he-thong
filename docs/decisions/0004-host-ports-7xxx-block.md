# 0004 — Publish observability ports on a dedicated 7xxx block

- **Status:** Accepted
- **Date:** 2026-08-24

## Context
The stack's upstream defaults (3000, 9090, 4317/4318) collided with the apps and
with an older prometheus/grafana pair in the app compose file. macOS AirPlay
holds 5000 and 7000.

## Decision
Every observability **host** port moves to 7xxx, keeping the upstream port's
last digits: 9090 → 7090, 4318 → 7318, 3200 → 7200. Grafana is the exception —
3000 would become 7000, which AirPlay holds — so it is 7080. Container-internal ports
stay at upstream defaults. All overridable in `infra/observability/.env`.

## Alternatives
- **Remap container-internal ports too.** Lost: every vendored config and scrape
  target would need editing.
- **Random free ports.** Lost: unmemorable, and the digit rule makes each one
  guessable.

## Consequences
- Containers reach each other on upstream ports (`otel-collector:4318`); only
  the host sees 7xxx. Two addresses for the same thing — the one real cost.
- RabbitMQ's management UI breaks the rule (7673), because 15672 → 7672 would
  collide with AMQP.

## Evidence
- [progress log](../study/progress.md), 2026-08-24 port move
- [architecture overview — host ports](../architecture/overview.md#host-ports)
