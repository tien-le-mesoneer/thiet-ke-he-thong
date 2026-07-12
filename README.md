# deliveroo-lite

Practice project for the system design study plan (see `docs/`). Week 1–4: **modular monolith**. Phase 2 extracts modules into services.

## Stack

Node 22 + TypeScript + Fastify + Postgres (raw SQL, no ORM — you'll learn more). Containers via **Podman**.

## Setup

```sh
# 1. start postgres
podman compose up -d          # or: podman-compose up -d

# 2. install deps & migrate
npm install
npm run migrate

# 3. run
npm run dev
curl localhost:3000/health
```

## Try the flow

```sh
# create a user
curl -s -X POST localhost:3000/users -H 'content-type: application/json' \
  -d '{"email":"a@b.c","name":"Alice"}'

# create restaurant + menu item (use the returned ids)
curl -s -X POST localhost:3000/catalog/restaurants -H 'content-type: application/json' \
  -d '{"name":"Pho 24"}'
curl -s -X POST localhost:3000/catalog/restaurants/<RESTAURANT_ID>/items \
  -H 'content-type: application/json' \
  -d '{"name":"Pho Bo","priceCents":800,"stock":10}'

# place an order (payment fake-fails ~10% of the time — that's a feature)
curl -s -X POST localhost:3000/orders -H 'content-type: application/json' \
  -H 'idempotency-key: demo-1' \
  -d '{"userId":"<USER_ID>","restaurantId":"<RESTAURANT_ID>","items":[{"menuItemId":"<ITEM_ID>","quantity":2}]}'
```

## Module boundaries (the whole point)

```
src/modules/
  users/      -> schema users.*      (no one else touches it)
  catalog/    -> schema catalog.*
  orders/     -> schema orders.*     (snapshots prices; no FK into catalog)
  payments/   -> schema payments.*   (called only via its service function)
```

Rules that make Phase 2 extraction possible: no cross-schema foreign keys, no cross-module table access (only service calls), each module could get its own database tomorrow.

## Week-by-week TODOs living in this repo

- **Week 2:** enforce the order state machine (`orders/service.ts`), integration tests for the order flow
- **Week 3:** the race-condition lab — see the ⚠️ comment in `orders/service.ts`; fix 3 ways, benchmark
- **Week 4:** harden idempotency, pagination, OpenAPI spec, seed script, tag `v1-monolith`
