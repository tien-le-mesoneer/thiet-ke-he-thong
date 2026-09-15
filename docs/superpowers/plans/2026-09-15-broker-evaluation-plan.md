# Broker Evaluation — 20-Aspect Comparison Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Kafka-vs-RabbitMQ evaluation across all 20 aspects, measuring everything that a single laptop can honestly measure and explicitly scoping out what it cannot.

**Architecture:** Extend the existing `infra/broker-spike/` harness with a shared connection library and eight experiment scripts. Each experiment answers one or more aspects with a number or an observed behaviour, recorded in a single results sheet, which is then folded into the ADR's scorecard. Nothing is scored from documentation alone unless it is explicitly marked as research.

**Tech Stack:** Node 22 (ESM), `kafkajs` 2.2, `amqplib` 0.10, podman compose, Prometheus 3.2.1 + Grafana 11.5.2 (already running), Kafka 3.9 KRaft single node, RabbitMQ 4.0.9.

**Spec:** `docs/superpowers/specs/2026-09-14-broker-kafka-vs-rabbitmq.md`

## Global Constraints

- **Both brokers stay configured for the strongest single-node durability each offers.** Kafka `acks: -1`; RabbitMQ `persistent: true` + publisher confirms. Do not weaken either to make a number look better.
- **Memory caps stay at the ADR's sized values** — `MEM_KAFKA=768m`, `KAFKA_HEAP=384m`, `MEM_RABBIT=256m` from `infra/broker-spike/.env`. Backpressure and failure behaviour are only meaningful under a real cap.
- **Every experiment records the run conditions** — event count, payload size, caps, and the container IDs — into `infra/broker-spike/RESULTS.md`. A number without its conditions is not a result.
- **Limits apply at container CREATE time only.** After changing `.env`, use `podman compose … up -d`, never `start`, and verify with `podman inspect -f '{{.HostConfig.Memory}}'`. Reusing a stale container silently invalidated two earlier game-day experiments (2026-08-30).
- **`timeout` does not exist on macOS.** Use `gtimeout` or no timeout — a bare `timeout` silently produces empty output.
- **The topic/queue name per experiment is unique** (`exp.<name>`), so experiments never inherit each other's backlog.
- **Record contradictions.** If a measurement contradicts the ADR's conclusion, write both the old claim and the new number, per the repo's standing habit.

---

## Aspect triage

Twenty aspects, three tiers. The point of this table is that **the plan is much smaller than the aspect list** — six aspects are already answered, and two cannot be answered honestly on one machine.

| # | Aspect | Tier | How it gets answered |
|---|---|---|---|
| 1 | Messaging model | **B** | Task 5 — fan-out experiment |
| 2 | Delivery guarantee | **B** | Task 2 — crash test |
| 3 | Durability | **B** | Task 2 — crash test |
| 4 | Ordering | **B** | Task 3 |
| 5 | Acknowledgement | **B** | Task 4 |
| 6 | Retry / DLQ | **B** | Task 4 |
| 7 | Persistence / replay | **B** | Task 5 |
| 8 | Consumer model | **B** | Task 5 |
| 9 | Backpressure | **B** | Task 6 |
| 10 | Scalability | **B** (partial) | Task 7 consumers; broker scaling is Tier C |
| 11 | Performance | **A** done + Task 7 | ADR has latency/throughput; size sweep missing |
| 12 | Availability | **C** | Research — needs a 3-node cluster |
| 13 | Operational complexity | **A** done + Task 9 | 5 gotchas + boot times recorded; make it counted |
| 14 | Cloud dependency | **C** | Research only |
| 15 | Cost | **A** partial + Task 10 | Memory measured; pricing is research |
| 16 | Observability | **A** done + Task 8 | 231 vs 16 measured; trace propagation missing |
| 17 | Security | **C** | Research + optional config exercise |
| 18 | SDK / ecosystem | **C** | Research; partial first-hand evidence already |
| 19 | Failure behavior | **B** | Task 2 + Task 4 |
| 20 | Use-case fit | — | Task 11 — the synthesis, not a measurement |

**Tier A (already measured, do not redo):** performance, observability, operational complexity, the memory half of cost. Numbers live in the ADR.
**Tier B (measurable here):** 11 aspects across 7 experiments.
**Tier C (research or out of scope):** availability, cloud dependency, security, SDK ecosystem, cost at scale.

### Decision-relevant core

If time is short, run **Tasks 2, 4, 5, 6** (≈3 h) and skip the rest. Those four are the only ones that could move the decision:

- **Task 5 (replay)** exercises the *central Kafka argument*. If replay is never actually used, the Kafka choice loses its justification and the ADR should flip.
- **Task 4 (DLQ)** quantifies the *central RabbitMQ argument* — declarative config versus consumer code you own forever.
- **Task 6 (backpressure)** is the one that can change the memory sizing, which is the ADR's deciding criterion.
- **Task 2 (crash)** tests the ADR's own fairness caveat: Kafka's `acks=-1` at RF=1 is a page-cache ack, not an fsync.

Tasks 3, 7, 8, 9, 10 are completeness. They fill the table; they will not flip it.

---

## File structure

| File | Responsibility |
|---|---|
| `infra/broker-spike/lib.mjs` | **Create.** Connect/teardown helpers for both brokers, plus `record()` for appending to the results sheet. Every experiment imports this; no experiment opens a raw connection itself. |
| `infra/broker-spike/RESULTS.md` | **Create.** The 20-row sheet. One place results land, so the ADR update is a transcription, not a re-derivation. |
| `infra/broker-spike/exp/crash.mjs` | **Create.** Delivery guarantee, durability, failure behavior. |
| `infra/broker-spike/exp/ordering.mjs` | **Create.** Per-key vs global ordering. |
| `infra/broker-spike/exp/ack-dlq.mjs` | **Create.** Redelivery on un-acked messages, poison-message handling, DLQ. |
| `infra/broker-spike/exp/replay-fanout.mjs` | **Create.** Replay after consumption, and independent subscribers vs competing consumers. |
| `infra/broker-spike/exp/backpressure.mjs` | **Create.** Producer faster than consumer, under the real memory cap. |
| `infra/broker-spike/exp/scale.mjs` | **Create.** Consumer count sweep and message size sweep. |
| `infra/broker-spike/exp/trace.mjs` | **Create.** Does an OTel trace survive the broker hop. |
| `infra/broker-spike/research.md` | **Create.** Tier C findings with sources and dates. |
| `docs/superpowers/specs/2026-09-14-broker-kafka-vs-rabbitmq.md` | **Modify.** Replace the nine-criterion scorecard with the full 20-aspect table; add any contradictions found. |
| `docs/system-design-progress.md` | **Modify.** One dated log entry when the evaluation closes. |

---

## Task 1: Shared harness and results sheet

Scaffolding every later task imports. Folded into one task because none of it is independently reviewable.

**Files:**
- Create: `infra/broker-spike/lib.mjs`
- Create: `infra/broker-spike/RESULTS.md`
- Create: `infra/broker-spike/exp/.gitkeep`

**Interfaces:**
- Produces: `kafkaClient()`, `withKafkaTopic(name, partitions, fn)`, `rabbitConn()`, `withRabbitQueue(name, opts, fn)`, `record(aspect, broker, finding)`, `pct(arr, p)`, `sleep(ms)`.
- Consumes: nothing.

- [ ] **Step 1: Create the experiment directory**

