import { pool } from "../src/db.js";

/** Wipe every module's tables. Children before parents — there are real FKs. */
export async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE orders.order_items, orders.orders, payments.payments, catalog.menu_items, catalog.restaurants, users.users CASCADE",
  );
}

/**
 * An order row in a chosen status, for testing the guard in isolation. Writing
 * the status directly is only acceptable here: this is a fixture standing in for
 * history that already happened, not a transition the app is performing.
 */
export async function seedOrder(status: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO orders.orders (user_id, restaurant_id, status, total_cents)
     VALUES (gen_random_uuid(), gen_random_uuid(), $1, 1000) RETURNING id`,
    [status],
  );
  return rows[0].id as string;
}

export interface Fixtures {
  userId: string;
  restaurantId: string;
  menuItemId: string;
  priceCents: number;
}

/** One user, one restaurant, one menu item with stock — enough to place an order. */
export async function seedCatalog(stock: number, priceCents = 1250): Promise<Fixtures> {
  const { rows: users } = await pool.query(
    "INSERT INTO users.users (email, name) VALUES ($1, $2) RETURNING id",
    [`diner-${Date.now()}-${Math.random()}@example.com`, "Test Diner"],
  );
  const { rows: restaurants } = await pool.query(
    "INSERT INTO catalog.restaurants (name) VALUES ($1) RETURNING id",
    ["Test Kitchen"],
  );
  const { rows: items } = await pool.query(
    `INSERT INTO catalog.menu_items (restaurant_id, name, price_cents, stock)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [restaurants[0].id, "Pad Thai", priceCents, stock],
  );
  return {
    userId: users[0].id as string,
    restaurantId: restaurants[0].id as string,
    menuItemId: items[0].id as string,
    priceCents,
  };
}

/**
 * The fake provider fails ~10% of the time on Math.random. Pinning it is what
 * makes both branches of the flow testable; the failure rate itself stays as it
 * is in production code.
 */
export async function withPaymentOutcome<T>(
  outcome: "COMPLETED" | "FAILED",
  fn: () => Promise<T>,
): Promise<T> {
  const real = Math.random;
  Math.random = () => (outcome === "COMPLETED" ? 0 : 0.99);
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
}
