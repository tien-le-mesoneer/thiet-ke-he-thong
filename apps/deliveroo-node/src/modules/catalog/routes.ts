import type { FastifyInstance } from "fastify";
import {
  createRestaurant,
  listOpenRestaurants,
  createMenuItem,
  listMenuItems,
} from "./service.js";

interface CreateRestaurantBody {
  name: string;
}

interface CreateMenuItemBody {
  name: string;
  priceCents: number;
  stock: number;
}

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateRestaurantBody }>("/restaurants", async (req, reply) => {
    const restaurant = await createRestaurant(req.body.name);
    return reply.code(201).send(restaurant);
  });

  app.get("/restaurants", async () => listOpenRestaurants());

  app.post<{ Params: { id: string }; Body: CreateMenuItemBody }>(
    "/restaurants/:id/items",
    async (req, reply) => {
      const item = await createMenuItem({ restaurantId: req.params.id, ...req.body });
      return reply.code(201).send(item);
    },
  );

  app.get<{ Params: { id: string } }>("/restaurants/:id/items", async (req) =>
    listMenuItems(req.params.id),
  );
}
