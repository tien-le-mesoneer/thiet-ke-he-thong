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
docs/                              # shared, language-agnostic
  system-design-learning-plan.md   #   the syllabus (overview)
  system-design-plan-detailed.md   #   week-by-week detail
  system-design-acceptance.md      #   concept-level definition-of-done
  system-design-progress.md        #   your progress (created by /learn-sd)
  exercises/                       #   timed design-exercise write-ups
.claude/skills/learn-sd/           # the study skill (drives the plan)
apps/
  deliveroo-node/                  # current implementation (TS + Fastify + Postgres)
    acceptance.node.md             #   maps shared concepts → concrete Node checks
  deliveroo-go/                    # future
  deliveroo-java/                  # future
packages/                          # (later) shared contracts: openapi, *.proto, seed data
```

## Working on an implementation

```sh
cd apps/deliveroo-node
# see that app's README for setup (podman compose, migrate, dev)
```

## Studying

Use the `learn-sd` skill: `/learn-sd` (this week), `/learn-sd ask "…"`,
`/learn-sd exercise`. It tracks which language you're building (`active_impl` in
`docs/system-design-progress.md`) and checks your code against
`apps/<impl>/acceptance.<lang>.md`.
