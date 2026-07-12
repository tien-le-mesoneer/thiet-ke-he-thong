import type { Queryable } from "../../db.js";

interface PaymentResult {
  id: string;
  status: "COMPLETED" | "FAILED";
}

/**
 * Fake payment provider. ~10% random failure so failure paths exist from day one.
 * Phase 2: this module becomes its own service behind an HTTP/gRPC API.
 */
export async function chargePayment(
  tx: Queryable,
  orderId: string,
  amountCents: number,
): Promise<PaymentResult> {
  const status = Math.random() < 0.9 ? "COMPLETED" : "FAILED";
  const { rows } = await tx.query(
    `INSERT INTO payments.payments (order_id, amount_cents, status)
     VALUES ($1, $2, $3) RETURNING id, status`,
    [orderId, amountCents, status],
  );
  return rows[0] as PaymentResult;
}
