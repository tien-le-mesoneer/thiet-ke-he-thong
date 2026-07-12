-- Week 1 schema: modular monolith, one database, one schema per module boundary.
-- Keeping separate schemas from day one makes Phase 2 extraction (own DB per service) mechanical.

CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS payments;

-- users module
CREATE TABLE users.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- catalog module
CREATE TABLE catalog.restaurants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  is_open     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE catalog.menu_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES catalog.restaurants(id),
  name          TEXT NOT NULL,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  -- stock: the contention playground for Week 3 (locking strategies)
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  version       INTEGER NOT NULL DEFAULT 0  -- for optimistic locking (Week 3)
);

-- orders module: explicit state machine (Week 2)
CREATE TYPE orders.order_status AS ENUM (
  'PLACED', 'PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'DELIVERED', 'CANCELLED'
);

CREATE TABLE orders.orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,           -- no cross-schema FK: modules own their data
  restaurant_id   UUID NOT NULL,
  status          orders.order_status NOT NULL DEFAULT 'PLACED',
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  -- idempotency (Week 4): same key => same order, no duplicates
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders.order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders.orders(id),
  menu_item_id  UUID NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  price_cents   INTEGER NOT NULL  -- snapshot at order time, never join back to catalog
);

CREATE INDEX idx_orders_user ON orders.orders (user_id, created_at DESC);

-- payments module (fake provider)
CREATE TYPE payments.payment_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

CREATE TABLE payments.payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL,
  amount_cents INTEGER NOT NULL,
  status      payments.payment_status NOT NULL DEFAULT 'PENDING',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