```bash
mkdir -p infra/broker-spike/exp && touch infra/broker-spike/exp/.gitkeep
```

- [ ] **Step 2: Write `infra/broker-spike/lib.mjs`**

```js
// Shared plumbing for the aspect experiments. Every experiment imports this so
// that connection settings, topic/queue naming and result recording are
// identical across runs — a comparison where two scripts connect differently
// is not a comparison.
import { Kafka, logLevel } from "kafkajs";
import amqp from "amqplib";
import { appendFile } from "node:fs/promises";

export const KAFKA_BROKER = `localhost:${process.env.BROKER_KAFKA_PORT ?? 7092}`;
export const RABBIT_URL =
  `amqp://${process.env.RABBIT_USER ?? "spike"}:${process.env.RABBIT_PASS ?? "spike"}` +
  `@localhost:${process.env.BROKER_RABBIT_PORT ?? 7672}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pct = (a, p) =>
  a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

export function kafkaClient(clientId = "exp") {
  return new Kafka({ clientId, brokers: [KAFKA_BROKER], logLevel: logLevel.NOTHING });
}

/**
 * Give the callback a clean topic. Deleting and recreating rather than reusing
 * matters: a leftover backlog from an earlier experiment silently changes the
 * consume numbers of the next one.
 */
export async function withKafkaTopic(name, partitions, fn) {
  const kafka = kafkaClient();
  const admin = kafka.admin();
  await admin.connect();
  await admin.deleteTopics({ topics: [name] }).catch(() => {});
  await sleep(1000);
  await admin.createTopics({ topics: [{ topic: name, numPartitions: partitions, replicationFactor: 1 }] });
  await admin.disconnect();
  try {
    return await fn(kafka);
  } finally {
    const a2 = kafka.admin();
    await a2.connect();
    await a2.deleteTopics({ topics: [name] }).catch(() => {});
    await a2.disconnect();
  }
}

export async function rabbitConn() {
  return amqp.connect(RABBIT_URL);
}

export async function withRabbitQueue(name, opts, fn) {
  const conn = await rabbitConn();
  const ch = await conn.createChannel();
  await ch.deleteQueue(name).catch(() => {});
  await ch.assertQueue(name, { durable: true, ...opts });
  try {
    return await fn(conn, ch, name);
  } finally {
    await ch.deleteQueue(name).catch(() => {});
    await ch.close().catch(() => {});
    await conn.close().catch(() => {});
  }
}

/** Append one finding to the results sheet. Never overwrite — history is data. */
export async function record(aspect, broker, finding) {
  const line = `| ${new Date().toISOString().slice(0, 16)} | ${aspect} | ${broker} | ${finding} |\n`;
  await appendFile(new URL("./RESULTS.md", import.meta.url), line);
  console.log(`  recorded: ${aspect} / ${broker} — ${finding}`);
}
```

- [ ] **Step 3: Write `infra/broker-spike/RESULTS.md`**

```markdown
# Broker evaluation — raw results

Appended by `lib.mjs record()`. Never edit a row; add a new one and note the
supersession. Conditions for every run: `MEM_KAFKA=768m KAFKA_HEAP=384m
MEM_RABBIT=256m`, Kafka 3.9 KRaft 1 node RF=1, RabbitMQ 4.0.9, podman 5.8 on a
5-CPU / 4 GiB VM, client on the host.

| when | aspect | broker | finding |
|---|---|---|---|
```

- [ ] **Step 4: Verify the harness connects to both brokers**

```bash
cd infra/broker-spike
podman compose -f compose.yaml up -d
node -e '
import("./lib.mjs").then(async (l) => {
  await l.withKafkaTopic("exp.smoke", 2, async () => console.log("kafka ok"));
  await l.withRabbitQueue("exp.smoke", {}, async () => console.log("rabbit ok"));
  process.exit(0);
});'
```

Expected: `kafka ok` then `rabbit ok`. If RabbitMQ hangs, check the healthcheck is still the `gosu rabbitmq` form — without it the broker dies on every boot with `.erlang.cookie: eacces`.

- [ ] **Step 5: Commit**

```bash
git add infra/broker-spike/lib.mjs infra/broker-spike/RESULTS.md infra/broker-spike/exp/.gitkeep
git commit -m "test(broker-spike): shared harness and results sheet for the aspect evaluation"
```

---

## Task 2: Crash test — delivery guarantee, durability, failure behavior

**Aspects: 2, 3, 19.** Publishes with confirms while logging every *acknowledged* id, has the broker killed underneath it, then verifies that every acknowledged id survived. An ack that does not survive is a lie, and that is the whole question.

**Files:**
- Create: `infra/broker-spike/exp/crash.mjs`
- Modify: `infra/broker-spike/RESULTS.md` (appended by the script)

**Interfaces:**
- Consumes: `kafkaClient`, `rabbitConn`, `record`, `sleep` from `lib.mjs`.
- Produces: `$TMPDIR/crash-<broker>.acked` — newline-delimited acknowledged ids, read back by the `verify` mode.

- [ ] **Step 1: Write `infra/broker-spike/exp/crash.mjs`**

```js
// Delivery guarantee under a broker crash.
//
//   node exp/crash.mjs publish kafka     # runs until killed; logs ACKED ids
//   podman kill -s SIGKILL sd-broker-spike_kafka_1
//   podman start sd-broker-spike_kafka_1
//   node exp/crash.mjs verify kafka      # every acked id must still be there
//
// IMPORTANT CAVEAT, and it is the whole methodological point: `podman kill`
// kills the broker PROCESS. The page cache belongs to the podman VM's kernel,
// which is still alive, so data that was acked-but-not-fsynced SURVIVES this
// test. It measures process crash, not machine loss. Kafka's acks=-1 at RF=1
// acknowledges on page-cache write, so passing here does NOT prove it would
// survive `podman machine stop --force`. See "Harder variant" below.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { kafkaClient, rabbitConn, record, sleep } from "../lib.mjs";

const [mode, broker] = process.argv.slice(2);
const TOPIC = "exp.crash";
const LOG = `${process.env.TMPDIR ?? "/tmp"}/crash-${broker}.acked`;
const body = (i) => JSON.stringify({ id: i, pad: "x".repeat(180) });

async function publishKafka() {
  await writeFile(LOG, "");
  const kafka = kafkaClient("crash");
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 4, replicationFactor: 1 }] })
    .catch(() => {});
  await admin.disconnect();

  const producer = kafka.producer();
  await producer.connect();
  for (let i = 0; ; i++) {
    try {
      await producer.send({ topic: TOPIC, acks: -1, messages: [{ key: `k${i % 4}`, value: body(i) }] });
      await appendFile(LOG, `${i}\n`);           // written ONLY after the ack
    } catch (err) {
      console.log(`publish stopped at ${i}: ${err.message}`);
      break;
    }
    if (i % 500 === 0) process.stdout.write(".");
  }
}

async function publishRabbit() {
  await writeFile(LOG, "");
  const conn = await rabbitConn();
  const ch = await conn.createConfirmChannel();
  await ch.assertQueue(TOPIC, { durable: true });
  for (let i = 0; ; i++) {
    try {
      await new Promise((res, rej) =>
        ch.sendToQueue(TOPIC, Buffer.from(body(i)), { persistent: true }, (e) => (e ? rej(e) : res())));
      await appendFile(LOG, `${i}\n`);           // written ONLY after the confirm
    } catch (err) {
      console.log(`publish stopped at ${i}: ${err.message}`);
      break;
    }
    if (i % 500 === 0) process.stdout.write(".");
  }
}

async function verifyKafka() {
  const acked = new Set((await readFile(LOG, "utf8")).trim().split("\n").filter(Boolean).map(Number));
  const consumer = kafkaClient("crash-v").consumer({ groupId: `crash-verify-${Date.now()}` });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
  const seen = new Set();
  let idle = 0;
  await consumer.run({ eachMessage: async ({ message }) => { seen.add(JSON.parse(message.value).id); idle = 0; } });
  while (idle++ < 8) await sleep(500);          // stop once nothing new arrives for 4s
  await consumer.disconnect();
  return { acked, seen };
}

async function verifyRabbit() {
  const acked = new Set((await readFile(LOG, "utf8")).trim().split("\n").filter(Boolean).map(Number));
  const conn = await rabbitConn();
  const ch = await conn.createChannel();
  await ch.assertQueue(TOPIC, { durable: true });
  const seen = new Set();
  for (;;) {
    const m = await ch.get(TOPIC, { noAck: true });
    if (!m) break;
    seen.add(JSON.parse(m.content).id);
  }
  await ch.close(); await conn.close();
  return { acked, seen };
}

if (mode === "publish") {
  await (broker === "kafka" ? publishKafka() : publishRabbit());
} else {
  const { acked, seen } = await (broker === "kafka" ? verifyKafka() : verifyRabbit());
  const lost = [...acked].filter((i) => !seen.has(i));
  const extra = seen.size - (acked.size - lost.length);
  console.log(`\nacked=${acked.size} present=${seen.size} LOST=${lost.length} unacked-but-present=${extra}`);
  await record("delivery+durability", broker,
    `acked ${acked.size}, survived ${seen.size - extra}, **lost ${lost.length}**, phantom-surplus ${extra} (process SIGKILL, page cache intact)`);
}
process.exit(0);
```

