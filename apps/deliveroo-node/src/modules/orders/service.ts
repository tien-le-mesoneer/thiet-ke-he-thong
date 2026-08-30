import { pool, withTransaction, type Queryable } from "../../db.js";
import { chargePayment } from "../payments/service.js";

// Explicit state machine. Every write to orders.orders.status goes through
// transitionOrder below, so an unlisted edge is impossible by construction.
const TRANSITIONS: Record<string, readonly string[]> = {
  PLACED: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "CANCELLED"],
  PAID: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
} as const;

export function canTransition(from: string, to: string): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Thrown when a caller asks for a move the state machine does not allow. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`illegal order transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * The only place `orders.orders.status` is ever written. Two guards, on purpose:
 * the state machine rejects the move before it reaches the database, and the
 * `status = $3` predicate makes the UPDATE a compare-and-set, so a row someone
 * else has already moved is not silently overwritten.
 */
export async function transitionOrder(
  tx: Queryable,
  orderId: string,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);

  const { rows } = await tx.query(
    `UPDATE orders.orders SET status = $1, updated_at = now()
      WHERE id = $2 AND status = $3 RETURNING *`,
    [to, orderId, from],
  );
  const row = rows[0];
  if (!row) throw new Error(`order ${orderId} is no longer in status ${from}`);
  return row as Record<string, unknown>;
}

interface PlaceOrderInput {
  userId: string;
  restaurantId: string;
  items: Array<{ menuItemId: string; quantity: number }>;
}

export async function placeOrder(
  input: PlaceOrderInput,
  idempotencyKey: string | null,
): Promise<unknown> {
  // Week 4 task: idempotency — return the existing order for a repeated key.
  if (idempotencyKey) {
    const { rows } = await pool.query(
      "SELECT * FROM orders.orders WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    if (rows[0]) return rows[0];
  }

  return withTransaction(async (tx) => {
    let totalCents = 0;
    const priced: Array<{ menuItemId: string; quantity: number; priceCents: number }> = [];

    for (const item of input.items) {
      // ⚠️ Week 3 lab: this read-then-write on stock is a RACE CONDITION under
      // concurrent orders. Reproduce it with a load script, then fix it three ways:
      //   1. SELECT ... FOR UPDATE (pessimistic)
      //   2. UPDATE ... SET stock = stock - $q, version = version + 1
      //      WHERE id = $id AND version = $v (optimistic)
      //   3. SET TRANSACTION ISOLATION LEVEL SERIALIZABLE + retry on 40001
      const { rows } = await tx.query(
        "SELECT price_cents, stock FROM catalog.menu_items WHERE id = $1",
        [item.menuItemId],
      );
      const row = rows[0];
      if (!row) throw new Error(`menu item ${item.menuItemId} not found`);
      if (row.stock < item.quantity) throw new Error("insufficient stock");

      await tx.query("UPDATE catalog.menu_items SET stock = stock - $1 WHERE id = $2", [
        item.quantity,
        item.menuItemId,
      ]);

      totalCents += row.price_cents * item.quantity;
      priced.push({ ...item, priceCents: row.price_cents });
    }

    // Born PLACED (the column default) so every later status is reached through
    // the state machine instead of being written straight into the INSERT.
    const { rows: orderRows } = await tx.query(
      `INSERT INTO orders.orders (user_id, restaurant_id, total_cents, idempotency_key)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.userId, input.restaurantId, totalCents, idempotencyKey],
    );
    const order = orderRows[0];

    for (const item of priced) {
      await tx.query(
        `INSERT INTO orders.order_items (order_id, menu_item_id, quantity, price_cents)
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.menuItemId, item.quantity, item.priceCents],
      );
    }

    await transitionOrder(tx, order.id, "PLACED", "PAYMENT_PENDING");

    // NOTE: calling payments inside the order transaction couples them — fine for
    // a monolith, and exactly the coupling you'll break apart with a saga in Phase 3.
    const payment = await chargePayment(tx, order.id, totalCents);
    const nextStatus = payment.status === "COMPLETED" ? "PAID" : "CANCELLED";
    return transitionOrder(tx, order.id, "PAYMENT_PENDING", nextStatus);
  });
}

export async function getOrder(id: string): Promise<unknown> {
  const { rows } = await pool.query(
    `SELECT o.*,
            COALESCE(json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
     FROM orders.orders o
     LEFT JOIN orders.order_items i ON i.order_id = o.id
     WHERE o.id = $1
     GROUP BY o.id`,
    [id],
  );
  return rows[0] ?? null;
}
