# Broker Selection: Kafka vs RabbitMQ — ADR

**Date:** 2026-09-14
**Status:** Proposed — decision recorded below, awaiting confirmation
**Scope:** `apps/deliveroo-node` Week 7 (transactional outbox + event-driven notifications), and everything downstream of it in Phase 2–3.
**Supersedes:** the unjustified "Add **Kafka** (or NATS JetStream)" in `docs/system-design-plan-detailed.md:50`.

## Purpose

The study plan names Kafka without an argument. This ADR supplies the argument —
or overturns it. Both brokers were run, instrumented, and benchmarked on the
workload this repo will actually have: an outbox relay draining rows in batches
of 100 (`SELECT … WHERE published_at IS NULL LIMIT 100 FOR UPDATE SKIP LOCKED`).

Spike lives in `infra/broker-spike/` and is throwaway. Reproduce with:

```bash
podman compose -f infra/broker-spike/compose.yaml up -d
node infra/broker-spike/bench.mjs kafka  --count 200000 --batch 100
node infra/broker-spike/bench.mjs rabbit --count 200000 --batch 100
node infra/broker-spike/steady.mjs kafka 500 20
```

## The requirement, stated before the measurements

**10,000 events/day.** That is **0.116 events/s** average and, at the ×10 peak
factor used elsewhere in this repo, **1.16 events/s**. Ordering is not required
(established during the event-driven interview: a version guard on the consumer
makes out-of-order delivery harmless — see `transitionOrder` in
`apps/deliveroo-node/src/modules/orders/service.ts:36`).

Writing this down first matters, because every throughput number below is four
to five orders of magnitude above it, and a comparison that leads with
throughput would be measuring something nobody needs.

## Measurements

Single podman VM (5 CPU, 4 GiB), client and broker on the same machine, Kafka
3.9.0 (KRaft, single node, 4 partitions, RF=1) and RabbitMQ 4.0.9. Both
configured for the strongest durability each offers on one node.

### Footprint — the stable, repeatable difference

| | Kafka | RabbitMQ | ratio |
|---|---|---|---|
| Image size | 412 MB | 261 MB | 1.6× |
| Cold boot to serving (from container logs) | 2.04 s | 2.22 s | tie |
| Idle RSS @ 1 g cap, settled | **301.1 MB** | **99.4 MB** | **3.0×** |
| + metrics sidecar | 2.5 MB (kafka-exporter) | 0 (built in) | — |
| Peak RSS, 200k events @ 1 g cap | 639.2 MB | 207.7 MB | 3.1× |
| Peak RSS at floor cap | 430.3 MB of 512 m (**84 %**) | 175.9 MB of 256 m (**69 %**) | — |
| **Floor that survives a 200k run** | **512 m + `-Xmx256m`** | **256 m** | **2×** |

Neither was OOM-killed at its floor. Kafka at 84 % of its cap is thin headroom
by this repo's own standard (the Node apps were given 256 m for a 155 MB peak),
so the honest Kafka number to budget is **768 m**, against RabbitMQ's 256 m.

### Throughput — Kafka wins, and it does not matter

Three runs, showing the spread honestly:

| | Kafka | RabbitMQ |
|---|---|---|
| publish, one awaited ack per message | 1,111 – 2,171 msg/s | 1,549 – 1,874 msg/s |
| publish, batches of 100 | 58,085 – 105,848 msg/s | 32,070 – 47,298 msg/s |
| bulk consume (drain a backlog) | 38,365 – 263,090 msg/s | 40,843 – 72,553 msg/s |

Kafka is consistently faster at batched publish and bulk consume. The **multiple
is noisy** (Kafka's batched publish varied 1.8× across runs, RabbitMQ's 1.5×) —
on a laptop VM these numbers support "Kafka is faster", not "Kafka is 2.9×
faster". Memory, by contrast, reproduced within a few percent every time.

Two traps in the consume column, both worth naming:

- At 20k events Kafka measured **38,365 msg/s** and RabbitMQ **60,407 msg/s** —
  RabbitMQ apparently winning. At 200k, Kafka measured **263,090** and RabbitMQ
  **40,843**. The 20k run was dominated by Kafka's ~0.5 s consumer-group join,
  a *fixed* cost. **A small benchmark measured startup and called it throughput.**
- These are backlog-drain figures. They answer "how fast does a 200k backlog
  clear", not "how long does one event take" — which is the question that
  actually matters here.

### Steady-state latency — the number that matches the requirement

