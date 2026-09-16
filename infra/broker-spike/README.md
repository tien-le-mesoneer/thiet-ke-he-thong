# broker-spike

Throwaway stack backing **`docs/superpowers/specs/2026-09-14-broker-kafka-vs-rabbitmq.md`**
(the Week 7 broker ADR). Delete this directory once the decision is settled and
the chosen broker moves into `apps/deliveroo-node/compose.yaml`.

## Run

```bash
podman network create sd-net                                   # once
cp prometheus-brokers.yml ../observability/prometheus/scrape/   # add the targets
podman compose -f compose.yaml up -d
podman compose -f ../observability/compose.yaml up -d           # Prometheus + Grafana

npm install
node bench.mjs kafka  --count 200000 --batch 100   # drain throughput
node bench.mjs rabbit --count 200000 --batch 100
node steady.mjs kafka 500 20                       # steady-state e2e latency
node steady.mjs rabbit 500 20
node boot-probe.mjs                                # time-to-serving, protocol level
```

Watch it at **http://localhost:7080** → dashboard *Broker Spike — Kafka vs RabbitMQ*.
RabbitMQ's own management UI is at **http://localhost:7673** (`spike` / `spike`).

## Tear down

```bash
podman compose -f compose.yaml down -v
rm ../observability/prometheus/scrape/prometheus-brokers.yml
podman restart sd-observability_prometheus_1
```

Removing the scrape file matters — left behind, Prometheus keeps two permanently
DOWN targets.

## Ports

`7 + the upstream default's last three digits`, matching the observability stack.

| | host | container |
|---|---|---|
| Kafka (external listener) | 7092 | 9094 |
| RabbitMQ AMQP | 7672 | 5672 |
| RabbitMQ management UI | 7673 | 15672 |
| RabbitMQ metrics | 7692 | 15692 |
| kafka-exporter metrics | 7308 | 9308 |

RabbitMQ's management port breaks the rule (15672 would collide with AMQP's
7672), so it gets 7673.

## Measuring honestly — three traps this spike walked into

1. **A TCP port probe measures podman, not the broker.** Both ports accept
   ~1.0 s after `up -d` because podman's proxy binds before the process exists.
   `boot-probe.mjs` waits for a real protocol exchange instead; the true figures
   are 2.04 s (Kafka) and 2.22 s (RabbitMQ), cross-checked against each
   container's own log timestamps.
2. **A small benchmark measures startup.** At 20k events Kafka consumed at
   38k msg/s and RabbitMQ at 60k — apparent RabbitMQ win. At 200k it was Kafka
   263k vs RabbitMQ 41k. The 20k run was dominated by Kafka's ~0.5 s
   consumer-group join, a fixed cost.
3. **Drain rate is not latency.** `bench.mjs` publishes everything, then
   consumes — that measures backlog clearing. `steady.mjs` keeps a consumer
   running and publishes slowly, which is the workload this repo actually has
   (0.116 events/s average). The two brokers tie there.

`timeout` is not available on macOS, which silently produced empty benchmark
output once; use `gtimeout` or no timeout at all.
