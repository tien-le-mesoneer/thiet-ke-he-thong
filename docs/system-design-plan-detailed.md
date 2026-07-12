# System Design Plan — Week-by-Week Detail

Companion to `system-design-learning-plan.md`. Each week: ~4 hrs reading, ~4-5 hrs building, ~1-2 hrs one timed design exercise (45 min cold attempt → compare with Xu's solution → write down what you missed).

---

## Phase 1 — Foundations (Weeks 1–4)

**Project:** modular monolith — food-delivery clone ("Deliveroo-lite"): users, restaurants, menu, orders, payments (fake), notifications. One repo, one Postgres, Docker Compose.

### Week 1
- **Read:** DDIA ch. 1–2 (reliability/scalability/maintainability; data models). Skim ch. 3 (storage engines — know B-tree vs LSM at concept level, don't get stuck here).
- **Build:** Scaffold the project (Go: Chi/Gin + sqlc/GORM, or Node: NestJS + Prisma). Modules as packages with clear internal boundaries: `users`, `catalog`, `orders`, `payments`. Docker Compose with Postgres. Health endpoint, config via env, structured logging from day one.
- **Exercise:** URL shortener (Xu vol. 1). Practice the template: requirements → estimates → API → data model → design → deep dive.

### Week 2
- **Read:** DDIA ch. 4 (encoding: JSON vs Protobuf vs Avro, schema evolution) + ch. 5 (replication: leader/follower, replication lag, read-your-writes).
- **Build:** Implement core flows: place order → reserve items → fake payment → order status transitions. Model the order state machine explicitly. Write integration tests for the order flow.
- **Exercise:** Rate limiter (Xu vol. 1). Pay attention to token bucket vs sliding window and where the limiter lives.

### Week 3
- **Read:** DDIA ch. 6 (partitioning: hash vs range, hot keys, rebalancing) + ch. 7 (transactions: isolation levels, write skew).
- **Build:** Add realistic contention: inventory decrement under concurrent orders. Reproduce a race condition, then fix it three ways — `SELECT FOR UPDATE`, optimistic locking (version column), and a serializable transaction. Benchmark all three. This is interview gold.
- **Exercise:** Pastebin / file storage. Focus on capacity estimation and blob vs metadata separation.

### Week 4
- **Read:** DDIA ch. 8–9 (distributed system failures; consistency & consensus — linearizability, quorums, why 2PC hurts). Hardest chapters in the book; take your time, skip nothing in ch. 9.
- **Build:** Polish: pagination, idempotent order creation (idempotency-key header), OpenAPI spec, seed data. Tag `v1-monolith` in git.
- **Exercise:** Design a distributed key-value store (Xu vol. 1, "design Dynamo"). Directly exercises ch. 5/6/9.
- **Checkpoint:** Can you explain replication lag anomalies, pick an isolation level for a given bug, and justify a partitioning key? Working monolith with tested, idempotent order flow?

---

## Phase 2 — Decomposition & Communication (Weeks 5–8)

**Project:** extract services from the monolith. Target topology: `gateway → orders / payments / catalog` + Kafka.

### Week 5
- **Read:** Building Microservices ch. 1–3 (what microservices are, how to model boundaries — aggregates, bounded contexts) + ch. 4 (communication styles).
- **Build:** Decide service boundaries and *write an ADR* justifying them (why payments is separate, why users+catalog stay together for now). Extract **payments** first (smallest surface): own repo/module, own DB schema, REST API. Monolith calls it over HTTP.
- **Exercise:** Notification system (Xu vol. 1) — fan-out, queues, at-least-once delivery.

### Week 6
- **Read:** Building Microservices ch. 5 (implementation of communication: sync vs async, schemas/contracts) + skim Monolith to Microservices ch. 1–3 (strangler fig, extraction patterns) — free supplement if you have it, otherwise Newman ch. 3 covers enough.
- **Build:** Extract **orders** service. Introduce gRPC between orders → payments (define protobuf contracts, contrast with REST). Shared-nothing databases — no cross-service joins; where you need catalog data in orders, call the API or cache it.
- **Exercise:** Web crawler (Xu vol. 1) — queues, politeness, dedup, distributed workers.

### Week 7
- **Read:** Building Microservices ch. 6 (workflow: sagas intro) + ch. 7–8 (build & deploy, skim).
- **Build:** Add **Kafka** (or NATS JetStream). Publish `OrderPlaced`, `PaymentCompleted` events. Notifications service consumes them (this service is event-driven only — no REST API). Implement the **transactional outbox** in orders so DB write + event publish can't diverge. This pattern alone justifies the week.
- **Exercise:** News feed / Instagram (Xu vol. 1) — push vs pull fan-out, celebrity problem, cache design.

### Week 8
- **Read:** Building Microservices ch. 11 (security, skim) + ch. 13–14 (scaling, UI — skim). Read ch. 12 (resilience) closely — it previews Phase 3.
- **Build:** Add an **API gateway** (Kong, Traefik, or hand-rolled reverse proxy): routing, auth (JWT), rate limiting at the edge. Consumer-driven contract test between orders and payments (Pact, or a simple schema test).
- **Exercise:** Chat system / WhatsApp (Xu vol. 1) — websockets, message ordering, online presence.
- **Checkpoint:** 3 services + gateway + Kafka on Docker Compose. Can you argue when *not* to extract a service, and explain the outbox pattern from memory?

---

## Phase 3 — Distributed Data & Resilience (Weeks 9–12)

**Project:** make the system correct and survivable under failure.

### Week 9
- **Read:** Microservices Patterns ch. 1–3 (escaping monolith hell, decomposition, IPC — fast read, mostly review) + ch. 4 (**sagas** — the core chapter).
- **Build:** Implement the order flow as a **choreography saga**: OrderPlaced → payment → inventory reserve → confirm; compensating actions on failure (refund, release inventory). Test the failure paths explicitly.
- **Exercise:** Payment system (Xu vol. 2) — idempotency, reconciliation, exactly-once illusion.

### Week 10
- **Read:** Microservices Patterns ch. 5–6 (domain modeling, event sourcing — understand it, you don't have to build it) + ch. 7 (queries: API composition vs **CQRS**).
- **Build:** Re-implement the same saga as an **orchestration saga** (an order-orchestrator drives steps via commands). Write a short comparison doc: debuggability, coupling, failure visibility. Keep whichever you prefer.
- **Exercise:** Ticketmaster / hotel booking (Xu vol. 2) — inventory contention; reuse your Week 3 locking knowledge.

### Week 11
- **Read:** Microservices Patterns ch. 8 (external APIs) + DDIA ch. 11 (stream processing) — ties Kafka usage to theory (log compaction, exactly-once semantics, windowing).
- **Build:** Add a **CQRS read model**: order-history service consuming events into a denormalized view (Postgres or Elasticsearch). Add **Redis** caching to catalog with explicit invalidation on update events; document your consistency trade-off.
- **Exercise:** Uber / ride matching (Xu vol. 2) — geo-indexing, matching, location updates at scale.

### Week 12
- **Read:** DDIA ch. 10 & 12 (batch processing; the future — lighter reads to finish the book).
- **Build:** **Resilience hardening:** timeouts on every call, retries with exponential backoff + jitter, circuit breaker (resilience4j-equivalent for Go: gobreaker; Node: opossum), dead-letter queue for poison messages. Then chaos-test by hand: kill payments mid-saga, kill Kafka, inject 5s latency — verify recovery and no lost/duplicated orders.
- **Exercise:** Distributed job scheduler / delayed task queue.
- **Checkpoint:** Saga survives service death with correct compensation. You can whiteboard saga vs 2PC, CQRS trade-offs, and cache invalidation strategy with examples from *your own* system. ADRs written for saga style, CQRS, caching.

---

## Phase 4 — Operations & Architect Skills (Weeks 13–16)

**Project:** productionize + turn the work into architect-level artifacts.

### Week 13
- **Read:** Release It! part I (stability antipatterns — integration points, cascading failures, slow responses) — the war stories, ch. 1–4.
- **Build:** Local **Kubernetes** (kind or k3d): Deployments, Services, ConfigMaps/Secrets, liveness/readiness probes for all services. Helm chart or Kustomize. Kafka via Strimzi or a simple StatefulSet.
- **Exercise:** Design "top-K / metrics aggregation" (Xu vol. 2).

### Week 14
- **Read:** Release It! part I remainder (stability *patterns* — timeouts, bulkheads, circuit breakers; validate your Week 12 implementations against Nygard's versions).
- **Build:** **Observability:** OpenTelemetry tracing across gateway → orders → payments → Kafka consumers (see one trace span the whole saga); Prometheus metrics + Grafana dashboard (p99 latency, error rate, consumer lag); structured JSON logs with correlation IDs.
- **Exercise:** Design a metrics/monitoring system itself (Xu vol. 2) — meta, and now you've built one.

### Week 15
- **Read:** Release It! part III/IV selections (deployment, adaptation — skim for ideas, read "capacity" closely).
- **Build:** **Load test with k6:** ramp until something breaks. Find the bottleneck via your traces/dashboards, fix it (connection pool? consumer parallelism? missing index?), re-run, document before/after numbers. Add HPA and watch it scale under load.
- **Architect practice:** first mock interview (peer or platform). Record it if possible.

### Week 16
- **Read:** Buffer week — revisit weakest DDIA chapters or unread Xu problems.
- **Build:** Final polish: README with architecture diagram (C4 style: context + container), all ADRs collected in `/docs/adr/`, a "design decisions & trade-offs" writeup. Tag `v2-microservices`.
- **Architect practice:** two more mock interviews + present the architecture to a colleague in a 15-min walkthrough and take questions.
- **Checkpoint:** Deployed on K8s, one trace spans the saga, load-test report with a fixed bottleneck, ADR portfolio, 3 mock interviews done.

---

## Design exercise template (use every week)

1. **Requirements** (5 min): functional + non-functional; ask/state assumptions
2. **Estimates** (5 min): users, QPS, storage, bandwidth — orders of magnitude
3. **API + data model** (10 min)
4. **High-level design** (10 min): boxes and arrows, data flow
5. **Deep dive** (10 min): pick the 1–2 hardest components
6. **Bottlenecks & trade-offs** (5 min): what breaks first at 10x, what you'd monitor
7. **After:** compare with Xu's solution; keep a running "gaps I missed" note — review it monthly

## Slippage rule

If a week overruns, cut the exercise before the build, and cut the build before the reading — but never skip two exercises in a row. Reading compounds; the project can flex.
