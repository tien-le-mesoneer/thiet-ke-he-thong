# system-design monorepo

A learning monorepo for the 16-week system-design study plan. Each area has its
own `CLAUDE.md` — read that one before working there.

| Path | What it is |
|---|---|
| `apps/url-shortener-node/` | Fastify URL shortener. Reference service for the observability build. |
| `apps/deliveroo-node/` | Food-delivery service, the long-arc Phase 2–3 build. Earlier along. |
| `infra/observability/` | OTel Collector + Prometheus + Tempo + Grafana. Ports on the 7xxx block. |
| `infra/broker-spike/` | **Throwaway.** Kafka vs RabbitMQ benchmark for the Week 7 broker ADR. Delete once the decision lands. |
| `docs/` | Architecture diagrams, ADRs, specs, plans, operations, roadmap, study material. Index: `docs/README.md`. |
| `.claude/skills/` | `learn-sd` (study driver) and `graphify`. |

**Study state lives in `docs/study/progress.md`** — plan week, elapsed
week, weak concepts, and a dated log. Update it when work lands; it is what
`/learn-sd` reads.

## Where docs go

| Writing a… | Put it in |
|---|---|
| decision (one choice, its alternatives, its evidence) | `docs/decisions/NNNN-slug.md` — next free number, add a row to `docs/decisions/README.md` |
| design spec | `docs/specs/YYYY-MM-DD-slug.md` |
| implementation plan | `docs/plans/YYYY-MM-DD-slug.md` |
| postmortem / game-day | `docs/operations/postmortems/YYYY-MM-DD-slug.md` |
| diagram of what exists now | `docs/architecture/` — update it in the same change that alters the system |
| something to improve later | a row in `docs/roadmap.md`, with a link to the evidence |

**This overrides the superpowers plugin's default of `docs/superpowers/specs/`
and `docs/superpowers/plans/`.** That folder no longer exists; do not recreate it.

Several decisions record measurements that **corrected an earlier conclusion** —
keep that habit: when a number changes a decision, write down both.

# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) — any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.
# learn-sd
- **learn-sd** (`.claude/skills/learn-sd/SKILL.md`) — drive the system-design study plan: weekly agenda + quiz, grounded Q&A, timed design exercises. Trigger: `/learn-sd`, `/learn-sd ask "…"`, `/learn-sd exercise`.
When the user types `/learn-sd`, invoke the Skill tool with `skill: "learn-sd"` before doing anything else.
