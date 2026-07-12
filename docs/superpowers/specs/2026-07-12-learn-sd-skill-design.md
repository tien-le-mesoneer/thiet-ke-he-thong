# `learn-sd` — System-Design Study Skill (Design Spec)

**Date:** 2026-07-12
**Status:** Approved design, pending implementation plan
**Repo:** `deliveroo-lite` (the practice project this skill drives)

## Purpose

A single user-invocable skill, `/learn-sd`, that runs the 16-week system-design
study plan in `docs/system-design-learning-plan.md` +
`docs/system-design-plan-detailed.md`. It combines three jobs behind one skill:

1. **Weekly driver** — orients you to the current week, quizzes the reading,
   checks your build against the concepts.
2. **Grounded tutor** — answers system-design questions grounded in the user's
   NotebookLM notebook (the books), tied back to code in this repo.
3. **Design-exercise coach** — runs the timed 45-min interview exercises, grades
   the cold attempt against the notebook, saves attempt + gap analysis as a
   committed doc.

It is **pacing-aware**: it tracks plan-week vs elapsed-week and enforces the
plan's slippage rule when the user falls behind, because the plan's content is
sound but its 16-week timeline is optimistic (~22–26 real weeks at 10 hrs/week).

## Non-goals (YAGNI)

- Auto-generating podcasts / videos / infographics — use `/notebooklm` directly.
- Re-implementing NotebookLM functionality — the skill shells out to the
  installed `notebooklm` CLI.
- Rewriting the plan docs — they remain the unchanged syllabus. Reality lives in
  the progress file, not in edits to the plan.
- Any multi-week planning UI or calendar integration.

## Architecture

A repo-local skill at `.claude/skills/learn-sd/SKILL.md` with three argument-
selected sub-modes. State lives in one committed progress file. The notebook ID
is hardcoded and every `notebooklm` call passes it explicitly (`--notebook` /
`-n`) rather than relying on `notebooklm use`, so the skill is stateless and
parallel-safe.

The repo is a **polyglot monorepo**: shared, language-agnostic learning materials
at the root; the practice project implemented once per language under `apps/`.
This lets the same skill and curriculum drive a Node build now and a Go or Java
build later.

```
.claude/skills/learn-sd/SKILL.md          # the skill: 3 modes, notebook id, auth check, slippage logic
docs/system-design-progress.md            # progress state incl. active_impl (new, committed)
docs/system-design-acceptance.md          # CONCEPT-level definition-of-done, stable IDs (committed)
docs/exercises/<planweek>-<topic>.md      # exercise attempts + gap analysis (milestone deliverable)
apps/<impl>/acceptance.<lang>.md          # per-impl manifest: concept ID → concrete check
apps/deliveroo-node/                       # current TS implementation
```

Reused, not rebuilt:
- `docs/system-design-learning-plan.md`, `docs/system-design-plan-detailed.md` — the syllabus.
- `docs/system-design-acceptance.md` + `apps/<impl>/acceptance.<lang>.md` — the
  machine-checkable acceptance criteria (Component 3): concepts shared, concrete
  checks per language. The build check reads them instead of guessing.
- The implementation's own TODOs / `⚠️` markers (e.g. the race-condition comment
  in `apps/deliveroo-node/src/modules/orders/service.ts`) — targets the manifest points at.
- The installed `notebooklm` skill/CLI — the grounded-knowledge backend.
- The CodeGraph MCP server (`codegraph_*` tools) — the structural verifier for
  build checks; parses Go/Java/TS so it works for every implementation.

### Constants baked into the skill

- `NOTEBOOK_ID = 173bf885-0641-4c53-b965-f2e910b68768`
- Every notebook call uses the explicit id, e.g.
  `notebooklm ask "..." --notebook 173bf885-… --json`.

## Component 1 — Progress state

**File:** `docs/system-design-progress.md`, committed, read at the start of every
invocation and rewritten as progress is made.

