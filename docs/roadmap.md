# Roadmap — what to improve next

The system as it is today is in [`architecture/`](architecture/overview.md).
This file is what should change, **in priority order**, and why. Every item
links to the evidence that put it here.

When you finish an item, delete its row and record the result where it
belongs: an ADR if it was a decision, the progress log if it was study work,
a postmortem if something broke. This is a to-do list, not a history.

Study-plan work (quizzes, exercises, weak concepts) lives in
[`study/progress.md`](study/progress.md), not here.

## Now

| # | Improvement | Why | Done when |
|---|---|---|---|
| 1 | **Fix the stock race** in `placeOrder` three ways: `FOR UPDATE`, version-guarded `UPDATE`, `SERIALIZABLE` + retry on `40001` | Two concurrent orders can both read `stock = 1` and both succeed. Week 3 lab; also the lost-update the event-driven interview missed | `W3.*` green in [`acceptance.node.md`](../apps/deliveroo-node/acceptance.node.md); `scripts/bench-locking.ts` has recorded numbers for all three |
| 2 | **Availability dashboard** | [ADR 0008](decisions/0008-availability-slo.md) added the SLO with alerts but no panels; latency has 7 | a Grafana dashboard showing SLI, budget left, burn rate, 5xx rate by status, and the traffic-absent state |
| 3 | **Decide the broker** — set [ADR 0007](decisions/0007-broker-kafka-vs-rabbitmq.md) to Accepted or rewrite it | It has been Proposed since 2026-09-14, and the outbox work waits on it | status is Accepted; the chosen broker is in `apps/deliveroo-node/compose.yaml`; `infra/broker-spike/` is deleted |

## Next

| # | Improvement | Why | Done when |
|---|---|---|---|
| 4 | **Instrument deliveroo** with the same OTel preload as url-shortener | It sends no telemetry at all, so none of the observability work covers it | deliveroo spans in Tempo; `http_request_duration_seconds{job="deliveroo"}` in Prometheus (the Collector maps `service.name` to `job`) |
| 5 | **Transactional outbox** for order events | Publishing from inside `placeOrder` would be a dual write: DB-first loses events, broker-first invents phantom ones | `orders.outbox` table written in the order transaction; a relay using `FOR UPDATE SKIP LOCKED`; partial index `WHERE published_at IS NULL` |
| 6 | **Idempotent consumers** for whatever reads those events | At-least-once delivery guarantees duplicates | `consumed_events` insert with `ON CONFLICT DO NOTHING` **in the same transaction** as the side effect, keyed on the producer's `outbox.id`, never a broker id |
| 7 | **Alertmanager** | Every alert fires into a UI and pages nobody | a receiver configured; the game-day scenario produces a notification you actually see |
| 8 | **Close the idempotency check-then-act** in `placeOrder` | The key lookup runs outside the transaction; two simultaneous retries both miss it and the second fails on the `UNIQUE` constraint with a 500 | concurrent-replay test returns the same order both times, `201`, never `500` |

## Later

| # | Improvement | Why | Done when |
|---|---|---|---|
| 9 | **Saga** for order → payment | Payments run inside the order transaction today — fine in a monolith, the coupling Phase 3 exists to remove | payment is a separate step with a compensating action; orders and payments no longer share a transaction |
| 10 | **Routes for the rest of the state machine** | `CONFIRMED`, `DELIVERED`, and cancelling a paid order exist in `TRANSITIONS` but nothing reaches them | each edge has a route and a test; see [deliveroo state machine](architecture/deliveroo.md#order-state-machine) |
| 11 | **Week 4 surface**: pagination, OpenAPI, seed script, `v1-monolith` tag | The monolith milestone before splitting | `W4.*` green |
| 12 | **SLO for deliveroo** | No objective exists for the order path | after #4; an ADR defining it |
| 13 | **deliveroo `/health` → 503 on failure** | A failing `SELECT 1` throws and Fastify returns **500**; url-shortener returns 503 with a body | `/health` returns 503 + `{"status":"degraded"}` when Postgres is down |

## Housekeeping

| Item | Detail |
|---|---|
| Stale line numbers in [`acceptance.node.md`](../apps/deliveroo-node/acceptance.node.md) | `W3.marker-resolved` says `service.ts:42` (it's at `:78`); `W4.idempotent` says `service.ts:29` (it's at `:65`). Point at a grep pattern instead of a line number, so they stop drifting |
| `W3.version-col` expects a migration adding `version` | `001_init.sql` already has the column. Either the check is satisfied already or it should look for the column being **used** |
| Two copies of the `learn-sd` skill | `.claude/skills/learn-sd/` (in git) and `~/.claude/skills/learn-sd/` (the one that loads). They're identical today; edits to one don't reach the other. Symlink one to the other |
| `docs/study/exercises/example.prisma` | A Prisma schema (`Branch`, `DiningArea`, …) that belongs to no service in this repo. Confirm and remove |
| `docs/study/exercises/test.ts` | Base62 id-obfuscation code from the url-shortener exercise. Rename to something that says what it is |

## Accepted, not planned

Known limitations we've chosen to live with. They move up only if their
trigger condition happens.

| Limitation | Trigger to revisit |
|---|---|
| Click counts lost if the process dies between drain and `$inc` | clicks start to matter for billing or ranking |
| One Mongo, `SHARD_COUNT = 1` | data or write rate outgrows one node |
| Tempo keeps 24 h of traces on local disk | you need to investigate something older than a day |
