import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db.js";
import {
  canTransition,
  transitionOrder,
  IllegalTransitionError,
} from "../src/modules/orders/service.js";
import { truncateAll, seedOrder } from "./helpers.js";

beforeEach(truncateAll);
after(async () => { await pool.end(); });

test("canTransition allows the declared edges and nothing else", () => {
  assert.ok(canTransition("PLACED", "PAYMENT_PENDING"));
  assert.ok(canTransition("PAYMENT_PENDING", "PAID"));
  assert.ok(canTransition("PAYMENT_PENDING", "CANCELLED"));
  assert.ok(canTransition("PAID", "CONFIRMED"));
  assert.ok(canTransition("CONFIRMED", "DELIVERED"));

  assert.ok(!canTransition("PLACED", "PAID")); // no skipping payment
  assert.ok(!canTransition("DELIVERED", "CANCELLED")); // terminal
  assert.ok(!canTransition("CANCELLED", "PAID"));
  assert.ok(!canTransition("NOPE", "PAID")); // unknown state
});

test("transitionOrder moves the row on a legal edge", async () => {
  const orderId = await seedOrder("PLACED");
  const row = await transitionOrder(pool, orderId, "PLACED", "PAYMENT_PENDING");
  assert.equal(row["status"], "PAYMENT_PENDING");

  const { rows } = await pool.query("SELECT status FROM orders.orders WHERE id = $1", [orderId]);
  assert.equal(rows[0].status, "PAYMENT_PENDING");
});

test("transitionOrder rejects an illegal edge and leaves the row untouched", async () => {
  const orderId = await seedOrder("PLACED");
  await assert.rejects(
    () => transitionOrder(pool, orderId, "PLACED", "DELIVERED"),
    (err: unknown) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal(err.from, "PLACED");
      assert.equal(err.to, "DELIVERED");
      return true;
    },
  );

  const { rows } = await pool.query("SELECT status FROM orders.orders WHERE id = $1", [orderId]);
  assert.equal(rows[0].status, "PLACED");
});

test("transitionOrder fails when the row is not in the expected `from` status", async () => {
  const orderId = await seedOrder("PAID"); // someone else already moved it
  await assert.rejects(
    () => transitionOrder(pool, orderId, "PLACED", "PAYMENT_PENDING"),
    /no longer in status PLACED/,
  );
});