- [ ] **Step 2: Run the Kafka crash**

```bash
cd infra/broker-spike
node exp/crash.mjs publish kafka &
sleep 6 && podman kill -s SIGKILL sd-broker-spike_kafka_1
wait
podman start sd-broker-spike_kafka_1 && sleep 25
node exp/crash.mjs verify kafka
```

Expected: `LOST=0`. Record the number whatever it is.

- [ ] **Step 3: Run the RabbitMQ crash**

```bash
node exp/crash.mjs publish rabbit &
sleep 6 && podman kill -s SIGKILL sd-broker-spike_rabbitmq_1
wait
podman start sd-broker-spike_rabbitmq_1 && sleep 30
node exp/crash.mjs verify rabbit
```

Expected: `LOST=0`.

- [ ] **Step 4: Harder variant — machine loss, not process loss**

The container kill above cannot invalidate a page-cache ack. To test the thing the ADR's fairness caveat actually claims, the VM has to go:

```bash
node exp/crash.mjs publish kafka &
sleep 6 && podman machine stop --force
podman machine start && sleep 40
podman compose -f compose.yaml up -d && sleep 30
node exp/crash.mjs verify kafka
```

Run it for **both** brokers. This is the test that can produce `LOST > 0` for Kafka and `LOST = 0` for RabbitMQ, and if it does, that is a finding that belongs in the ADR's decision section, not its caveats.

- [ ] **Step 5: Record and commit**

```bash
git add infra/broker-spike/exp/crash.mjs infra/broker-spike/RESULTS.md
git commit -m "test(broker-spike): crash test for delivery guarantee and durability"
```

---

## Task 3: Ordering — per key, per partition, globally

**Aspect: 4.** Publishes a numbered sequence per key and checks two different claims separately: that per-key order holds, and that global order does not.

**Files:**
- Create: `infra/broker-spike/exp/ordering.mjs`

**Interfaces:**
- Consumes: `withKafkaTopic`, `withRabbitQueue`, `record`, `sleep`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write `infra/broker-spike/exp/ordering.mjs`**

```js
// Two separate claims, measured separately:
//   per-key order  — does seq for a given key arrive monotonically?
//   global order   — does seq arrive monotonically across ALL keys?
// Kafka with 4 partitions should hold the first and break the second.
// RabbitMQ with one queue should hold both — which is a stronger guarantee
// than this system needs, and the reason its throughput ceiling is lower.
import { withKafkaTopic, withRabbitQueue, record, sleep } from "../lib.mjs";

const N = 4000, KEYS = 4;
const TOPIC = "exp.ordering";

function analyse(events) {
  const lastPerKey = new Map();
  let keyViolations = 0, globalViolations = 0, lastGlobal = -1;
  for (const e of events) {
    const prev = lastPerKey.get(e.key) ?? -1;
    if (e.seq < prev) keyViolations++;
    lastPerKey.set(e.key, Math.max(prev, e.seq));
    if (e.global < lastGlobal) globalViolations++;
    lastGlobal = Math.max(lastGlobal, e.global);
  }
  return { keyViolations, globalViolations };
}

async function kafka() {
  return withKafkaTopic(TOPIC, KEYS, async (client) => {
    const producer = client.producer();
    await producer.connect();
    const perKey = new Array(KEYS).fill(0);
    for (let i = 0; i < N; i += 100) {
      const messages = [];
      for (let j = i; j < Math.min(i + 100, N); j++) {
        const k = j % KEYS;
        messages.push({ key: `k${k}`, value: JSON.stringify({ key: `k${k}`, seq: perKey[k]++, global: j }) });
      }
      await producer.send({ topic: TOPIC, acks: -1, messages });
    }
    await producer.disconnect();

    const consumer = client.consumer({ groupId: `ord-${Date.now()}` });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
    const got = [];
    await consumer.run({ eachMessage: async ({ message }) => got.push(JSON.parse(message.value)) });
    while (got.length < N) await sleep(200);
    await consumer.disconnect();
    return analyse(got);
  });
}

async function rabbit() {
  return withRabbitQueue(TOPIC, {}, async (conn, ch, q) => {
    const perKey = new Array(KEYS).fill(0);
    for (let j = 0; j < N; j++) {
      const k = j % KEYS;
      ch.sendToQueue(q, Buffer.from(JSON.stringify({ key: `k${k}`, seq: perKey[k]++, global: j })),
        { persistent: true });
    }
    await sleep(1500);
    const got = [];
    for (;;) {
      const m = await ch.get(q, { noAck: true });
      if (!m) break;
      got.push(JSON.parse(m.content));
    }
    return analyse(got);
  });
}

for (const [name, fn] of [["kafka", kafka], ["rabbitmq", rabbit]]) {
  const r = await fn();
  console.log(`${name}: per-key violations ${r.keyViolations}, global violations ${r.globalViolations}`);
  await record("ordering", name,
    `per-key violations ${r.keyViolations} / global violations ${r.globalViolations} (n=${N}, ${KEYS} keys)`);
}
process.exit(0);
```

- [ ] **Step 2: Run it**

```bash
node infra/broker-spike/exp/ordering.mjs
```

Expected: Kafka `per-key 0 / global > 0`. RabbitMQ `per-key 0 / global 0`.

A **non-zero per-key violation count for Kafka would be a real bug** — it would mean the key was not hashing to a stable partition, which is the mechanism `shardFor()` in `apps/url-shortener-node/src/modules/links/repo.ts` relies on too. Investigate before recording.

- [ ] **Step 3: Commit**