```markdown
---
plan_week: 3          # where the syllabus says you are
elapsed_week: 4       # real weeks since you started (slippage = elapsed - plan)
phase: 1
active_impl: node     # which apps/<impl> you're currently building (node | go | java)
started: 2026-07-12
exercises_done: [url-shortener, rate-limiter]
weak_concepts: [write-skew, replication-lag]
---
## Log
- 2026-07-12 Week 3 — reproduced race condition; SELECT FOR UPDATE fix done, benchmarking pending.
```

- `active_impl` selects which `apps/<impl>/acceptance.<lang>.md` manifest the
  build check uses. Switching languages to re-run the curriculum = change this
  field; progress/weak_concepts/exercises are language-agnostic and carry over.

- `plan_week` advances only when the week's work is genuinely done.
- `elapsed_week` advances with wall-clock time.
- **Slippage = `elapsed_week - plan_week`.** Surfaced as a plain number, framed
  neutrally ("2 weeks behind syllabus pace — normal for this plan").
- `weak_concepts` is the feedback loop: the tutor and quizzes weight toward
  concepts the user has previously missed. Exercise gap-analysis appends to it;
  successfully re-quizzed concepts get removed.

## Component 2 — Sub-modes

Startup (all modes): verify auth once with
`notebooklm auth check --test --json`; require `status: ok` AND
`checks.token_fetch: true`. If stale, tell the user to run `notebooklm login`
and stop. Then read the progress file.

### `/learn-sd` or `/learn-sd this-week` (default)

1. Read progress → `plan_week`; read the matching week block from the detailed
   plan doc for its Read / Build / Exercise items.
2. Compute slippage. **If behind (`elapsed_week > plan_week`), apply the slippage
   rule:** present a trimmed agenda — protect reading + exercise, offer to defer
   or stub the build — quoting the rule from the plan. If on pace, present the
   full agenda.
3. **Read:** offer a short quiz via `notebooklm ask` grounded in the notebook,
   weighted toward `weak_concepts`. Score verbally; update `weak_concepts`.
4. **Build:** read this week's concepts in `docs/system-design-acceptance.md`,
   load the manifest for `active_impl` (`apps/<impl>/acceptance.<lang>.md`), and
   **run each concept's concrete check with the tool it names** (Component 3) —
   not a vibes-based read. Present the green/red list. Never mark a `codegraph`/
   `test`/`file`/`git` concept green without the tool confirming it.
5. Append a dated line to the log; bump `plan_week` only when the user confirms
   the week is complete.

### `/learn-sd ask "<question>"`

1. `notebooklm ask "<question>" --notebook <id> --json` → grounded answer +
   source references.
2. Relay the answer, then **tie it back to this repo** — name the file/flow where
   the concept bites (e.g. isolation levels → `orders/service.ts`).
3. Offer (not automatic) to `--save-as-note` if it's a keeper.
4. If the question exposes a weak spot, offer to add it to `weak_concepts`.

### `/learn-sd exercise`

1. Pick the current `plan_week`'s exercise from the plan (URL shortener, rate
   limiter, …). Confirm the topic with the user.
2. Run a **45-min timed cold attempt**: the user writes their design (in chat or
   a scratch file). The skill does **not** help or hint during the attempt — it
   only times and collects.
3. **Grade:** query the notebook for the canonical approach; produce a gap
   analysis structured by the plan's template (requirements → estimates → API →
   data model → high-level design → deep dive → bottlenecks & trade-offs).
4. Write attempt + gap analysis to `docs/exercises/<plan_week>-<topic>.md` and
   commit it (this is the "4 written design docs" milestone deliverable).
5. Add missed items to `weak_concepts`; add the topic to `exercises_done`.

## Component 3 — Acceptance criteria & build verification

