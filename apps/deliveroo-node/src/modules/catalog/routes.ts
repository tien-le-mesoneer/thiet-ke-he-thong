import type { FastifyInstance } from "fastify";
import { pool } from "../../db.js";

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
    const { rows } = await pool.query(
      "INSERT INTO catalog.restaurants (name) VALUES ($1) RETURNING *",
      [req.body.name],
    );
    return reply.code(201).send(rows[0]);
  });

  app.get("/restaurants", async () => {
    const { rows } = await pool.query(
      "SELECT * FROM catalog.restaurants WHERE is_open ORDER BY created_at DESC LIMIT 50",
    );
    return rows;
  });

  app.post<{ Params: { id: string }; Body: CreateMenuItemBody }>(
    "/restaurants/:id/items",
    async (req, reply) => {
      const { name, priceCents, stock } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO catalog.menu_items (restaurant_id, name, price_cents, stock)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.id, name, priceCents, stock],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  app.get<{ Params: { id: string } }>("/restaurants/:id/items", async (req) => {
    const { rows } = await pool.query(
      "SELECT * FROM catalog.menu_items WHERE restaurant_id = $1",
      [req.params.id],
    );
    return rows;
  });
}
