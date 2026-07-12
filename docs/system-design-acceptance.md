# System-Design Acceptance Criteria

Machine-checkable "definition of done" per week. The `learn-sd` skill reads this
file in its `this-week` build step, runs each check with the tool named, and
shows a green/red list. A week's `plan_week` only advances when its criteria are
green (or you explicitly override).

Companion to `system-design-plan-detailed.md` (the syllabus). The plan says what
to build; this file says how we *verify* it was built.

## Check types

| Tag | Verified by | Notes |
|-----|-------------|-------|
| `codegraph` | `codegraph_search` / `codegraph_callers` / `codegraph_impact` | structural — does the symbol/edge exist |
| `grep` | ripgrep over the tree | literal text: SQL fragments, headers, markers |
| `test` | `npm test` | behavioral — does it actually work |
| `typecheck` | `npm run typecheck` | compiles clean |
| `file` | path exists | an artifact was produced (script, spec, migration) |
| `git` | `git tag` / `git log` | milestone tags and commits |
| `self` | you answer honestly | whiteboard/interview recall — no tool can check this |

`self` items are checkpoints, not gates — the skill asks them but never blocks on them.

---

## Phase 1 — Foundations (Weeks 1–4)

Project: the modular monolith in this repo (`deliveroo-lite`).

### Week 1 — Scaffold
Concept: reliability/maintainability basics; clean module boundaries from day one.

- [ ] `grep` — health endpoint exists (`/health` route in `src/index.ts`)
- [ ] `file` — config via env (`src/config.ts`) and container setup (`compose.yaml`)
- [ ] `grep` — structured logging wired (pino in `src/index.ts` / `package.json`)
- [ ] `codegraph` — four module boundaries present: `users`, `catalog`, `orders`, `payments` under `src/modules/`
- [ ] `file` — migrations run cleanly (`migrations/001_init.sql`, `scripts/migrate.ts`)
- [ ] `typecheck` — `npm run typecheck` passes
- [ ] `self` — can you name the reliability/scalability/maintainability trade-offs in your own design (DDIA ch. 1)?

### Week 2 — Order flow + explicit state machine + tests
Concept: encoding & schema evolution; modeling a workflow explicitly.

- [ ] `codegraph` — explicit state machine exists (`canTransition` / `TRANSITIONS` in `src/modules/orders/service.ts`)
- [ ] `codegraph` — transitions are **enforced**, not just declared: status writes in `placeOrder` go through `canTransition` (currently `placeOrder` sets `PAYMENT_PENDING`/`PAID`/`CANCELLED` directly — this box is OPEN until guarded)
- [ ] `file` — a `test/` directory with an order-flow integration test exists
- [ ] `test` — `npm test` passes: place order → reserve items → fake payment → status transition
- [ ] `self` — can you explain JSON vs Protobuf vs Avro and one schema-evolution rule (DDIA ch. 4)?

### Week 3 — Race-condition lab (interview gold)
Concept: partitioning/hot keys; transaction isolation & write skew.

- [ ] `grep`/`codegraph` — pessimistic lock path: `SELECT ... FOR UPDATE` in the inventory decrement
- [ ] `grep`/`codegraph` — optimistic lock path: `UPDATE ... SET stock = stock - $q, version = version + 1 WHERE id = $id AND version = $v`
- [ ] `grep` — serializable path: `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` + retry on `40001`
- [ ] `grep` — migration adds a `version` column to `catalog.menu_items`
- [ ] `file` — benchmark script comparing all three (e.g. `scripts/bench-locking.ts`) with recorded numbers
- [ ] `grep` — the `⚠️ Week 3 lab` marker at `src/modules/orders/service.ts:42` is resolved/removed
- [ ] `test` — order-flow tests still pass under the new locking
- [ ] `self` — can you pick an isolation level for a given anomaly and justify a partitioning key (DDIA ch. 6–7)?

### Week 4 — Polish + idempotency (Phase 1 milestone)
Concept: distributed failures; consistency & consensus (the hard chapters).

- [ ] `codegraph` — idempotent order creation: repeated `idempotency-key` returns the existing order (`placeOrder` in `service.ts` already reads the key — verify a test proves replay returns the same row, no double charge)
- [ ] `grep` — pagination on list endpoints (limit/offset or cursor in `catalog`/`orders` routes)
- [ ] `file` — OpenAPI spec present (`openapi.yaml` or generated equivalent)
- [ ] `file` — seed script (`scripts/seed.ts`)
- [ ] `test` — `npm test` green including an idempotency-replay test
- [ ] `git` — tag `v1-monolith` exists
- [ ] `self` — **Checkpoint:** explain replication-lag anomalies; pick an isolation level for a given bug; justify a partitioning key (DDIA ch. 5/6/9)

---

## Phase 2 — Decomposition & Communication (Weeks 5–8)

> Criteria filled in on arrival — service topology and infra (gRPC, Kafka, gateway)
> aren't built yet, so pinning exact checks now would be guesswork. Anchor checks
> that will hold regardless:

- Week 5 — `file` ADR justifying service boundaries (`docs/adr/`); `payments` extracted to its own schema + REST API
- Week 6 — `orders` extracted; gRPC contract (`.proto`) between orders → payments; no cross-service DB joins
- Week 7 — Kafka/NATS events (`OrderPlaced`, `PaymentCompleted`); `grep` transactional outbox table + publisher
- Week 8 — API gateway routing/auth; consumer-driven contract test; `self` — argue when *not* to extract a service
- `git` — Phase 2 checkpoint tag when 3 services + gateway + event bus run on compose

## Phase 3 — Distributed Data & Resilience (Weeks 9–12)

> Filled in on arrival. Anchor checks:

- Week 9 — choreography saga with compensating actions; failure paths tested
- Week 10 — orchestration saga variant + a written comparison doc (`docs/`)
- Week 11 — CQRS read model consuming events; Redis cache with documented invalidation
- Week 12 — timeouts/retries+jitter/circuit-breaker/DLQ; hand chaos test (kill payments mid-saga → no lost/dup orders)
- `file` — ADRs for saga style, CQRS, caching; `self` — saga vs 2PC from memory

## Phase 4 — Operations & Architect Skills (Weeks 13–16)

> Filled in on arrival. Anchor checks:

- Week 13 — local K8s (kind/k3d) manifests/probes for all services
- Week 14 — OpenTelemetry trace spanning the saga; Prometheus/Grafana dashboard
- Week 15 — k6 load test with before/after bottleneck numbers; HPA scaling
- Week 16 — C4 architecture diagram in README; ADR portfolio in `docs/adr/`; `git` tag `v2-microservices`
- `self` — 3 mock interviews done; 15-min architecture walkthrough delivered

---

## Slippage note

When `elapsed_week > plan_week`, the skill applies the plan's slippage rule: it
protects the `self` reflection and that week's exercise, and offers to defer the
build criteria (the `codegraph`/`test`/`file` boxes) to a later week rather than
letting you stall. Open build boxes carry forward; they are never silently
dropped.