```bash
git add infra/broker-spike/exp/ordering.mjs infra/broker-spike/RESULTS.md
git commit -m "test(broker-spike): per-key vs global ordering"
```

---

## Task 4: Acknowledgement, retry, DLQ, poison messages

**Aspects: 5, 6, 19.** The cost being measured here is **declarative config versus code you own forever**, so the deliverable includes a line count, not just a pass/fail.

**Files:**
- Create: `infra/broker-spike/exp/ack-dlq.mjs`

**Interfaces:**
- Consumes: `kafkaClient`, `rabbitConn`, `withKafkaTopic`, `record`, `sleep`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write `infra/broker-spike/exp/ack-dlq.mjs`**

```js
// Three questions in one script:
//   1. If a consumer takes a message and never acks, does it come back?
//   2. What does a poison message (always throws) do to the consumer?
//   3. What does it take to get that poison message OUT of the hot path?
//
// (3) is where the brokers genuinely differ. RabbitMQ has a dead-letter
// exchange: two lines of queue arguments. Kafka has no DLQ concept at all --
// you write the retry-topic and dlq-topic routing yourself, in the consumer,
// and you maintain it. Count both.
import { kafkaClient, rabbitConn, record, sleep } from "../lib.mjs";

const Q = "exp.ackdlq";

// ---------- RabbitMQ: redelivery ----------
async function rabbitRedelivery() {
  const conn = await rabbitConn();
  const ch = await conn.createChannel();
  await ch.deleteQueue(Q).catch(() => {});
  await ch.assertQueue(Q, { durable: true });
  ch.sendToQueue(Q, Buffer.from("one"), { persistent: true });
  await sleep(300);

  let firstDelivery = null;
  await ch.consume(Q, (m) => { firstDelivery = m.fields.redelivered; }, { noAck: false });
  await sleep(600);
  await ch.close();                       // close WITHOUT acking -> message returns

  const ch2 = await conn.createChannel();
  const again = await ch2.get(Q, { noAck: true });
  const redelivered = again ? again.fields.redelivered : null;
  await ch2.deleteQueue(Q).catch(() => {});
  await ch2.close(); await conn.close();
  return { firstDelivery, cameBack: Boolean(again), redelivered };
}

// ---------- RabbitMQ: DLQ, declaratively ----------
// THE ENTIRE DLQ IMPLEMENTATION IS THE NEXT 6 LINES.
async function rabbitDlq() {
  const conn = await rabbitConn();
  const ch = await conn.createChannel();
  await ch.deleteQueue(Q).catch(() => {}); await ch.deleteQueue(`${Q}.dlq`).catch(() => {});
  await ch.assertQueue(`${Q}.dlq`, { durable: true });
  await ch.assertQueue(Q, {
    durable: true,
    deadLetterExchange: "",                 // default exchange
    deadLetterRoutingKey: `${Q}.dlq`,       // -> straight to the DLQ
  });
  // ---- end of DLQ implementation ----

  ch.sendToQueue(Q, Buffer.from("poison"), { persistent: true });
  await sleep(300);
  const m = await ch.get(Q, { noAck: false });
  ch.nack(m, false, false);                 // requeue=false -> dead-letter it
  await sleep(500);
  const inDlq = await ch.checkQueue(`${Q}.dlq`);
  const result = inDlq.messageCount;
  await ch.deleteQueue(Q).catch(() => {}); await ch.deleteQueue(`${Q}.dlq`).catch(() => {});
  await ch.close(); await conn.close();
  return result;
}

// ---------- Kafka: redelivery ----------
async function kafkaRedelivery() {
  const client = kafkaClient("ackdlq");
  const admin = client.admin(); await admin.connect();
  await admin.deleteTopics({ topics: [Q] }).catch(() => {}); await sleep(800);
  await admin.createTopics({ topics: [{ topic: Q, numPartitions: 1, replicationFactor: 1 }] });
  await admin.disconnect();

  const producer = client.producer(); await producer.connect();
  await producer.send({ topic: Q, acks: -1, messages: [{ value: "one" }] });
  await producer.disconnect();

  const group = `ackdlq-${Date.now()}`;
  const c1 = client.consumer({ groupId: group });
  await c1.connect(); await c1.subscribe({ topic: Q, fromBeginning: true });
  let firstSaw = 0;
  await c1.run({
    autoCommit: false,                      // never commit -> offset stays put
    eachMessage: async () => { firstSaw++; },
  });
  await sleep(2500);
  await c1.disconnect();

  const c2 = client.consumer({ groupId: group });
  await c2.connect(); await c2.subscribe({ topic: Q, fromBeginning: true });
  let secondSaw = 0;
  await c2.run({ eachMessage: async () => { secondSaw++; } });
  await sleep(2500);
  await c2.disconnect();
  return { firstSaw, secondSaw };
}

const rr = await rabbitRedelivery();
console.log("rabbit redelivery:", rr);
await record("acknowledgement", "rabbitmq",
  `unacked message returned on channel close: ${rr.cameBack}, redelivered flag ${rr.redelivered}`);

const rd = await rabbitDlq();
console.log("rabbit dlq messageCount:", rd);
await record("retry/DLQ", "rabbitmq",
  `native DLX — ${rd} message dead-lettered; implementation = 6 lines of queue arguments, 0 lines of consumer code`);

const kr = await kafkaRedelivery();
console.log("kafka redelivery:", kr);
await record("acknowledgement", "kafka",
  `uncommitted offset re-read by a new consumer in the same group: first saw ${kr.firstSaw}, second saw ${kr.secondSaw}`);
process.exit(0);
```

- [ ] **Step 2: Run it**

```bash
node infra/broker-spike/exp/ack-dlq.mjs
```

Expected: RabbitMQ `cameBack: true, redelivered: true`; DLQ count `1`. Kafka `firstSaw: 1, secondSaw: 1` — the offset was never committed, so the message is re-read.

- [ ] **Step 3: Write the Kafka DLQ by hand and count the lines**

There is no script step for this because there is no Kafka feature to call. Implement the minimum viable version in `infra/broker-spike/exp/ack-dlq.mjs` as a new function `kafkaDlq()`: a consumer that tracks an attempt count per message, re-publishes to `exp.ackdlq.retry` on failure, and publishes to `exp.ackdlq.dlq` after 3 attempts. Then:

```bash
# count what the DLQ cost on each side
grep -c '' <(sed -n '/^async function kafkaDlq/,/^}/p' infra/broker-spike/exp/ack-dlq.mjs)
grep -c '' <(sed -n '/THE ENTIRE DLQ IMPLEMENTATION/,/end of DLQ implementation/p' infra/broker-spike/exp/ack-dlq.mjs)
```

Record both numbers against aspect "Retry / DLQ". The ratio is the finding.

- [ ] **Step 4: Commit**

```bash
git add infra/broker-spike/exp/ack-dlq.mjs infra/broker-spike/RESULTS.md
git commit -m "test(broker-spike): acknowledgement, redelivery and DLQ cost"
```

---

## Task 5: Replay and fan-out — the central Kafka argument

**Aspects: 1, 7, 8.** This is the task that can overturn the ADR. Kafka was chosen for replay; this measures whether replay is real and what RabbitMQ does instead.

**Files:**
- Create: `infra/broker-spike/exp/replay-fanout.mjs`

**Interfaces:**
- Consumes: `withKafkaTopic`, `rabbitConn`, `record`, `sleep`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write `infra/broker-spike/exp/replay-fanout.mjs`**

