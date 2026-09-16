import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { pool } from "../src/db.js";
import { listPaymentsForOrder } from "../src/modules/payments/service.js";
import { truncateAll, seedCatalog, withPaymentOutcome } from "./helpers.js";

let app: FastifyInstance;
before(async () => { app = await buildApp(); await app.ready(); });
beforeEach(truncateAll);
after(async () => { await app.close(); await pool.end(); });

async function stockOf(menuItemId: string): Promise<number> {
  const { rows } = await pool.query("SELECT stock FROM catalog.menu_items WHERE id = $1", [
    menuItemId,
  ]);
  return rows[0].stock as number;
}

test("place order -> reserve stock -> payment succeeds -> order is PAID", async () => {
  const f = await seedCatalog(10);

  const res = await withPaymentOutcome("COMPLETED", () =>
    app.inject({
      method: "POST",
      url: "/orders",
      payload: { userId: f.userId, restaurantId: f.restaurantId,
                 items: [{ menuItemId: f.menuItemId, quantity: 2 }] },
    }),
  );

  assert.equal(res.statusCode, 201);
  const order = res.json();
  assert.equal(order.status, "PAID");
  assert.equal(order.total_cents, f.priceCents * 2);

  assert.equal(await stockOf(f.menuItemId), 8); // stock reserved

  const payments = (await listPaymentsForOrder(order.id)) as Array<{ status: string }>;
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.status, "COMPLETED");

  // The order line survived the transaction alongside the status change.
  const detail = await app.inject({ method: "GET", url: `/orders/${order.id}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().items.length, 1);
});

test("payment failure lands the order in CANCELLED", async () => {
  const f = await seedCatalog(10);

  const res = await withPaymentOutcome("FAILED", () =>
    app.inject({
      method: "POST",
      url: "/orders",
      payload: { userId: f.userId, restaurantId: f.restaurantId,
                 items: [{ menuItemId: f.menuItemId, quantity: 1 }] },
    }),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.json().status, "CANCELLED");

  const payments = (await listPaymentsForOrder(res.json().id)) as Array<{ status: string }>;
  assert.equal(payments[0]?.status, "FAILED");

  // Documents today's behaviour, not the desired one: the stock decrement is not
  // rolled back when the charge fails. Releasing it is the compensating step the
  // Phase 3 saga has to add.
  assert.equal(await stockOf(f.menuItemId), 9);
});

test("an unstubbed order lands in one of the two legal terminal states", async () => {
  const f = await seedCatalog(5);
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    payload: { userId: f.userId, restaurantId: f.restaurantId,
               items: [{ menuItemId: f.menuItemId, quantity: 1 }] },
  });

  assert.equal(res.statusCode, 201);
  assert.ok(["PAID", "CANCELLED"].includes(res.json().status), res.json().status);
});

test("insufficient stock rolls the whole order back", async () => {
  const f = await seedCatalog(1);

  await assert.rejects(() =>
    withPaymentOutcome("COMPLETED", () =>
      app.inject({
        method: "POST",
        url: "/orders",
        payload: { userId: f.userId, restaurantId: f.restaurantId,
                   items: [{ menuItemId: f.menuItemId, quantity: 5 }] },
      }).then((r) => { if (r.statusCode >= 500) throw new Error(r.json().message); }),
    ),
  );

  assert.equal(await stockOf(f.menuItemId), 1); // transaction rolled back
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM orders.orders");
  assert.equal(rows[0].n, 0);
});
