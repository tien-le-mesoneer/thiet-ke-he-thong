import Fastify from "fastify";
import { config } from "./config.js";
import { pool } from "./db.js";
import { usersRoutes } from "./modules/users/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { ordersRoutes } from "./modules/orders/routes.js";

const app = Fastify({
  logger: { level: config.logLevel }, // structured JSON logs from day one
});

app.get("/health", async () => {
  await pool.query("SELECT 1");
  return { status: "ok" };
});

// Module boundaries: each module registers under its own prefix and only
// touches its own schema. Cross-module access goes through module services,
// never through each other's tables. This discipline is what gets extracted
// into real services in Phase 2.
await app.register(usersRoutes, { prefix: "/users" });
await app.register(catalogRoutes, { prefix: "/catalog" });
await app.register(ordersRoutes, { prefix: "/orders" });

await app.listen({ port: config.port, host: "0.0.0.0" });
