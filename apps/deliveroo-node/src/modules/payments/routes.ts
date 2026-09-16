import type { FastifyInstance } from "fastify";
import { listPaymentsForOrder } from "./service.js";

// Read-only on purpose. Charging is an internal step of the order transaction
// (see orders/service.ts) and takes the transaction handle, so it must not be
// reachable over HTTP — an endpoint that charges an arbitrary order id is a
// hole, not a feature. Phase 2 splits this module into its own service and the
// charge path becomes an authenticated service-to-service call, not a public one.
export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { orderId: string } }>("/order/:orderId", async (req) =>
    listPaymentsForOrder(req.params.orderId),
  );
}
