import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getDb, closeDb } from "./db.js";
import { getRedis, closeRedis } from "./cache.js";
import { linkRoutes } from "./modules/links/routes.js";
import { startFlusher, stopFlusher } from "./modules/links/clicks.js";
import { httpLatency } from "./metrics.js";

export function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    genReqId: () => randomUUID(), // correlation id per request
  });

  app.addHook("onResponse", async (req, reply) => {
    // Matched route template, never the raw path — a raw path would let every
    // unknown short code become its own time series and blow up cardinality.
    const route = (req.routeOptions?.url ?? "unknown");
    httpLatency.record(reply.elapsedTime / 1000, {
      method: req.method,
      route,
      status: String(reply.statusCode),
    });
  });

  app.get("/health", async (_req, reply) => {
    try {
      const db = await getDb();
      await db.command({ ping: 1 });
      await getRedis().ping();
      return { status: "ok" };
    } catch (err) {
      reply.code(503);
      return { status: "degraded", error: (err as Error).message };
    }
  });

  void app.register(linkRoutes);

  return app;
}

async function main() {
  const app = buildApp();
  const shutdown = async () => { stopFlusher(); await app.close(); await closeDb(); await closeRedis(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  startFlusher();
}

// Only run when executed directly, so tests can import buildApp without listening.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
