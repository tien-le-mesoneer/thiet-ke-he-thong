// Steady-state end-to-end latency: consumer already running, publisher emitting
// at a LOW fixed rate. This is the number that matters at 10k events/day
// (~0.12/s average) — the drain numbers in bench.mjs measure how fast a backlog
// clears, which is a different question and flatters whichever broker batches
// harder.
import { Kafka, logLevel } from "kafkajs";
import amqp from "amqplib";

const target = process.argv[2];
const N = Number(process.argv[3] ?? 500);
const GAP_MS = Number(process.argv[4] ?? 20);
const TOPIC = "steady.events";
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function report(name, lat) {
  console.log(
    `${name.padEnd(10)} n=${lat.length}  p50 ${pct(lat, 0.5).toFixed(2)}ms  ` +
      `p95 ${pct(lat, 0.95).toFixed(2)}ms  p99 ${pct(lat, 0.99).toFixed(2)}ms  ` +
      `max ${Math.max(...lat).toFixed(2)}ms`,
  );
}

if (target === "kafka") {
  const kafka = new Kafka({ clientId: "steady", brokers: ["localhost:7092"], logLevel: logLevel.NOTHING });
  const admin = kafka.admin(); await admin.connect();
  await admin.deleteTopics({ topics: [TOPIC] }).catch(() => {});
  await sleep(800);
  await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 4, replicationFactor: 1 }] });
  await admin.disconnect();

  const consumer = kafka.consumer({ groupId: `steady-${Date.now()}`, maxWaitTimeInMs: 10 });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  const lat = [];
  let done;
  const finished = new Promise((r) => (done = r));
  await consumer.run({
    eachMessage: async ({ message }) => {
      lat.push(Number(process.hrtime.bigint() - BigInt(JSON.parse(message.value.toString()).t)) / 1e6);
      if (lat.length >= N) done();
    },
  });
  await sleep(3000); // let the group finish joining before we start timing

  const producer = kafka.producer(); await producer.connect();
  for (let i = 0; i < N; i++) {
    await producer.send({ topic: TOPIC, acks: -1,
      messages: [{ key: `k${i % 4}`, value: JSON.stringify({ i, t: String(process.hrtime.bigint()) }) }] });
    await sleep(GAP_MS);
  }
  await finished;
  report("kafka", lat);
  await producer.disconnect(); await consumer.disconnect();
} else {
  const conn = await amqp.connect("amqp://spike:spike@localhost:7672");
  const ch = await conn.createConfirmChannel();
  await ch.deleteQueue(TOPIC).catch(() => {});
  await ch.assertQueue(TOPIC, { durable: true });

  const cch = await conn.createChannel();
  await cch.prefetch(50);
  const lat = [];
  let done;
  const finished = new Promise((r) => (done = r));
  await cch.consume(TOPIC, (m) => {
    if (!m) return;
    lat.push(Number(process.hrtime.bigint() - BigInt(JSON.parse(m.content.toString()).t)) / 1e6);
    cch.ack(m);
    if (lat.length >= N) done();
  });
  await sleep(500);

  for (let i = 0; i < N; i++) {
    await new Promise((res, rej) =>
      ch.sendToQueue(TOPIC, Buffer.from(JSON.stringify({ i, t: String(process.hrtime.bigint()) })),
        { persistent: true }, (e) => (e ? rej(e) : res())));
    await sleep(GAP_MS);
  }
  await finished;
  report("rabbitmq", lat);
  await ch.close(); await cch.close(); await conn.close();
}
process.exit(0);
