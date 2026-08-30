# apps/deliveroo-node

Fastify + TypeScript food-delivery service — the long-arc build for the study
plan (modular monolith → microservices, Phases 2–3). Postgres via the raw `pg`
driver; migrations are plain SQL files in `migrations/`, applied by
`scripts/migrate.ts`. No ORM.

## Run

```bash
podman network create sd-net                          # once
podman compose -f apps/deliveroo-node/compose.yaml up -d   # app + postgres
npm run migrate                                      # host-side, against localhost:5433
npm run dev
npm test   # runs against deliveroo_test, never the dev database
```

## Status

Earlier along than `url-shortener-node`. Week-1 acceptance and Week-2
(`W2.enforced`, `W2.tests-exist`, `W2.flow`) are green; Week 3 is next — the
stock race condition in `placeOrder` is still deliberately open. Concepts and
checks live in `acceptance.node.md` and `docs/system-design-acceptance.md`,
driven by `/learn-sd`.

Not yet instrumented. The observability spec plans an OTel preload here once the
saga chain exists — until then there is no distributed trace worth collecting.

## Ports

Postgres is published on **5433**, not 5432. A Homebrew PostgreSQL already owns
5432 on localhost and silently shadows the container — a test run once pointed
at the wrong database entirely because of it.
