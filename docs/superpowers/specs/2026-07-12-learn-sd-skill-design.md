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

```
.claude/skills/learn-sd/SKILL.md      # the skill: 3 modes, notebook id, auth check, slippage logic
docs/system-design-progress.md        # progress state (new, committed)
docs/exercises/<planweek>-<topic>.md  # exercise attempts + gap analysis (milestone deliverable)
```

Reused, not rebuilt:
- `docs/system-design-learning-plan.md`, `docs/system-design-plan-detailed.md` — the syllabus.
- The repo's own TODOs and `⚠️` markers (e.g. the race-condition comment in
  `src/modules/orders/service.ts`) — the build cross-reference targets.
- The installed `notebooklm` skill/CLI — the grounded-knowledge backend.

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
started: 2026-07-12
exercises_done: [url-shortener, rate-limiter]
weak_concepts: [write-skew, replication-lag]
---
## Log
- 2026-07-12 Week 3 — reproduced race condition; SELECT FOR UPDATE fix done, benchmarking pending.
```

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
4. **Build:** cross-reference the actual repo (relevant module files, TODOs,
   `⚠️` markers) and sanity-check the user's code against the week's concept.
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

## Data flow

```
progress.md ──► skill reads state ──► plan docs (week block)
                     │
                     ├─ this-week ─► notebooklm ask (quiz) ─► update weak_concepts + log
                     │              └► repo files (build check)
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
3. **`this-week` behind:** `elapsed_week > plan_week` → slippage rule kicks in, build offered for deferral, exercise protected.
4. **`ask`:** produces a grounded answer with a repo tie-in; offers note-save.
5. **`exercise`:** times an attempt, writes a committed gap-analysis doc, updates `weak_concepts` + `exercises_done`.
6. **Auth failure path:** stale cookies → skill stops and instructs re-login.

## Open questions

None blocking. The notebook's exact contents (which books/sources are loaded)
will shape quiz quality but not the skill's structure.
