# apps/deliveroo-node

Fastify + TypeScript food-delivery service — the long-arc build for the study
plan (modular monolith → microservices, Phases 2–3). Postgres via the raw `pg`
driver; migrations are plain SQL files in `migrations/`, applied by
`scripts/migrate.ts`. No ORM.

## Run

```bash
podman compose -f apps/deliveroo-node/compose.yaml start
npm run migrate
npm run dev
npm test
```

## Status

Earlier along than `url-shortener-node`. Week-1 acceptance (`W1.migrations`) is
green; **`W2.enforced` is still RED**. Concepts and checks live in
`acceptance.node.md` and `docs/system-design-acceptance.md`, driven by
`/learn-sd`.

Not yet instrumented. The observability spec plans an OTel preload here once the
saga chain exists — until then there is no distributed trace worth collecting.
