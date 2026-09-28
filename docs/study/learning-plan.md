# System Design & Microservices Learning Plan

**Profile:** 8 years dev experience · ~10 hrs/week · ~16 weeks
**Goals:** design better systems at work · pass system design interviews · grow toward architect
**Method:** books + one evolving real project (Go or Node) + weekly design exercises

## Weekly rhythm (10 hrs)

- 4 hrs reading + notes
- 4-5 hrs building the project
- 1-2 hrs one design exercise on paper (45 min timed, interview-style)

---

## Phase 1 — Foundations (Weeks 1–4)

**Read:** *Designing Data-Intensive Applications* (Kleppmann), Part I & II — storage, replication, partitioning, transactions, consistency. This is the single highest-leverage book; take notes per chapter.

**Build:** Start the capstone project as a **modular monolith first** — e.g. a food-delivery or e-commerce clone (orders, payments, restaurants/inventory, notifications) in Go (Gin/Chi) or Node (NestJS). Ship it with Postgres, Docker Compose, proper API design.
Why monolith first: you'll extract services later and *feel* why boundaries matter — this is exactly how it happens at work.

**Design exercises (one per week):** URL shortener · rate limiter · pastebin · key-value store. Structure every answer: requirements → capacity estimates → API → data model → high-level design → deep dive → bottlenecks.

**Milestone:** working monolith + 4 written design docs.

## Phase 2 — Decomposition & Communication (Weeks 5–8)

**Read:** *Building Microservices* (Newman, 2nd ed.) — service boundaries, decomposition, communication styles, ownership. Skim *Monolith to Microservices* (Newman) for extraction patterns (strangler fig).

**Build:** Extract 2–3 services from your monolith:

- Split orders and payments into separate services
- Sync communication: REST + gRPC between services
- Async: add Kafka (or NATS/RabbitMQ) — order events, outbox pattern
- API gateway in front; service discovery

**Design exercises:** notification system · web crawler · Instagram feed · chat system (WhatsApp).

**Milestone:** 3 services + gateway + event bus running locally; you can articulate when NOT to split.

## Phase 3 — Distributed Data & Resilience (Weeks 9–12)

**Read:** DDIA Part III (derived data, stream processing) + *Microservices Patterns* (Richardson) — saga, CQRS, event sourcing, transactional outbox.

**Build:** Make it survive failure:

- Saga for order flow (choreography or orchestration — try both, compare)
- Idempotency keys, retries with backoff, circuit breakers, timeouts
- Redis caching layer + cache invalidation strategy
- Kill services mid-flow and verify recovery (poor-man's chaos testing)

**Design exercises:** payment system · ticketmaster (inventory contention) · Uber matching · distributed job scheduler.

**Milestone:** demonstrable failure recovery; a written ADR for each major decision.

## Phase 4 — Operations & Architect Skills (Weeks 13–16)

**Read:** *Release It!, 2nd ed.* (Nygard) — stability patterns (circuit breaker, bulkhead, timeout), capacity, production war stories. Pairs perfectly with the productionizing work below.

**Build:** Productionize:

- Deploy to local Kubernetes (kind/k3d): deployments, HPA, probes
- Observability: OpenTelemetry tracing + Prometheus/Grafana + structured logs
- CI pipeline, per-service versioning
- Load test (k6), find the bottleneck, fix it, measure again

**Architect practice:**

- Write ADRs for the whole project (context, options, trade-offs, decision)
- Do 2–3 mock interviews (peer, or Hello Interview / interviewing.io)
- Present your architecture to someone — a diagram + 15-min walkthrough; teaching exposes gaps

**Milestone:** deployed, observable system + ADR portfolio + mock interview feedback.

---

## Books (priority order)

1. **Designing Data-Intensive Applications** — Kleppmann *(Phases 1 & 3: the foundation)*
2. **Building Microservices, 2nd ed.** — Newman *(Phase 2: decomposition & boundaries)*
3. **Microservices Patterns** — Richardson *(Phase 3: sagas, CQRS, outbox)*
4. **Release It!, 2nd ed.** — Nygard *(Phase 4: production resilience)*
5. **System Design Interview Vol 1 & 2** — Xu *(exercise bank throughout, not cover-to-cover — pull one problem per week and attempt it before reading his solution)*

## Ongoing habits

- **At work:** volunteer for design reviews; write an ADR for your next non-trivial decision; map one existing mesoneer system's architecture and critique it
- **Case studies (30 min/week):** engineering blogs — Netflix, Uber, Shopify, Stripe; note the *trade-offs*, not the tech list
- **Newsletter:** ByteByteGo or The Pragmatic Engineer for steady exposure

## How you'll know it's working

- Week 4: you can design a mid-size system on paper in 45 min with clear trade-offs
- Week 8: you can defend a service boundary decision against pushback
- Week 12: you can explain saga vs 2PC, and when eventual consistency is acceptable, with examples from your own project
- Week 16: your project is a portfolio piece and you're passing mock interviews