```js
// Two questions the ADR's decision rests on.
//
// REPLAY: after every message has been consumed and acknowledged, can a NEW
// consumer read the history? Kafka retains the log; RabbitMQ deletes on ack.
//
// FAN-OUT: can two independent subscribers each receive every message, or do
// they compete for them? Kafka: two consumer groups, both get everything.
// RabbitMQ: two queues bound to a fanout exchange -- but they must be bound
// BEFORE the message is published, which is the real difference.
import { withKafkaTopic, rabbitConn, record, sleep } from "../lib.mjs";

const N = 500;
const TOPIC = "exp.replay";
const EX = "exp.fanout";

async function kafkaReplayAndFanout() {
  return withKafkaTopic(TOPIC, 2, async (client) => {
    const producer = client.producer(); await producer.connect();
    for (let i = 0; i < N; i += 100) {
      const messages = [];
      for (let j = i; j < Math.min(i + 100, N); j++) messages.push({ value: String(j) });
      await producer.send({ topic: TOPIC, acks: -1, messages });
    }
    await producer.disconnect();

    const drain = async (groupId) => {
      const c = client.consumer({ groupId });
      await c.connect(); await c.subscribe({ topic: TOPIC, fromBeginning: true });
      let n = 0;
      await c.run({ eachMessage: async () => { n++; } });
      let idle = 0;
      while (idle++ < 10) { const before = n; await sleep(400); if (n !== before) idle = 0; }
      await c.disconnect();
      return n;
    };

    const groupA = await drain(`A-${Date.now()}`);   // consumes everything, commits
    const groupB = await drain(`B-${Date.now()}`);   // NEW group, created after the fact
    return { firstPass: groupA, replayAfterFullConsumption: groupB };
  });
}

async function rabbitReplayAndFanout() {
  const conn = await rabbitConn();
  const ch = await conn.createChannel();

  // --- replay: publish to a queue, drain it, then ask for it again ---
  await ch.deleteQueue(TOPIC).catch(() => {});
  await ch.assertQueue(TOPIC, { durable: true });
  for (let i = 0; i < N; i++) ch.sendToQueue(TOPIC, Buffer.from(String(i)), { persistent: true });
  await sleep(1200);
  let firstPass = 0;
  for (;;) { const m = await ch.get(TOPIC, { noAck: false }); if (!m) break; ch.ack(m); firstPass++; }
  await sleep(400);
  const after = await ch.checkQueue(TOPIC);
  await ch.deleteQueue(TOPIC).catch(() => {});

  // --- fan-out: two queues bound to a fanout exchange BEFORE publishing ---
  await ch.assertExchange(EX, "fanout", { durable: true });
  await ch.deleteQueue(`${EX}.a`).catch(() => {}); await ch.deleteQueue(`${EX}.b`).catch(() => {});
  await ch.assertQueue(`${EX}.a`, { durable: true }); await ch.bindQueue(`${EX}.a`, EX, "");
  await ch.assertQueue(`${EX}.b`, { durable: true }); await ch.bindQueue(`${EX}.b`, EX, "");
  for (let i = 0; i < N; i++) ch.publish(EX, "", Buffer.from(String(i)), { persistent: true });
  await sleep(1200);
  const a = await ch.checkQueue(`${EX}.a`);
  const b = await ch.checkQueue(`${EX}.b`);
  // a LATE subscriber: bound only now, after the publishes
  await ch.deleteQueue(`${EX}.c`).catch(() => {});
  await ch.assertQueue(`${EX}.c`, { durable: true }); await ch.bindQueue(`${EX}.c`, EX, "");
  await sleep(400);
  const c = await ch.checkQueue(`${EX}.c`);

  for (const q of [`${EX}.a`, `${EX}.b`, `${EX}.c`]) await ch.deleteQueue(q).catch(() => {});
  await ch.deleteExchange(EX).catch(() => {});
  await ch.close(); await conn.close();
  return { firstPass, replayAfterFullConsumption: after.messageCount,
           fanoutA: a.messageCount, fanoutB: b.messageCount, lateSubscriber: c.messageCount };
}

const k = await kafkaReplayAndFanout();
console.log("kafka:", k);
await record("persistence/replay", "kafka",
  `new consumer group read ${k.replayAfterFullConsumption}/${N} AFTER another group consumed and committed all of them`);
await record("consumer model", "kafka",
  `two independent groups each received the full ${N}; competing consumers = same group`);

const r = await rabbitReplayAndFanout();
console.log("rabbitmq:", r);
await record("persistence/replay", "rabbitmq",
  `after draining ${r.firstPass}/${N}, queue holds ${r.replayAfterFullConsumption} — nothing to replay`);
await record("consumer model", "rabbitmq",
  `fanout exchange: pre-bound queues got ${r.fanoutA} and ${r.fanoutB}; a queue bound AFTER publishing got ${r.lateSubscriber}`);
process.exit(0);
```

- [ ] **Step 2: Run it**

```bash
node infra/broker-spike/exp/replay-fanout.mjs
```

Expected: Kafka replay `500/500`. RabbitMQ replay `0`, fan-out `500 / 500`, late subscriber `0`.

- [ ] **Step 3: Answer the question that decides the ADR**

Write one paragraph in `RESULTS.md` under a heading `## Does replay get used?` answering: in weeks 11 and 13 of the plan, which concrete step requires reading history that a consumer already processed? If the honest answer is "none, the CQRS read model could be built from a live subscription", then **the ADR's central Kafka argument does not hold** and Task 11 must flip the decision. This is not optional — it is the reason this task exists.

- [ ] **Step 4: Commit**

```bash
git add infra/broker-spike/exp/replay-fanout.mjs infra/broker-spike/RESULTS.md
git commit -m "test(broker-spike): replay and fan-out — the central Kafka argument"
```

---

## Task 6: Backpressure under the real memory cap

**Aspect: 9.** Producers faster than consumers, with `MEM_RABBIT=256m` and `MEM_KAFKA=768m` actually enforced. The brokers behave *qualitatively* differently here, and the difference shows up as a sizing constraint.

**Files:**
- Create: `infra/broker-spike/exp/backpressure.mjs`

**Interfaces:**
- Consumes: `kafkaClient`, `rabbitConn`, `record`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write `infra/broker-spike/exp/backpressure.mjs`**

```js
// Publish as fast as possible with NOTHING consuming, and record what stops us.
//
// Expected divergence:
//   RabbitMQ -- hits vm_memory_high_watermark (256MiB here) and applies FLOW
//     CONTROL: the broker stops reading from the publisher's socket, so the
//     confirm simply stops arriving. The producer blocks. Backpressure is
//     propagated to the caller.
//   Kafka -- does not push back on memory at all; the log goes to disk and
//     keeps growing until retention or the disk. The producer never feels it.
//     The failure arrives later, as a full volume, somewhere else.
//
// Which behaviour you WANT depends on the caller. For an outbox relay, a
// blocked publish is better than a silently unbounded log: the relay simply
// does not mark the row published and retries.
import { kafkaClient, rabbitConn, record } from "../lib.mjs";

const PAYLOAD = Buffer.alloc(4096, "x");   // 4 KB — fills memory in reasonable time
const STALL_MS = 5000;                     // no progress for this long = blocked
const MAX_MS = 120000;

async function run(name, publishOne, setup, teardown) {
  const ctx = await setup();
  let sent = 0, lastProgress = Date.now(), blockedAt = null;
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (Date.now() - lastProgress > STALL_MS && !blockedAt) blockedAt = sent;
  }, 500);

  while (Date.now() - t0 < MAX_MS && !blockedAt) {
    try {
      await publishOne(ctx, sent);
      sent++; lastProgress = Date.now();
    } catch (err) {
      clearInterval(tick);
      await teardown(ctx);
      await record("backpressure", name, `producer ERRORED after ${sent} msgs (4 KB each): ${err.message}`);
      return;
    }
    if (sent % 2000 === 0) process.stdout.write(`\r  ${name}: ${sent} sent, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  clearInterval(tick);
  await teardown(ctx);
  const mb = ((sent * 4096) / 1024 / 1024).toFixed(0);
  await record("backpressure", name,
    blockedAt
      ? `producer BLOCKED (flow control) after ${blockedAt} msgs ≈ ${mb} MB — backpressure reaches the caller`
      : `producer NEVER blocked: ${sent} msgs ≈ ${mb} MB in ${MAX_MS / 1000}s, no push-back`);
}

