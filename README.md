# system-design

A polyglot monorepo for the 16-week system-design study plan. The **learning
materials** (syllabus, acceptance criteria, progress, design exercises) are
language-agnostic and shared; the **practice project** — a modular-monolith
food-delivery clone ("deliveroo-lite") — is implemented once per language under
`apps/`, so the same curriculum can be re-run in Node, Go, or Java.

No Turborepo/Nx: each app uses its native toolchain (npm, `go`, Gradle/Maven).
Plain directories + git.

## Layout

```
docs/                              # index: docs/README.md
  architecture/                    #   diagrams of the system as it is today
  decisions/                       #   ADRs, one decision per file
  specs/  plans/                   #   design docs and their implementation plans
  operations/                      #   SLOs, runbook, postmortems
  roadmap.md                       #   what to improve next, with evidence
  study/                           #   syllabus, acceptance, progress, notes, exercises
.claude/skills/learn-sd/           # the study skill (drives the plan)
apps/
  url-shortener-node/              # Fastify + Mongo + Redis; the observability reference
  deliveroo-node/                  # modular monolith (TS + Fastify + Postgres)
    acceptance.node.md             #   maps shared concepts → concrete Node checks
infra/
  observability/                   # OTel Collector + Prometheus + Tempo + Grafana
  broker-spike/                    # throwaway Kafka vs RabbitMQ benchmark
```

## Working on an implementation

```sh
cd apps/deliveroo-node
# see that app's README for setup (podman compose, migrate, dev)
```

## Studying

Use the `learn-sd` skill: `/learn-sd` (this week), `/learn-sd ask "…"`,
`/learn-sd exercise`. It tracks which language you're building (`active_impl` in
`docs/study/progress.md`) and checks your code against
`apps/<impl>/acceptance.<lang>.md`.
