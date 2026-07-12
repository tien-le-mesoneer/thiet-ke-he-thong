import type { FastifyInstance } from "fastify";
import { placeOrder, getOrder } from "./service.js";

interface PlaceOrderBody {
  userId: string;
  restaurantId: string;
  items: Array<{ menuItemId: string; quantity: number }>;
}

export async function ordersRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: PlaceOrderBody; Headers: { "idempotency-key"?: string } }>(
    "/",
    async (req, reply) => {
      const idempotencyKey = req.headers["idempotency-key"] ?? null;
      const order = await placeOrder(req.body, idempotencyKey);
      return reply.code(201).send(order);
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const order = await getOrder(req.params.id);
    if (!order) return reply.code(404).send({ error: "order not found" });
    return order;
  });
}
