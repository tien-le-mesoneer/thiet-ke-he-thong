# Acceptance manifest — deliveroo-node

Maps the language-agnostic concept IDs in `docs/system-design-acceptance.md` to
concrete checks for this Node/TypeScript implementation. The `learn-sd` skill
loads this file when `active_impl: node`.

- Paths are relative to this app dir (`apps/deliveroo-node/`).
- `test` / `build` commands run from this app dir.
- `codegraph` checks query the repo-wide index (it parses TS); symbol names below.

## Phase 1

| Concept | Type | Concrete check (Node) |
|---------|------|-----------------------|
| `W1.health` | grep | `/health` route in `src/index.ts` |
| `W1.config` | file | `src/config.ts` exists; `compose.yaml` present |
| `W1.logging` | grep | `pino` wired in `src/index.ts` / `package.json` |
| `W1.modules` | codegraph | dirs `src/modules/{users,catalog,orders,payments}` each with routes/service |
| `W1.migrations` | file+test | `migrations/001_init.sql`; `npm run migrate` succeeds |
| `W1.build` | build | `npm run typecheck` exits 0 |
| `W2.state-machine` | codegraph | `TRANSITIONS` const + `canTransition` in `src/modules/orders/service.ts` |
| `W2.enforced` | codegraph | status writes in `placeOrder` route through `canTransition` (OPEN: currently sets `PAYMENT_PENDING`/`PAID`/`CANCELLED` directly at `service.ts:67,83`) |
| `W2.tests-exist` | file | `test/` dir with an order-flow test |
| `W2.flow` | test | `npm test` passes the order-flow case |
| `W3.pessimistic` | grep | `SELECT … FOR UPDATE` in the stock read in `src/modules/orders/service.ts` |
| `W3.optimistic` | grep | `UPDATE catalog.menu_items SET stock = stock - $1, version = version + 1 … WHERE … AND version = $` |
| `W3.serializable` | grep | `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` + retry on `40001` |
| `W3.version-col` | grep | `ALTER TABLE catalog.menu_items ADD … version` in a migration |
| `W3.benchmark` | file | `scripts/bench-locking.ts` with recorded numbers |
| `W3.marker-resolved` | grep | `⚠️ Week 3 lab` marker at `src/modules/orders/service.ts:42` removed |
| `W3.tests` | test | `npm test` green |
| `W4.idempotent` | codegraph+test | `placeOrder` idempotency-key read at `service.ts:29`; replay test proves same row, no double charge |
| `W4.pagination` | grep | limit/offset or cursor in `src/modules/{catalog,orders}/routes.ts` |
| `W4.openapi` | file | `openapi.yaml` (or generated) in app root |
| `W4.seed` | file | `scripts/seed.ts` |
| `W4.tests` | test | `npm test` green incl. idempotency-replay |
| `W4.tag` | git | tag `v1-monolith` (or `v1-monolith-node`) |

`self` concepts (`W1.recall`, `W2.recall`, `W3.recall`, `W4.checkpoint`) are asked
by the skill, never gated.

## Phases 2–4

Fill in when this implementation reaches them (service dirs, `.proto` paths,
`docker-compose` topology, k8s manifests). Keep the concept IDs from the shared
doc as the left column so the skill can cross-reference.