Consumer already running, one event every 20 ms (50/s, still ~43× the real peak):

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Kafka | 1.29 ms | 3.93 ms | **10.03 ms** | 23.16 ms |
| RabbitMQ | 1.52 ms | 4.47 ms | **6.78 ms** | 19.15 ms |

**A tie, with RabbitMQ's tail slightly better.** At the volume this system has,
the throughput table above is decoration; this is the table that describes what
a user would experience.

### Monitoring — measured, not asserted

This is where the gap is widest, and it is the opposite of the throughput gap.

| | Kafka | RabbitMQ |
|---|---|---|
| Native Prometheus endpoint | **none** | **yes** — `rabbitmq_prometheus`, *enabled by default* in the `-management` image |
| What we had to run | `danielqsj/kafka-exporter` sidecar | nothing |
| Metric families on the endpoint | 52 | 235 |
| …that are about the **broker** | **16** (`kafka_*`) | **231** (141 `rabbitmq_*` + 90 `erlang_*`) |
| …that are the exporter's own Go runtime | 34 | 0 |
| Series in Prometheus | 443 | 1,253 |
| Broker internals (heap, GC, request queues) | needs a **second** mechanism: JMX exporter as `-javaagent` | included |
| Self-reported memory | no | `rabbitmq_process_resident_memory_bytes` |

Two-thirds of the "Kafka" metrics endpoint describes the exporter, not Kafka.

**A real trap found in the Kafka metric:** `kafka_consumergroup_lag` returns
**`-1`** for partitions with no committed offset, not 0 —

```
kafka_consumergroup_lag{partition="0",topic="order.events"} 0
kafka_consumergroup_lag{partition="1",topic="order.events"} 5000
kafka_consumergroup_lag{partition="2",topic="order.events"} -1
kafka_consumergroup_lag{partition="3",topic="order.events"} -1
```

So the obvious alerting expression, `sum(kafka_consumergroup_lag) > N`, silently
subtracts 1 per idle partition and under-reports. It needs
`sum(kafka_consumergroup_lag > 0)`. This is exactly the class of bug the
2026-08-30 game-day found in our own SLI — a metric that looks healthy while the
thing it measures is not.

## Scoring against the nine criteria

| # | Criterion | Winner | Why |
|---|---|---|---|
| 1 | Delivery guarantees | Kafka (slight) | Both do at-least-once with acks/confirms. Kafka adds transactions/EOS *within Kafka*; with an outbox + idempotent consumer we do not use it. |
| 2 | Retry / DLQ | **RabbitMQ** | Native dead-letter exchange, declarative, per-queue. Kafka has no DLQ — you build retry topics and a DLQ topic in consumer code. |
| 3 | Throughput | Kafka | 1.5–3× on batched publish. Both are ≥25,000× the requirement. |
| 4 | Persistence / replay | **Kafka** | The log retains after consumption. RabbitMQ deletes on ack. Replay is a capability, not a tuning knob. |
| 5 | Cost | **RabbitMQ** | 256 m vs 768 m, no sidecar, no partition/RF planning. |
| 6 | Monitoring | **RabbitMQ** | 231 broker metrics built in vs 16 via a sidecar, plus the `-1` lag trap and JMX for internals. |
| 7 | Client libraries | tie | `kafkajs` and `amqplib` are both mature pure-JS. |
| 8 | Licensing | tie | Kafka Apache-2.0, RabbitMQ MPL-2.0. Both permissive — the Redis/Valkey relicensing concern does not apply to either. |
| 9 | Future fit | **Kafka** | Plan weeks 11 and 13 depend on log semantics: CQRS read-model rebuild, log compaction (DDIA ch. 11), consumer-group lag, Strimzi on k8s. |

Three clear wins each way. This is genuinely split, and the split is not between
two answers to one question — it is between two *different questions*.

## Decision

**Adopt Kafka for this repo, while recording that RabbitMQ is the better
engineering answer at this volume.**

The two halves, kept separate on purpose:

**If this were a production system at 10,000 events/day, choose RabbitMQ.** It
costs a third of the memory, its tail latency is marginally better, its DLQ is
declarative instead of hand-built, and its monitoring is free and ~14× richer.
Kafka's advantages — throughput and replay — buy nothing a system this size can
spend. Paying 512 MB of a 4 GiB machine for 25,000× unused headroom is the
"right-sizing" failure this repo has already corrected twice (the URL-shortener
exercise graded down for reaching for NoSQL; the observability spec's deliberate
1 % discipline).

