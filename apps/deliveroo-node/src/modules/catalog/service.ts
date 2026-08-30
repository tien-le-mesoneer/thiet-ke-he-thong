import { pool } from "../../db.js";

export interface CreateMenuItemInput {
  restaurantId: string;
  name: string;
  priceCents: number;
  stock: number;
}

export async function createRestaurant(name: string): Promise<unknown> {
  const { rows } = await pool.query(
    "INSERT INTO catalog.restaurants (name) VALUES ($1) RETURNING *",
    [name],
  );
  return rows[0];
}

/** Open restaurants, newest first. Week 5 task: this LIMIT becomes real pagination. */
export async function listOpenRestaurants(): Promise<unknown[]> {
  const { rows } = await pool.query(
    "SELECT * FROM catalog.restaurants WHERE is_open ORDER BY created_at DESC LIMIT 50",
  );
  return rows;
}

export async function createMenuItem(input: CreateMenuItemInput): Promise<unknown> {
  const { rows } = await pool.query(
    `INSERT INTO catalog.menu_items (restaurant_id, name, price_cents, stock)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.restaurantId, input.name, input.priceCents, input.stock],
  );
  return rows[0];
}

export async function listMenuItems(restaurantId: string): Promise<unknown[]> {
  const { rows } = await pool.query(
    "SELECT * FROM catalog.menu_items WHERE restaurant_id = $1",
    [restaurantId],
  );
  return rows;
}
