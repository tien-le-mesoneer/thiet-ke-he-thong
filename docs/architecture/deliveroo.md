# deliveroo

`apps/deliveroo-node/` — the long-arc build: a modular monolith today, split
into services in Phases 2–3. Fastify + TypeScript + Postgres through the raw
`pg` driver. Migrations are plain SQL in `migrations/`; there is no ORM.

**Not instrumented.** No OTel preload, so nothing from deliveroo reaches the
Collector. It gets one once the saga chain exists and a distributed trace is
worth collecting.

## Modules

Each module owns one Postgres **schema**, registers under its own URL prefix,
and never reads another module's tables. Cross-module calls go through the
other module's `service.ts`. That discipline is the seam Phase 2 will cut along.

```mermaid
flowchart LR
  subgraph app[deliveroo process · :3000]
    U[users<br/>/users]
    C[catalog<br/>/catalog]
    O[orders<br/>/orders]
    P[payments<br/>/payments]
  end
  subgraph pg[Postgres · host :5433]
    su[(users.*)]
    sc[(catalog.*)]
    so[(orders.*)]
    sp[(payments.*)]
  end
  U --> su
  C --> sc
  O --> so
  O -->|stock read + decrement| sc
  O -->|chargePayment, same tx| P
  P --> sp
```

**The two arrows out of `orders` break the rule on purpose.** `placeOrder`
touches `catalog.menu_items` directly for stock, and calls payments **inside the
order transaction**. Both are noted in the code as couplings the saga will
remove.

## Routes

| Method | Path | Module |
|---|---|---|
| POST / GET | `/users`, `/users/:id` | users |
| POST / GET | `/catalog/restaurants` | catalog |
| GET | `/catalog/restaurants/:id/items` | catalog |
| POST | `/orders` (header `Idempotency-Key`) | orders |
| GET | `/orders/:id` | orders |
| GET | `/payments/order/:orderId` | payments, read-only |
| GET | `/health` | `SELECT 1` |

Payments has no write route: `chargePayment` takes the order's transaction
handle, and an endpoint that charges an arbitrary order id would be a hole.

## Data model

```mermaid
erDiagram
  USERS ||--o{ ORDERS : "user_id (no FK)"
  RESTAURANTS ||--o{ MENU_ITEMS : restaurant_id
  RESTAURANTS ||--o{ ORDERS : "restaurant_id (no FK)"
  ORDERS ||--|{ ORDER_ITEMS : order_id
  MENU_ITEMS ||--o{ ORDER_ITEMS : "menu_item_id (no FK)"
  ORDERS ||--o{ PAYMENTS : "order_id (no FK)"

  USERS {
    uuid id PK
    text email UK
  }
  MENU_ITEMS {
    int price_cents
    int stock
    int version
  }
  ORDERS {
    enum status
    int total_cents
    text idempotency_key UK
  }
  ORDER_ITEMS {
    int price_cents "snapshot"
  }
  PAYMENTS {
    enum status
  }
```

Foreign keys stop at schema boundaries — modules own their data. Inside a
module they're real (`menu_items → restaurants`, `order_items → orders`).
`order_items.price_cents` is a snapshot at order time and is never joined back
to the catalog.

## Placing an order — one transaction

```mermaid
sequenceDiagram
  participant C as client
  participant O as placeOrder
  participant DB as Postgres (one tx)
  participant P as chargePayment

  C->>O: POST /orders + Idempotency-Key
  O->>DB: SELECT by idempotency_key (outside tx)
  alt key seen before
    DB-->>O: existing order
    O-->>C: 201 existing order
  end
  O->>DB: BEGIN
  loop each item
    O->>DB: SELECT price, stock
    Note over O,DB: ⚠ read-then-write race (Week 3)
    O->>DB: UPDATE stock = stock - q
  end
  O->>DB: INSERT order (PLACED), order_items
  O->>DB: PLACED → PAYMENT_PENDING (CAS)
  O->>P: charge (fake, ~10% fail)
  P->>DB: INSERT payment
  O->>DB: PAYMENT_PENDING → PAID or CANCELLED (CAS)
  O->>DB: COMMIT
  O-->>C: 201 order
```

Two known gaps, both deliberate and both on the [roadmap](../roadmap.md):

- **Stock race.** Two concurrent orders can both read `stock = 1` and both
  succeed. Fixing it three ways (pessimistic lock, optimistic version guard,
  `SERIALIZABLE` + retry) is the Week 3 lab.
- **Idempotency check-then-act.** The key lookup runs outside the transaction,
  so two simultaneous retries can both miss it. The `UNIQUE` constraint on
  `idempotency_key` is what actually prevents a duplicate — the second insert
  fails instead of returning the first order.

## Order state machine

```mermaid
stateDiagram-v2
  [*] --> PLACED
  PLACED --> PAYMENT_PENDING
  PLACED --> CANCELLED
  PAYMENT_PENDING --> PAID
  PAYMENT_PENDING --> CANCELLED
  PAID --> CONFIRMED
  PAID --> CANCELLED
  CONFIRMED --> DELIVERED
  DELIVERED --> [*]
  CANCELLED --> [*]
```

Every status write goes through `transitionOrder`, which checks the edge against
`TRANSITIONS` **and** writes with `WHERE id = $2 AND status = $3`, so a row
someone else already moved is not silently overwritten.

**Only three edges are reachable today:** `PLACED → PAYMENT_PENDING` and
`PAYMENT_PENDING → PAID | CANCELLED`, all inside `placeOrder`. No route
confirms, delivers, or cancels a paid order yet.
