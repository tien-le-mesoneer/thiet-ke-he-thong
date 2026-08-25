# system-design monorepo

A learning monorepo for the 16-week system-design study plan. Each area has its
own `CLAUDE.md` — read that one before working there.

| Path | What it is |
|---|---|
| `apps/url-shortener-node/` | Fastify URL shortener. Reference service for the observability build. |
| `apps/deliveroo-node/` | Food-delivery service, the long-arc Phase 2–3 build. Earlier along. |
| `infra/observability/` | OTel Collector + Prometheus + Tempo + Grafana. Ports on the 7xxx block. |
| `docs/` | Study plan, progress log, acceptance criteria, design specs, notes. |
| `.claude/skills/` | `learn-sd` (study driver) and `graphify`. |

**Study state lives in `docs/system-design-progress.md`** — plan week, elapsed
week, weak concepts, and a dated log. Update it when work lands; it is what
`/learn-sd` reads.

Design decisions and their evidence live in `docs/superpowers/specs/`. Several
entries there record measurements that **corrected an earlier conclusion** —
keep that habit: when a number changes a decision, write down both.

# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) — any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.
# learn-sd
- **learn-sd** (`.claude/skills/learn-sd/SKILL.md`) — drive the system-design study plan: weekly agenda + quiz, grounded Q&A, timed design exercises. Trigger: `/learn-sd`, `/learn-sd ask "…"`, `/learn-sd exercise`.
When the user types `/learn-sd`, invoke the Skill tool with `skill: "learn-sd"` before doing anything else.