await run("rabbitmq",
  async ({ ch, q }, i) => new Promise((res, rej) =>
    ch.sendToQueue(q, PAYLOAD, { persistent: true, headers: { i } }, (e) => (e ? rej(e) : res()))),
  async () => {
    const conn = await rabbitConn();
    const ch = await conn.createConfirmChannel();
    const q = "exp.backpressure";
    await ch.deleteQueue(q).catch(() => {});
    await ch.assertQueue(q, { durable: true });
    return { conn, ch, q };
  },
  async ({ conn, ch, q }) => { await ch.deleteQueue(q).catch(() => {}); await ch.close().catch(() => {}); await conn.close().catch(() => {}); });

await run("kafka",
  async ({ producer, topic }, i) =>
    producer.send({ topic, acks: -1, messages: [{ value: PAYLOAD, headers: { i: String(i) } }] }),
  async () => {
    const client = kafkaClient("bp");
    const admin = client.admin(); await admin.connect();
    const topic = "exp.backpressure";
    await admin.deleteTopics({ topics: [topic] }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    await admin.createTopics({ topics: [{ topic, numPartitions: 4, replicationFactor: 1 }] });
    await admin.disconnect();
    const producer = client.producer(); await producer.connect();
    return { client, producer, topic };
  },
  async ({ client, producer, topic }) => {
    await producer.disconnect();
    const admin = client.admin(); await admin.connect();
    await admin.deleteTopics({ topics: [topic] }).catch(() => {});
    await admin.disconnect();
  });
process.exit(0);
```

- [ ] **Step 2: Watch memory while it runs**

In a second terminal:

```bash
while :; do podman stats --no-stream --format "{{.Name}} {{.MemUsage}} {{.MemPerc}}"; sleep 2; done
```

Then:

```bash
node infra/broker-spike/exp/backpressure.mjs
```

- [ ] **Step 3: Confirm RabbitMQ's block was flow control, not a crash**

```bash
podman logs --tail 20 sd-broker-spike_rabbitmq_1 | grep -iE "memory resource limit|alarm"
podman inspect -f 'oomkilled={{.State.OOMKilled}} status={{.State.Status}}' sd-broker-spike_rabbitmq_1
```

Expected: a `memory resource limit alarm set` log line and `oomkilled=false`. If it was OOM-killed instead, the watermark in `rabbitmq.conf` is above the container cap — that is a real misconfiguration and must be recorded and fixed, not worked around.

- [ ] **Step 4: Record the disk cost on the Kafka side**

```bash
podman exec sd-broker-spike_kafka_1 du -sh /var/lib/kafka/data
```

Record it. "Never blocked" has a price and this is it.

- [ ] **Step 5: Commit**

```bash
git add infra/broker-spike/exp/backpressure.mjs infra/broker-spike/RESULTS.md
git commit -m "test(broker-spike): backpressure behaviour under the real memory caps"
```

---

## Task 7: Consumer scaling and message size

**Aspects: 10 (partial), 11.** Fills the two gaps in the performance picture: the ADR only ever measured ~200-byte payloads with one consumer.

**Files:**
- Create: `infra/broker-spike/exp/scale.mjs`

**Interfaces:**
- Consumes: `withKafkaTopic`, `rabbitConn`, `record`, `sleep`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write `infra/broker-spike/exp/scale.mjs`**

```js
// Two sweeps.
//
// CONSUMERS: 1, 2, 4, 8 consumers on the same topic/queue. Kafka's parallelism
// is capped by PARTITION COUNT (4 here) -- the 8th consumer sits idle. RabbitMQ
// has no such cap on a single queue.
//
// SIZE: 200 B (the ADR's figure), 1 KB, 10 KB, 100 KB. Throughput in msg/s must
// fall; throughput in MB/s is the number that should stay comparable.
import { withKafkaTopic, rabbitConn, record, sleep } from "../lib.mjs";

const N = 40000;
const SIZES = [200, 1024, 10240, 102400];
const CONSUMERS = [1, 2, 4, 8];

async function kafkaConsumers(client, topic, count) {
  const consumers = [];
  let seen = 0;
  const t0 = performance.now();
  const group = `scale-${Date.now()}`;
  for (let i = 0; i < count; i++) {
    const c = client.consumer({ groupId: group });
    await c.connect(); await c.subscribe({ topic, fromBeginning: true });
    await c.run({ eachMessage: async () => { seen++; } });
    consumers.push(c);
  }
  while (seen < N) await sleep(50);
  const rate = N / ((performance.now() - t0) / 1000);
  await Promise.all(consumers.map((c) => c.disconnect()));
  return rate;
}

// --- consumer sweep ---
for (const count of CONSUMERS) {
  const topic = `exp.scale.c${count}`;
  const rate = await withKafkaTopic(topic, 4, async (client) => {
    const p = client.producer(); await p.connect();
    for (let i = 0; i < N; i += 200) {
      const messages = [];
      for (let j = i; j < Math.min(i + 200, N); j++) messages.push({ key: `k${j % 4}`, value: "x".repeat(200) });
      await p.send({ topic, acks: -1, messages });
    }
    await p.disconnect();
    return kafkaConsumers(client, topic, count);
  });
  await record("scalability", "kafka", `${count} consumer(s) on 4 partitions: ${rate.toFixed(0)} msg/s`);
}

// --- size sweep, both brokers ---
for (const size of SIZES) {
  const payload = "x".repeat(size);
  const topic = `exp.size.${size}`;
  const n = size >= 102400 ? 4000 : N;     // keep each run bounded

  const kRate = await withKafkaTopic(topic, 4, async (client) => {
    const p = client.producer(); await p.connect();
    const t0 = performance.now();
    for (let i = 0; i < n; i += 100) {
      const messages = [];
      for (let j = i; j < Math.min(i + 100, n); j++) messages.push({ key: `k${j % 4}`, value: payload });
      await p.send({ topic, acks: -1, messages });
    }
    const r = n / ((performance.now() - t0) / 1000);
    await p.disconnect();
    return r;
  });
  await record("performance", "kafka",
    `publish x100 @ ${size} B: ${kRate.toFixed(0)} msg/s = ${((kRate * size) / 1024 / 1024).toFixed(1)} MB/s`);

  const conn = await rabbitConn();
  const ch = await conn.createConfirmChannel();
  const q = `exp.size.${size}`;
  await ch.deleteQueue(q).catch(() => {});
  await ch.assertQueue(q, { durable: true });
  const t0 = performance.now();
  for (let i = 0; i < n; i += 100) {
    const pending = [];
    for (let j = i; j < Math.min(i + 100, n); j++) {
      pending.push(new Promise((res, rej) =>
        ch.sendToQueue(q, Buffer.from(payload), { persistent: true }, (e) => (e ? rej(e) : res()))));
    }
    await Promise.all(pending);
  }
  const rRate = n / ((performance.now() - t0) / 1000);
  await ch.deleteQueue(q).catch(() => {}); await ch.close(); await conn.close();
  await record("performance", "rabbitmq",
    `publish x100 @ ${size} B: ${rRate.toFixed(0)} msg/s = ${((rRate * size) / 1024 / 1024).toFixed(1)} MB/s`);
}
process.exit(0);
```

- [ ] **Step 2: Run it**

```bash
node infra/broker-spike/exp/scale.mjs
```

Expected: Kafka's consumer sweep flattens between 4 and 8 — that flat segment *is* the partition cap, and it is the single most important operational fact about Kafka consumer scaling.

- [ ] **Step 3: Commit**

```bash
git add infra/broker-spike/exp/scale.mjs infra/broker-spike/RESULTS.md
git commit -m "test(broker-spike): consumer scaling and message-size sweep"
```

---

## Task 8: Does a trace survive the broker hop?

**Aspect: 16.** The ADR measured *how many* metrics each broker emits. It never checked the thing this repo actually cares about: whether a span from the producer connects to a span in the consumer, through the broker, in Tempo. Without that, the saga chain in Phase 3 has no end-to-end trace.

**Files:**
- Create: `infra/broker-spike/exp/trace.mjs`

**Interfaces:**
- Consumes: `record`, `sleep` from `lib.mjs`; OTel bootstrap pattern from `apps/url-shortener-node/src/otel.ts`.
- Produces: a trace id printed to stdout, looked up in Tempo by hand.

- [ ] **Step 1: Add OTel dependencies to the spike**

```bash
cd infra/broker-spike
npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
      @opentelemetry/exporter-trace-otlp-http @opentelemetry/api
```

- [ ] **Step 2: Write `infra/broker-spike/exp/trace.mjs`**

```js
// Does context propagate THROUGH the broker?
//
// kafkajs and amqplib are both covered by auto-instrumentation, but they
// propagate differently: kafkajs injects W3C traceparent into Kafka record
// HEADERS automatically; amqplib needs the header carried in `headers` on
// publish and read back on consume. If the consumer span's traceId does not
// match the producer's, the saga chain in Phase 3 has no end-to-end trace and
// that is a real gap, not a detail.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { trace, context } from "@opentelemetry/api";

const sdk = new NodeSDK({
  serviceName: "broker-spike",
  traceExporter: new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:7318"}/v1/traces`,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});
await sdk.start();

const { kafkaClient, rabbitConn, record, sleep } = await import("../lib.mjs");
const tracer = trace.getTracer("broker-spike");

async function kafkaTrace() {
  const client = kafkaClient("trace");
  const admin = client.admin(); await admin.connect();
  await admin.createTopics({ topics: [{ topic: "exp.trace", numPartitions: 1, replicationFactor: 1 }] })
    .catch(() => {});
  await admin.disconnect();

  let produceTraceId;
  const producer = client.producer(); await producer.connect();
  await tracer.startActiveSpan("outbox.publish", async (span) => {
    produceTraceId = span.spanContext().traceId;
    await producer.send({ topic: "exp.trace", acks: -1, messages: [{ value: "traced" }] });
    span.end();
  });
  await producer.disconnect();

  let consumeTraceId = null;
  const consumer = client.consumer({ groupId: `trace-${Date.now()}` });
  await consumer.connect(); await consumer.subscribe({ topic: "exp.trace", fromBeginning: true });
  await consumer.run({
    eachMessage: async () => {
      consumeTraceId = trace.getSpan(context.active())?.spanContext().traceId ?? null;
    },
  });
  await sleep(4000);
  await consumer.disconnect();
  return { produceTraceId, consumeTraceId, linked: produceTraceId === consumeTraceId };
}

const k = await kafkaTrace();
console.log("kafka trace:", k);
await record("observability", "kafka",
  `producer traceId ${k.produceTraceId?.slice(0, 12)} / consumer ${k.consumeTraceId?.slice(0, 12) ?? "none"} — linked: ${k.linked}`);
console.log(`\nLook it up: http://localhost:7080/explore → Tempo → ${k.produceTraceId}`);

await sdk.shutdown();
process.exit(0);
```

- [ ] **Step 3: Run with the observability stack up**

```bash
podman compose -f infra/observability/compose.yaml up -d
node infra/broker-spike/exp/trace.mjs
```

- [ ] **Step 4: Confirm in Tempo by eye**

Open the printed trace id in Grafana → Explore → Tempo. Expected: one trace containing `outbox.publish`, a `send` span, and a consumer span. If the consumer span is in a *different* trace, record that — it means header propagation is not working and the Phase-3 saga trace would be broken in exactly the same way.

- [ ] **Step 5: Repeat for RabbitMQ**

Add a `rabbitTrace()` mirroring `kafkaTrace()` using `ch.sendToQueue` and `ch.consume`. Record the same `linked` boolean. Do not assume the result matches Kafka's — the two instrumentations differ.

- [ ] **Step 6: Commit**

```bash
git add infra/broker-spike/exp/trace.mjs infra/broker-spike/package.json infra/broker-spike/package-lock.json infra/broker-spike/RESULTS.md
git commit -m "test(broker-spike): trace propagation across the broker hop"
```

---

## Task 9: Operational complexity, counted

**Aspect: 13.** Turn a subjective aspect into four countable numbers. No new script.

**Files:**
- Modify: `infra/broker-spike/RESULTS.md`

- [ ] **Step 1: Count the configuration each broker needed**

```bash
cd infra/broker-spike
# lines of compose config per broker, comments excluded
sed -n '/^  kafka:/,/^  rabbitmq:/p'  compose.yaml | grep -vE '^\s*#' | grep -c '[^[:space:]]'
sed -n '/^  rabbitmq:/,/^  # Kafka has no/p' compose.yaml | grep -vE '^\s*#' | grep -c '[^[:space:]]'
wc -l < rabbitmq.conf
```

- [ ] **Step 2: Count containers, ports and distinct setup failures**

Record: containers per broker (Kafka 2, RabbitMQ 1), published ports (Kafka 2, RabbitMQ 3), and the setup failures each cost during the spike — from the ADR's gotcha list, Kafka 1 (`KAFKA_HEAP_OPTS`) and RabbitMQ 2 (removed env var, healthcheck cookie race).

- [ ] **Step 3: Record all of it**

```bash
node -e 'import("./lib.mjs").then(async (l) => {
  await l.record("operational complexity", "kafka", "N compose lines, 2 containers, 2 ports, 1 setup failure, JVM heap must be set separately");
  await l.record("operational complexity", "rabbitmq", "N compose lines + M conf lines, 1 container, 3 ports, 2 setup failures");
  process.exit(0);
});'
```

Replace `N` and `M` with the counts from Step 1 before running.

- [ ] **Step 4: Commit**

```bash
git add infra/broker-spike/RESULTS.md
git commit -m "docs(broker-spike): count operational complexity instead of asserting it"
```

---

## Task 10: Research pack — the five aspects a laptop cannot measure

**Aspects: 12, 14, 15 (pricing half), 17, 18.** These get written down with sources and dates, and are clearly marked as *not measured*.

**Files:**
- Create: `infra/broker-spike/research.md`

- [ ] **Step 1: Create the file with the five headings and the questions each must answer**

```markdown
# Tier C — researched, not measured

Everything here is documentation and pricing, checked on the date shown. It is
NOT evidence from this machine. Anything that becomes decision-relevant should
be promoted to an experiment rather than trusted from here.

## Availability (aspect 12) — needs a 3-node cluster
- Kafka: replication factor, ISR, `min.insync.replicas`, what `acks=all` means at RF=3, controller quorum in KRaft.
- RabbitMQ: quorum queues (Raft) vs the removed classic mirrored queues in 4.0, and what a quorum queue costs in memory.
- **The single-node spike cannot see any of this.** Trigger to build it: the day a broker outage would page someone.

## Cloud dependency (aspect 14)
- Kafka managed: AWS MSK, Confluent Cloud, Azure Event Hubs (Kafka-protocol compatible).
- RabbitMQ managed: CloudAMQP, Amazon MQ for RabbitMQ.
- Record for each: does the wire protocol stay standard, so the app code is unchanged if you leave?

## Cost at scale (aspect 15)
- The memory half is measured: 768m vs 256m. Carry it forward.
- Model three volumes: 10k events/day (today), 1M/day, 100M/day. For each, the smallest managed tier that fits and its monthly price.
- Include the ops cost honestly: Kafka needs a metrics sidecar and partition planning that RabbitMQ does not.

## Security (aspect 17)
- Both: TLS on the wire, and what it takes to turn on.
- Kafka: SASL mechanisms, ACLs per topic.
- RabbitMQ: users/vhosts/permissions, and the management UI as an extra exposed surface (note: this spike published it on 7673 with `spike`/`spike` — fine for a throwaway, never beyond it).

## SDK / ecosystem (aspect 18)
- First-hand from this spike: `kafkajs` 2.2.4 and `amqplib` 0.10.5 both worked with no surprises; both ship types.
- Check: last release date of each, TypeScript type quality, and whether an outbox-relay library exists for either, or whether that is code we own.
```

- [ ] **Step 2: Fill each heading with sourced findings**

Use `mcp__f070abf1-f4f0-413f-b538-43310adc709d__query-docs` (Context7) for library and broker documentation rather than recalling it. For pricing, cite the vendor page and the date read. Every claim gets a source or is deleted.

- [ ] **Step 3: Commit**

```bash
git add infra/broker-spike/research.md
git commit -m "docs(broker-spike): research pack for the aspects a single node cannot measure"
```

---

## Task 11: Fold everything into the ADR

**Aspect: 20**, plus the scorecard rewrite. This is where the evaluation either confirms the decision or overturns it.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-broker-kafka-vs-rabbitmq.md`
- Modify: `docs/system-design-progress.md`

- [ ] **Step 1: Replace the nine-criterion scorecard with the full 20-aspect table**

One row per aspect, four columns: aspect, Kafka, RabbitMQ, winner. Every cell carries either a measured number with its task number, or the word **researched**. No cell says "better" without a figure behind it.

- [ ] **Step 2: Write the contradictions section**

For every measurement that contradicts something the ADR already claims, add both under a heading `## Corrections from the full evaluation`, with the old claim quoted and the new number beside it. The repo's standing habit (root `CLAUDE.md`) is to keep both, not to overwrite.

- [ ] **Step 3: Re-decide, in writing**

Answer explicitly, using Task 5 Step 3: **does replay get used?**

- If **yes** — the ADR stands. Say which concrete week-11/13 step needs it.
- If **no** — flip the decision to RabbitMQ and say so plainly. The ADR's Kafka argument was entirely "the syllabus needs a log"; if the syllabus turns out not to, then a 3× memory cost buys nothing and the honest ADR says RabbitMQ.

Change `**Status:** Proposed` to `**Status:** Accepted` (or `Superseded by …`) with the date.

- [ ] **Step 4: Log it**

Append one dated entry to `docs/system-design-progress.md` following the existing style: what was measured, what contradicted, what the decision became. Add any new weak concepts.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-14-broker-kafka-vs-rabbitmq.md docs/system-design-progress.md
git commit -m "docs(adr): complete the 20-aspect broker evaluation and settle the decision"
```

---

## Sequencing and time budget

| Order | Task | Time | Could flip the decision? |
|---|---|---|---|
| 1 | Task 1 — harness | 30 min | — |
| 2 | **Task 5 — replay & fan-out** | 40 min | **Yes — this is the one** |
| 3 | **Task 4 — ack, retry, DLQ** | 60 min | Yes |
| 4 | **Task 6 — backpressure** | 40 min | Changes sizing |
| 5 | **Task 2 — crash test** | 45 min | Yes, via the fsync variant |
| 6 | Task 3 — ordering | 30 min | No |
| 7 | Task 7 — scaling & size | 40 min | No |
| 8 | Task 8 — trace propagation | 60 min | No, but it is a real Phase-3 gap |
| 9 | Task 9 — ops complexity | 20 min | No |
| 10 | Task 10 — research pack | 90 min | No |
| 11 | Task 11 — fold into the ADR | 30 min | — |

**Full run ≈ 8 h. Decision-relevant core (Tasks 1, 5, 4, 6, 2) ≈ 3½ h.**

Task 5 runs second on purpose: it is cheap, and if replay turns out to be unused, several later tasks are worth less and the ADR flips before the effort is spent.

## Out of scope, with trigger points

- **Multi-node clustering, replication, failover.** Needs three brokers and a way to partition the network between them. *Trigger: the first time a broker outage would page someone.*
- **A managed-service bake-off.** Real MSK/Confluent/CloudAMQP accounts, real billing. *Trigger: a decision to stop self-hosting.*
- **Exactly-once semantics.** Kafka transactions are a real feature, but with a transactional outbox and an idempotent consumer we deliberately do not use them. *Trigger: a consumer whose side effect genuinely cannot be made idempotent.*
- **Schema registry / Avro / Protobuf.** JSON payloads throughout. *Trigger: a second team consuming these events.*

## Self-review

**Spec coverage.** All 20 aspects from the request map to a task or to Tier C, and the triage table is the index. The ADR's existing nine criteria are all subsumed: delivery guarantees → Task 2; retry/DLQ → Task 4; throughput → Task 7; persistence → Task 5; cost → Tasks 9 and 10; monitoring → Task 8 plus the measured counts; client libs → Task 10; licensing → Task 10; future fit → Task 11 Step 3.

**Placeholders.** Task 9 Step 3 intentionally contains `N` and `M`, and the step says to substitute them from Step 1 before running — that is a computed value, not an unwritten one. Task 4 Step 3 and Task 8 Step 5 ask for code to be written rather than supplying it; both are deliberate, because the point of the measurement is *how much code it takes*, and pre-writing it would destroy the number. Everything else ships working code.

**Type consistency.** `record(aspect, broker, finding)`, `withKafkaTopic(name, partitions, fn)`, `withRabbitQueue(name, opts, fn)`, `kafkaClient(clientId)`, `rabbitConn()`, `sleep(ms)`, `pct(arr, p)` are used with those exact signatures in every task that imports them. Aspect strings are reused verbatim across tasks (`"performance"`, `"observability"`, `"persistence/replay"`, `"consumer model"`) so the results sheet groups cleanly.