**Files:** `docs/system-design-acceptance.md` (shared, concept-level) +
`apps/<impl>/acceptance.<lang>.md` (per-implementation manifest), both committed.
The shared doc lists **concepts** with stable IDs (`W3.pessimistic`) — the
machine-checkable "definition of done" that keeps coding aligned with the
syllabus. Each manifest maps those IDs to a **concrete check for one language**
(grep pattern / codegraph symbol / test command). This indirection is what makes
the skill reusable across Node/Go/Java: switch `active_impl`, same concepts, new
manifest. The build step reads the shared concepts + the active manifest and runs
each check with its tagged tool.

Check types and their verifier:

| Tag | Verified by |
|-----|-------------|
| `codegraph` | `codegraph_search` / `codegraph_callers` / `codegraph_impact` — does the symbol/edge exist |
| `grep` | ripgrep — literal SQL fragments, headers, markers |
| `test` / `typecheck` | `npm test` / `npm run typecheck` — does it actually work / compile |
| `file` | path exists — an artifact was produced |
| `git` | `git tag` / `git log` — milestone tags |
| `self` | the user answers honestly — whiteboard recall; asked, never a gate |

Rules the skill follows:
- A `codegraph`/`test`/`file`/`git` box goes green **only** when its tool confirms
  it — no marking-by-assertion.
- `self` items are checkpoints, surfaced but never blocking.
- `plan_week` advances only when the week's non-`self` boxes are green **or** the
  user explicitly overrides (e.g. under the slippage rule).
- Open build boxes carry forward to later weeks; they are never silently dropped.

Phase 1 (weeks 1–4) concepts are fully specified in the shared doc and mapped to
concrete Node checks in `apps/deliveroo-node/acceptance.node.md`. Phases 2–4 hold
anchor concepts to be expanded on arrival, since that infra isn't built yet.
Changing a week's definition of done means editing these files, not the skill; a
new language means adding one manifest, not touching the skill.

## Data flow

```
progress.md ──► skill reads state ──► plan docs (week block)
                     │
                     ├─ this-week ─► notebooklm ask (quiz) ─► update weak_concepts + log
                     │              └► acceptance.md checks ─► codegraph / grep / npm test / git
                     │                 (green/red list; gates plan_week bump)
                     ├─ ask ───────► notebooklm ask --json ─► answer + repo tie-in
                     └─ exercise ──► timed attempt ─► notebooklm (canonical) ─► gap doc + commit
                     │
                     ▼
              skill rewrites progress.md
```

## Error / edge handling

- **Auth stale/missing** → stop early, instruct `notebooklm login`. Never silently proceed.
- **Notebook empty or call fails** → report the CLI error verbatim; don't fabricate a grounded answer. Fall back to answering from general knowledge only if the user explicitly opts in, clearly labeled as ungrounded.
- **No progress file yet** → first run bootstraps it (`plan_week: 1`, `elapsed_week: 1`, `started: <today>`).
- **Ambiguous week / user disagrees with tracked week** → trust the user; update the file.
- **Destructive `notebooklm` calls** (delete/save-as-note) → ask before running, per the notebooklm skill's autonomy rules.

## Testing / verification

This is a prose skill (Markdown instructions), not executable code, so
"testing" means dry-run walkthroughs:

1. **Fresh start:** no progress file → skill bootstraps it correctly.
2. **`this-week` on pace:** presents full week agenda from the plan doc.
3. **`this-week` build check:** runs the week's acceptance criteria with real tools and reports a green/red list; a box only greens when its tool confirms it (e.g. Week 2 "transitions enforced" stays red until `placeOrder` routes through `canTransition`).
4. **`this-week` behind:** `elapsed_week > plan_week` → slippage rule kicks in, build offered for deferral, exercise + `self` reflection protected.
5. **`ask`:** produces a grounded answer with a repo tie-in; offers note-save.
6. **`exercise`:** times an attempt, writes a committed gap-analysis doc, updates `weak_concepts` + `exercises_done`.
7. **Auth failure path:** stale cookies → skill stops and instructs re-login.

## Open questions

None blocking. The notebook's exact contents (which books/sources are loaded)
will shape quiz quality but not the skill's structure.
