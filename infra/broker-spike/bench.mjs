// Kafka vs RabbitMQ, measured on the workload this repo will actually have:
// an outbox relay draining rows in batches of 100 (see the Q4 discussion and
// docs/superpowers/specs/2026-09-14-broker-kafka-vs-rabbitmq.md).
//
//   node bench.mjs kafka
//   node bench.mjs rabbit
//   node bench.mjs kafka --count 50000 --batch 100
//
// Both brokers are configured for the strongest durability each offers on a
// single node, because a lost outbox event is the failure the whole pattern
// exists to prevent. That is NOT symmetric work — see the ADR's "fairness"
// section before comparing the numbers.

import { Kafka, logLevel } from "kafkajs";
import amqp from "amqplib";

const args = process.argv.slice(2);
const target = args[0];
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(args[i + 1]);
};

const COUNT = flag("count", 20000);
const BATCH = flag("batch", 100);
const TOPIC = "order.events";

// Shaped like a real outbox row, not a toy "hello". Payload size drives
// throughput more than anything else, so it has to be honest.
function makeEvent(i) {
  return JSON.stringify({
    id: i,
    aggregate_id: `11111111-2222-3333-4444-${String(i).padStart(12, "0")}`,
    event_type: "order.paid",
    version: (i % 5) + 1,
    payload: { orderId: `order-${i}`, totalCents: 19000, currency: "CHF", items: 2 },
    published_at: Date.now(),
  });
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function report(label, ms, count, lat) {
  const s = ms / 1000;
  const sorted = lat.slice().sort((a, b) => a - b);
  console.log(
    `${label.padEnd(22)} ${(count / s).toFixed(0).padStart(7)} msg/s  ` +
      `elapsed ${s.toFixed(2).padStart(6)}s  ` +
      `p50 ${pct(sorted, 0.5).toFixed(2).padStart(7)}ms  ` +
      `p99 ${pct(sorted, 0.99).toFixed(2).padStart(7)}ms  ` +
      `max ${sorted[sorted.length - 1].toFixed(2).padStart(8)}ms`,
  );
}

async function runKafka() {
  const kafka = new Kafka({
    clientId: "spike",
    brokers: [`localhost:${process.env.BROKER_KAFKA_PORT ?? 7092}`],
    logLevel: logLevel.ERROR,
  });

  const admin = kafka.admin();
  await admin.connect();
  await admin.deleteTopics({ topics: [TOPIC] }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  // 4 partitions: the number derived from this repo's own volume, not a default.
  await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 4, replicationFactor: 1 }] });
  await admin.disconnect();

  const producer = kafka.producer({ idempotent: false });
  await producer.connect();

  // --- publish, one awaited send per message (the naive relay) -------------
  let lat = [];
  let t0 = performance.now();
  for (let i = 0; i < Math.min(COUNT, 5000); i++) {
    const s = performance.now();
    await producer.send({ topic: TOPIC, acks: -1, messages: [{ key: `k${i % 4}`, value: makeEvent(i) }] });
    lat.push(performance.now() - s);
  }
  report("kafka publish 1-by-1", performance.now() - t0, Math.min(COUNT, 5000), lat);

  // --- publish, batches of BATCH (the LIMIT 100 relay) --------------------
  lat = [];
  t0 = performance.now();
  for (let i = 0; i < COUNT; i += BATCH) {
    const messages = [];
    for (let j = i; j < Math.min(i + BATCH, COUNT); j++) {
      messages.push({ key: `k${j % 4}`, value: makeEvent(j) });
    }
    const s = performance.now();
    await producer.send({ topic: TOPIC, acks: -1, messages });
    lat.push(performance.now() - s);
  }
  report(`kafka publish x${BATCH}`, performance.now() - t0, COUNT, lat);
  await producer.disconnect();

  // --- consume ------------------------------------------------------------
  const consumer = kafka.consumer({ groupId: `spike-${Date.now()}` });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  let seen = 0;
  const e2e = [];
  const ct0 = performance.now();
  await new Promise((resolve) => {
    consumer.run({
      eachMessage: async ({ message }) => {
        e2e.push(Date.now() - JSON.parse(message.value.toString()).published_at);
        if (++seen >= COUNT) resolve();
      },
    });
  });
  report("kafka consume", performance.now() - ct0, seen, e2e);
  await consumer.disconnect();
}

async function runRabbit() {
  const url = `amqp://${process.env.RABBIT_USER ?? "spike"}:${process.env.RABBIT_PASS ?? "spike"}@localhost:${process.env.BROKER_RABBIT_PORT ?? 7672}`;
  const conn = await amqp.connect(url);

  // Confirm channel: sendToQueue's callback fires when the broker has taken
  // responsibility for the message. Without confirms, publishing is fire-and-
  // forget and the throughput number is meaningless.
  const ch = await conn.createConfirmChannel();
  await ch.deleteQueue(TOPIC).catch(() => {});
  await ch.assertQueue(TOPIC, { durable: true });

  const send = (i) =>
    new Promise((resolve, reject) =>
      ch.sendToQueue(TOPIC, Buffer.from(makeEvent(i)), { persistent: true }, (err) =>
        err ? reject(err) : resolve(),
      ),
    );

  // --- publish, one awaited confirm per message ---------------------------
  let lat = [];
  let t0 = performance.now();
  for (let i = 0; i < Math.min(COUNT, 5000); i++) {
    const s = performance.now();
    await send(i);
    lat.push(performance.now() - s);
  }
  report("rabbit publish 1-by-1", performance.now() - t0, Math.min(COUNT, 5000), lat);

  // --- publish, batches of BATCH ------------------------------------------
  lat = [];
  t0 = performance.now();
  for (let i = 0; i < COUNT; i += BATCH) {
    const s = performance.now();
    const pending = [];
    for (let j = i; j < Math.min(i + BATCH, COUNT); j++) pending.push(send(j));
    await Promise.all(pending);
    lat.push(performance.now() - s);
  }
  report(`rabbit publish x${BATCH}`, performance.now() - t0, COUNT, lat);
  await ch.close();

  // --- consume ------------------------------------------------------------
  const cch = await conn.createChannel();
  await cch.prefetch(BATCH);
  let seen = 0;
  const e2e = [];
  const ct0 = performance.now();
  await new Promise((resolve) => {
    cch.consume(TOPIC, (msg) => {
      if (!msg) return;
      e2e.push(Date.now() - JSON.parse(msg.content.toString()).published_at);
      cch.ack(msg);
      if (++seen >= COUNT) resolve();
    });
  });
  report("rabbit consume", performance.now() - ct0, seen, e2e);
  await cch.close();
  await conn.close();
}

console.log(`\n=== ${target} — ${COUNT} events, batch ${BATCH}, durable + acked ===`);
if (target === "kafka") await runKafka();
else if (target === "rabbit") await runRabbit();
else {
  console.error("usage: node bench.mjs <kafka|rabbit> [--count N] [--batch N]");
  process.exit(1);
}
process.exit(0);
