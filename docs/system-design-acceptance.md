# System-Design Acceptance Criteria (concept-level)

Machine-checkable "definition of done" per week, expressed as **language-agnostic
concepts** with stable IDs (e.g. `W3.pessimistic`). Each concept is verified
against whichever implementation you're currently building via that app's
manifest: `apps/<impl>/acceptance.<lang>.md` maps every concept ID here to a
concrete check (a grep pattern, a codegraph symbol, a test command) for that
language.

The `learn-sd` skill, in its `this-week` build step, reads `active_impl` from
`system-design-progress.md`, loads the matching manifest, and runs each concept's
concrete check — showing a green/red list. A week's `plan_week` advances only
when its non-`self` concepts are green (or you explicitly override).

Companion to `system-design-plan-detailed.md` (the syllabus). The plan says what
to build; this file says *which concepts prove it was built*; the manifest says
*how to check them in language X*.

## Check types (how a manifest verifies a concept)

| Tag | Verified by | Notes |
|-----|-------------|-------|
| `codegraph` | `codegraph_search` / `codegraph_callers` / `codegraph_impact` | structural — symbol/edge exists (works across Go/Java/TS via tree-sitter) |
| `grep` | ripgrep | literal text: SQL fragments, headers, markers |
| `test` | the app's test runner (`npm test` / `go test` / `./gradlew test`) | behavioral — it actually works |
| `build` | the app's compiler (`npm run typecheck` / `go build` / `./gradlew build`) | compiles clean |
| `file` | path exists | an artifact was produced |
| `git` | `git tag` / `git log` | milestone tags |
| `self` | you answer honestly | whiteboard/interview recall — asked, never a gate |

---

## Phase 1 — Foundations (Weeks 1–4)

Project: a modular-monolith food-delivery clone (`deliveroo-*`), one implementation
per language under `apps/`.

### Week 1 — Scaffold  ·  concept: reliability/maintainability + clean module boundaries
- `W1.health` — a health endpoint exists
- `W1.config` — configuration via env + container setup (compose)
- `W1.logging` — structured logging wired from day one
- `W1.modules` — four module boundaries present: `users`, `catalog`, `orders`, `payments`
- `W1.migrations` — schema migrations run cleanly
- `W1.build` — the app compiles/typechecks clean
- `W1.recall` (`self`) — reliability/scalability/maintainability trade-offs in your design (DDIA ch. 1)

### Week 2 — Order flow + explicit state machine + tests  ·  concept: encoding & workflow modeling
- `W2.state-machine` — an explicit order state machine exists (allowed transitions declared in one place)
- `W2.enforced` — transitions are **enforced**: every status write goes through the transition guard (not set directly)
- `W2.tests-exist` — an order-flow integration test exists
- `W2.flow` (`test`) — place order → reserve items → fake payment → status transition passes
- `W2.recall` (`self`) — JSON vs Protobuf vs Avro + one schema-evolution rule (DDIA ch. 4)

### Week 3 — Race-condition lab  ·  concept: partitioning + isolation & write skew
- `W3.pessimistic` — pessimistic lock path on the inventory decrement (row lock / `SELECT … FOR UPDATE` equivalent)
- `W3.optimistic` — optimistic lock path (version column + conditional update + retry)
- `W3.serializable` — serializable-isolation path with retry on serialization failure
- `W3.version-col` — migration adds a `version` column to the inventory table
- `W3.benchmark` (`file`) — a benchmark comparing all three, with recorded numbers
- `W3.marker-resolved` (`grep`) — the Week-3 race-condition marker in the code is resolved/removed
- `W3.tests` (`test`) — order-flow tests still pass under the new locking
- `W3.recall` (`self`) — pick an isolation level for a given anomaly; justify a partitioning key (DDIA ch. 6–7)

### Week 4 — Polish + idempotency  ·  concept: distributed failures; consistency & consensus
- `W4.idempotent` — repeated idempotency-key returns the existing order, no double charge (proven by a replay test)
- `W4.pagination` — list endpoints paginate (limit/offset or cursor)
- `W4.openapi` (`file`) — an OpenAPI spec is present
- `W4.seed` (`file`) — a seed script exists
- `W4.tests` (`test`) — suite green including the idempotency-replay test
- `W4.tag` (`git`) — milestone tag `v1-monolith` exists (or `v1-monolith-<lang>` per impl)
- `W4.checkpoint` (`self`) — explain replication-lag anomalies; pick an isolation level for a bug; justify a partitioning key (DDIA ch. 5/6/9)

---

## Phase 2 — Decomposition & Communication (Weeks 5–8)

> Concepts filled in on arrival (infra not built yet). Anchor concepts:
- `W5.adr-boundaries` (`file`), `W5.payments-extracted` — payments its own service + schema + REST
- `W6.orders-extracted`, `W6.grpc-contract` — `.proto` contract orders → payments; no cross-service DB joins
- `W7.events`, `W7.outbox` (`grep`) — `OrderPlaced`/`PaymentCompleted`; transactional outbox table + publisher
- `W8.gateway`, `W8.contract-test`; `W8.recall` (`self`) — argue when *not* to extract a service

## Phase 3 — Distributed Data & Resilience (Weeks 9–12)

> Anchor concepts:
- `W9.choreography-saga` — compensating actions; failure paths tested
- `W10.orchestration-saga` + `W10.comparison` (`file`)
- `W11.cqrs-read-model`, `W11.cache-invalidation`
- `W12.resilience` (timeouts/retries+jitter/circuit-breaker/DLQ) + `W12.chaos` (kill mid-saga → no lost/dup orders)
- `W12.adrs` (`file`); `W12.recall` (`self`) — saga vs 2PC from memory

## Phase 4 — Operations & Architect Skills (Weeks 13–16)

> Anchor concepts:
- `W13.k8s` — manifests/probes for all services
- `W14.tracing` (OTel trace spans the saga), `W14.dashboard`
- `W15.loadtest` (`file`, before/after numbers), `W15.hpa`
- `W16.diagram` (`file`, C4), `W16.adr-portfolio` (`file`), `W16.tag` (`git` `v2-microservices`)
- `W16.mocks` (`self`) — 3 mock interviews + architecture walkthrough

---

## Slippage note

When `elapsed_week > plan_week`, the skill applies the plan's slippage rule: it
protects the `self` reflection and that week's exercise, and offers to defer the
build concepts (`codegraph`/`test`/`file`) to a later week rather than letting you
stall. Open build concepts carry forward; they are never silently dropped.
