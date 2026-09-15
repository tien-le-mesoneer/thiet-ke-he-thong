// Time-to-serving, measured at the PROTOCOL level. A TCP connect succeeds
// ~1s after `up -d` because podman's port proxy accepts before the broker
// exists — so a port probe measures podman, not the broker.
import { Kafka, logLevel } from "kafkajs";
import amqp from "amqplib";

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1);
const retry = async (name, fn) => {
  for (;;) {
    try { await fn(); console.log(`${name.padEnd(9)} serving after ${el()}s`); return; }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }
};

await Promise.all([
  retry("kafka", async () => {
    const a = new Kafka({ clientId: "probe", brokers: ["localhost:7092"], logLevel: logLevel.NOTHING,
      retry: { retries: 0, initialRetryTime: 50 } }).admin();
    await a.connect(); await a.listTopics(); await a.disconnect();
  }),
  retry("rabbitmq", async () => {
    const c = await amqp.connect("amqp://spike:spike@localhost:7672");
    const ch = await c.createChannel(); await ch.close(); await c.close();
  }),
]);
process.exit(0);
