# IN PROGRESS — system-design monorepo

Status snapshot as of 2026-07-17. Branch `main`, pushed to
`github.com/tien-le-mesoneer/thiet-ke-he-thong`.

## TL;DR

A polyglot learning monorepo for the 16-week system-design study plan. Two things
are **done and shipped** (the study skill + the URL-shortener service); one thing
is **designed and awaiting build** (application-wide OpenTelemetry observability).

---

## ✅ Done

### 1. `learn-sd` study skill — DONE, merged
Project-local skill at `.claude/skills/learn-sd/` driving the study plan.
- Modes: `/learn-sd` (weekly agenda + reading quiz), `/learn-sd ask "…"` (grounded Q&A from the NotebookLM notebook), `/learn-sd exercise` (timed design exercise + graded gap analysis).
- Progress tracked in `docs/system-design-progress.md`; build checks verified against `docs/system-design-acceptance.md` + per-impl manifests.
- Used it for real: Week-1 reading (reliability tutoring) + the URL-shortener design exercise (`docs/exercises/1-url-shortener.md`, graded ~B).

### 2. Polyglot monorepo restructure — DONE
- App moved to `apps/deliveroo-node/`; shared `docs/` at root; `apps/<impl>/acceptance.<lang>.md` manifests. Ready for future Go/Java impls.
- No Turborepo/Nx (plain dirs); `.tool-versions` pins node; CodeGraph MCP + a `codegraph sync` PostToolUse hook.

### 3. `url-shortener-node` service — DONE, merged & pushed
`apps/url-shortener-node/` — MongoDB + Redis, Fastify/TS. Built via subagent-driven
TDD (10 tasks + 4 fixes), whole-branch reviewed.
- Ranged-counter + sqids/base62 keys (short, collision-free, non-guessable).
- Cache-aside 302 redirects (degrades gracefully if Redis down), async click flush, native Mongo TTL expiry.
- Observability: pino JSON + correlation id, `/health`, prom-client `/metrics`, OTel tracing via preload.
- Tests **23/23** (unit / integration / 200-way concurrency); k6 load **p99 = 18.06 ms**.
- Docs: `apps/url-shortener-node/document.md` (Confluence-ready) + README.

### 4. GitHub — DONE
Whole monorepo pushed to `main` over SSH (gh token was invalid + corporate TLS
proxy blocks HTTPS — SSH sidesteps both).

---

## 🔶 In progress — Application-wide OpenTelemetry observability

**Design APPROVED, spec committed, implementation NOT started.**
Spec: `docs/superpowers/specs/2026-07-17-observability-otel-design.md` (commit `bb428d7`).

What it will build:
- `packages/observability-node` — shared OTel bootstrap (auto-instrumentation → traces + RED metrics + pg/mongo/redis client spans + pino `trace_id` correlation), preloaded via `node --import`. Introduces npm **workspaces** at repo root.
- Wire **both** apps (deliveroo gets observability for the first time; url-shortener **migrates prom-client `/metrics` → OTLP**).
- `infra/observability/` — one OTel Collector (also scrapes the 3 DBs natively) → Prometheus + Tempo → provisioned Grafana with **RED + USE** dashboards + exemplars.
- **One SLO + multi-window burn-rate alert + a game-day** (kill Redis, watch it surface).
- Right-sized: no Loki, no Alertmanager paging, no dashboard fleet (each skip documented with a trigger point).

### ⚠️ Two open decisions blocking the plan
1. **url-shortener migration** — move it off prom-client `/metrics` to OTLP (consistent OTel-first, but churns just-built code + its `document.md`/k6 refs), **or** let url-shortener keep its Prometheus `/metrics` and only new services go pure-OTLP. *(Spec currently assumes migrate.)*
2. **SLI/SLO** — default is **redirect availability (non-5xx ≥ 99.9%)**; alternative is **p99 latency < 50 ms**. *(Spec currently assumes availability.)*

---

## ▶️ What to do next

**Immediate (to resume the observability build):**
1. Answer the two open decisions above (migration yes/no; SLI availability vs latency).
2. `writing-plans` → implementation plan for the observability spec (will sequence in phases: instrumentation → backend stack → SLO/game-day).
3. Build it subagent-driven (same flow as url-shortener); note it needs the observability stack containers running (Collector/Prometheus/Tempo/Grafana) and hits the sandbox for DB/podman (approve `dangerouslyDisableSandbox`).

**Study-plan track (independent of the above):**
- Finish Week-1 reading: **scalability** (percentiles/tail latency) + **maintainability** + **DDIA ch. 2 data models**. Then `/learn-sd` to advance `plan_week`.
- Week-2 build gap in deliveroo: `W2.enforced` is RED — `placeOrder` sets order statuses directly instead of going through `canTransition` (see `apps/deliveroo-node/src/modules/orders/service.ts`), and there's no `test/` dir yet (`W2.tests-exist` RED).

**Housekeeping (optional):**
- Fix `gh auth login` + the corporate CA bundle (`SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE`) so HTTPS git/gh work; SSH already works.
- `.DS_Store` is untracked in root — consider adding to `.gitignore`.
- Decide repo visibility (currently public; contains study notes + the NotebookLM notebook id).

---

## Key file map

| Path | What |
|---|---|
| `docs/system-design-plan-detailed.md` | the week-by-week syllabus |
| `docs/system-design-acceptance.md` | concept-level definition-of-done |
| `docs/system-design-progress.md` | your live study progress (git-ignored? no — committed) |
| `docs/exercises/1-url-shortener.md` | graded design-exercise attempt |
| `docs/superpowers/specs/` | 3 design specs (learn-sd, url-shortener, observability) |
| `docs/superpowers/plans/` | 2 impl plans (learn-sd, url-shortener) — observability plan TBD |
| `apps/deliveroo-node/` | Phase-1 modular monolith (Postgres) |
| `apps/url-shortener-node/` | standalone service (Mongo+Redis) + `document.md` |
| `.claude/skills/learn-sd/` | the study skill |