**Choose Kafka anyway, because this repo's product is understanding, not
throughput.** Weeks 11 and 13 of the plan are built on things only a partitioned,
retained log provides: rebuilding a CQRS read model by replaying history, log
compaction, consumer-group lag as an SLI, Strimzi on Kubernetes. Choosing
RabbitMQ would quietly delete three weeks of the syllabus, and the concepts it
would delete are the ones that transfer to work at a scale where Kafka *is* the
right answer.

That is the actual architectural lesson here, and it is worth more than either
broker: **knowing you are deliberately choosing the over-provisioned tool, and
being able to say exactly what it costs (512 MB, a sidecar, partition planning,
a hand-built DLQ) and exactly what you are buying with it (replay, compaction,
the syllabus).** An ADR that concluded "Kafka, it's faster" would have been
wrong even though it reaches the same decision.

### Consequences

- Budget **768 m** for Kafka, not 512 m — 84 % of cap under load is too thin.
- A `kafka-exporter` sidecar is a required component, not optional; consumer
  lag is the outbox's "are events flowing" SLI.
- Alert on `sum(kafka_consumergroup_lag > 0)`, never bare `sum(...)`.
- DLQ and retry topics are application code we must write (Week 12).
- The outbox lag metric (`max(now() - created_at) WHERE published_at IS NULL`)
  stays the primary signal regardless of broker — it lives in Postgres and keeps
  working when the broker is the thing that died. The 2026-08-30 game-day proved
  that a monitor which shares a failure domain with the thing it watches reports
  green through an outage.

### Revisit this when

- Event volume exceeds ~1,000/s sustained (then Kafka's throughput stops being
  decoration).
- The memory budget tightens below 1 GB total for messaging.
- A second consumer needs to replay history — if that never happens, the central
  Kafka argument was never cashed.

## Fairness caveats

Recorded because they cut *against* the decision and a reader deserves them:

1. **The durability settings are not symmetric work.** Kafka `acks=-1` with RF=1
   means "in the leader's page cache" — no fsync. RabbitMQ `persistent: true`
   with publisher confirms means the message reached disk. **RabbitMQ is doing
   strictly more durability work in every number above** and still wins on memory
   and steady-state tail latency.
2. **Single node erases Kafka's real advantage.** Partitioned replication across
   brokers is what Kafka is for, and this spike cannot see it.
3. **Client and broker share a machine**, so network cost is absent from the
   latency figures for both.
4. **Throughput variance is high** (up to 1.8× run to run). Memory was stable.

## Gotchas found while building the spike

Five, all costing real time, all now encoded as comments in `infra/broker-spike/`:

1. **RabbitMQ 4.0 removed `RABBITMQ_VM_MEMORY_HIGH_WATERMARK`.** Setting it is a
   hard startup failure — `exit 1`, "deprecated environment variables detected" —
   not a warning. It moved to `rabbitmq.conf`.
2. **The healthcheck must run as `gosu rabbitmq`.** `rabbitmq-diagnostics`
   creates `/var/lib/rabbitmq/.erlang.cookie` if absent. Run as root — the
   container's default user — it wins the race against the server's own startup
   and writes the cookie `root:root 0400`; the server then drops to uid 999 and
   cannot read its own cookie. Result: `eacces` and `exit 1` on **every** boot.
   Bisected over nine variants: the container starts fine with the volume, the
   config mount, the env vars and the limits, and `podman run` with the identical
   configuration works — because `podman run` ran no healthcheck. `start_period`
   does **not** help. This cost more time than the entire benchmark.
3. **The JVM cannot see the cgroup limit** — `mem_limit` alone does not bound
   Kafka; `KAFKA_HEAP_OPTS` is required. Identical to the WiredTiger trap
   recorded on 2026-08-30, and the same lesson: *a container limit is invisible
   to the process inside unless you tell it.*
4. **A file loaded via `scrape_config_files` must be a mapping with a
   `scrape_configs:` key**, not a bare list — otherwise Prometheus exits 2 with
   `cannot unmarshal !!seq into config.ScrapeConfigs`.
5. **Both brokers need a named volume, for fairness not just function.** The
   volume was the fix for a podman ownership issue on the RabbitMQ side, but
   giving Kafka one too is a *measurement* requirement: a named volume and the
   container's overlayfs writable layer are different storage paths with
   different write costs, and this benchmark measures durable writes.

## Changes outside the spike

- `infra/observability/prometheus/prometheus.yml` — added `scrape_config_files`
  pointing at a new drop-in directory, so a temporary stack can add targets and
  remove them without leaving permanently-DOWN jobs in the main config.
- `infra/observability/compose.yaml` — mounts `./prometheus/scrape`.

Both are additive; the existing jobs are untouched.
