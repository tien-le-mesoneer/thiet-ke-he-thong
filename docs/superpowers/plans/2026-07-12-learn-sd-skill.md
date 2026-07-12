# learn-sd Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the project-local `/learn-sd` skill that drives the 16-week system-design study plan — weekly agenda + reading quiz, grounded Q&A from the NotebookLM notebook, and timed design-exercise coaching — with progress tracked in-repo and build checks verified by real tools.

**Architecture:** A single `SKILL.md` router (frontmatter, startup, mode dispatch, slippage rule, progress schema) plus three focused reference files, one per sub-mode (`this-week`, `ask`, `exercise`). State lives in `docs/system-design-progress.md`. The skill shells out to the installed `notebooklm` CLI (always with the explicit notebook id) and verifies build criteria via CodeGraph/grep/test/git against the active implementation's acceptance manifest.

**Tech Stack:** Markdown skill (Claude Code project skill), `notebooklm` CLI, CodeGraph MCP (`codegraph_*`), ripgrep, git. The practice app it inspects is `apps/deliveroo-node` (Node/TS + Fastify + Postgres).

## Global Constants

Copy these verbatim wherever the skill references them:

- `NOTEBOOK_ID = 173bf885-0641-4c53-b965-f2e910b68768` — every `notebooklm` call passes `--notebook 173bf885-0641-4c53-b965-f2e910b68768` (or `-n` for `wait`/`download`), never `notebooklm use`.
- `PROGRESS_FILE = docs/system-design-progress.md`
- `PLAN_DETAIL = docs/system-design-plan-detailed.md` (week-by-week syllabus)
- `ACCEPTANCE = docs/system-design-acceptance.md` (concept-level checks with stable IDs)
- `MANIFEST = apps/<active_impl>/acceptance.<lang>.md` (concept ID → concrete check)
- Skill location: `.claude/skills/learn-sd/` — **project-only**, never global.
- Auth gate (all modes): `notebooklm auth check --test --json` must return `status: ok` AND `checks.token_fetch: true`; otherwise stop and instruct `notebooklm login`.
- Destructive/writing `notebooklm` calls (`--save-as-note`, `delete`) require asking the user first.

---

## File Structure

```
.claude/skills/learn-sd/
  SKILL.md                 # frontmatter, startup (auth + progress), mode router, slippage rule, progress schema
  references/
    this-week.md           # weekly agenda + reading quiz + acceptance build-check runner
    ask.md                 # grounded notebooklm Q&A + repo tie-in
    exercise.md            # timed design-exercise coach + gap-analysis writer
```

`SKILL.md` stays small (a router); each mode's procedure is a focused reference file loaded on demand. The build-check runner lives in `this-week.md` (its only consumer).

---

## Task 1: Skill scaffold — frontmatter, startup, router, progress schema

**Files:**
- Create: `.claude/skills/learn-sd/SKILL.md`

**Interfaces:**
- Produces: the `/learn-sd` trigger; a startup contract (auth-gate → read/bootstrap `PROGRESS_FILE` → dispatch) that every reference file assumes has already run; the progress-file schema (`plan_week`, `elapsed_week`, `phase`, `active_impl`, `started`, `exercises_done`, `weak_concepts`, `## Log`).

- [ ] **Step 1: Define the dry-run scenario (the "test")**

Scenario A (fresh start): user invokes `/learn-sd` with no `docs/system-design-progress.md` present. Expected: skill (1) runs the auth check, (2) bootstraps the progress file with `plan_week: 1`, `elapsed_week: 1`, `phase: 1`, `active_impl: node`, `started: 2026-07-12`, empty `exercises_done`/`weak_concepts`, empty `## Log`, then (3) dispatches to `this-week`.
Scenario B (routing): `/learn-sd ask "x"` → `references/ask.md`; `/learn-sd exercise` → `references/exercise.md`; `/learn-sd` or `/learn-sd this-week` → `references/this-week.md`.

- [ ] **Step 2: Confirm the behavior is absent**

Run: `ls .claude/skills/learn-sd/SKILL.md`
Expected: `No such file or directory` — the skill doesn't exist yet.

- [ ] **Step 3: Write `SKILL.md`**

Create `.claude/skills/learn-sd/SKILL.md` with exactly this content:

````markdown
---
name: learn-sd
description: Drive the 16-week system-design study plan in this repo — weekly agenda with a reading quiz, grounded Q&A from the NotebookLM notebook, and timed design-exercise coaching with graded feedback. Use on /learn-sd or intent like "what should I study this week", "quiz me on DDIA", "grade my system design attempt".
---

# learn-sd — system-design study driver

Runs the study plan in `docs/system-design-learning-plan.md` +
`docs/system-design-plan-detailed.md`. Three sub-modes; pick by argument.

## Constants

- NOTEBOOK_ID: `173bf885-0641-4c53-b965-f2e910b68768` — pass `--notebook 173bf885-0641-4c53-b965-f2e910b68768` on every `notebooklm` call. Never `notebooklm use`.
- Progress: `docs/system-design-progress.md`
- Syllabus: `docs/system-design-plan-detailed.md`
- Acceptance (concepts): `docs/system-design-acceptance.md`
- Manifest: `apps/<active_impl>/acceptance.<lang>.md`

## Startup — run on EVERY invocation before anything else

1. **Auth gate.** Run `notebooklm auth check --test --json`. Require `status: "ok"` AND `checks.token_fetch: true`. If either fails, tell the user to run `notebooklm login` and STOP — do not proceed.
2. **Read progress.** Read `docs/system-design-progress.md`. If it does not exist, bootstrap it (see Progress schema) with `plan_week: 1`, `elapsed_week: 1`, `phase: 1`, `active_impl: node`, `started: <today's date>`, empty lists, empty log. Announce that you created it.
3. **Dispatch** on the argument:
   - none or `this-week` → follow `references/this-week.md`
   - `ask "<question>"` → follow `references/ask.md`
   - `exercise` → follow `references/exercise.md`
   Unknown argument → list the three modes and ask.

## Progress schema

`docs/system-design-progress.md`:

```markdown
---
plan_week: 1          # where the syllabus says you are
elapsed_week: 1       # real weeks since you started; slippage = elapsed - plan
phase: 1
active_impl: node     # which apps/<impl> you're building (node | go | java)
started: 2026-07-12
exercises_done: []
weak_concepts: []
---
## Log
```

- `plan_week` advances only when a week's non-`self` acceptance concepts are green (or the user overrides).
- `elapsed_week` tracks wall-clock; you may ask the user to confirm/bump it.
- `weak_concepts` weights quizzes and tutoring; append missed concepts, remove ones re-passed.
- `active_impl` selects the acceptance manifest; progress carries over when it changes.

## Slippage rule (applies in `this-week`)

Slippage = `elapsed_week - plan_week`. When positive, protect reading + the exercise + `self` reflection; offer to defer/stub the **build** first. From the plan: "cut the exercise before the build, and cut the build before the reading — but never skip two exercises in a row." Frame slippage neutrally ("2 weeks behind syllabus pace — normal for this plan").

## Autonomy

Run freely: `notebooklm auth check`, `ask` (without `--save-as-note`), `status`, `list`, and all read-only `codegraph_*`/grep/test checks. Ask first before: `notebooklm ask … --save-as-note`, any `notebooklm delete`, and committing files.
````

- [ ] **Step 4: Verify frontmatter parses and scenarios trace correctly**

Run: `head -4 .claude/skills/learn-sd/SKILL.md`
Expected: valid frontmatter with `name: learn-sd` and a `description:` line.
Then trace Scenario A and B from Step 1 against the written startup/dispatch text and confirm each routes as specified. (The live auth call and file bootstrap execute at real invocation time; here confirm the instructions are unambiguous and the progress schema matches the spec.)

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/learn-sd/SKILL.md
git commit -m "feat(learn-sd): scaffold skill router, startup gate, progress schema"
```

---

## Task 2: `this-week` mode — agenda, reading quiz, acceptance build-check runner

**Files:**
- Create: `.claude/skills/learn-sd/references/this-week.md`

**Interfaces:**
- Consumes: startup contract from Task 1 (auth passed, progress read). Reads `plan_week`, `elapsed_week`, `active_impl`, `weak_concepts` from progress.
- Produces: the acceptance-check runner (concept-type → tool mapping) reused conceptually by no other file; updates to `weak_concepts`, the `## Log`, and `plan_week`.

- [ ] **Step 1: Define the dry-run scenario (the "test")**

Scenario (real, checkable): `active_impl: node`, `plan_week: 2`. The build check for Week 2 must:
- load Week 2 concepts from `docs/system-design-acceptance.md` (`W2.state-machine`, `W2.enforced`, `W2.tests-exist`, `W2.flow`, `W2.recall`),
- load `apps/deliveroo-node/acceptance.node.md`,
- run each concrete check and produce a green/red list where **`W2.state-machine` is GREEN** (`canTransition`/`TRANSITIONS` exist in `apps/deliveroo-node/src/modules/orders/service.ts`) and **`W2.enforced` is RED** (`placeOrder` sets statuses directly), **`W2.tests-exist` RED** (no `test/` dir), and `W2.recall` is asked, not gated.

- [ ] **Step 2: Confirm the behavior is absent**

Run: `ls .claude/skills/learn-sd/references/this-week.md`
Expected: `No such file or directory`.

- [ ] **Step 3: Write `references/this-week.md`**

Create the file with exactly this content:

````markdown
# learn-sd · this-week

Assumes startup already passed auth and read progress.

## 1. Orient

Read `plan_week`, `elapsed_week`, `active_impl`, `weak_concepts` from `docs/system-design-progress.md`. Compute `slippage = elapsed_week - plan_week`. Read the `plan_week` block (Read / Build / Exercise) from `docs/system-design-plan-detailed.md`.

## 2. Present the agenda

- If `slippage <= 0`: present the full Read / Build / Exercise agenda for the week.
- If `slippage > 0`: apply the slippage rule. Present reading + exercise as protected; list the build as "deferrable" and offer to carry its open concepts forward. Show the slippage count neutrally.

## 3. Reading quiz (offer, don't force)

Ask if the user wants a short quiz on this week's reading. If yes:
`notebooklm ask "Ask me 3 short quiz questions on: <this week's reading topics>. Weight toward these weak areas if relevant: <weak_concepts>. One at a time; wait for my answer before the next." --notebook 173bf885-0641-4c53-b965-f2e910b68768`
Score verbally. Update `weak_concepts`: append clearly-missed topics, remove ones answered well.

## 4. Build check (the alignment gate)

1. From `docs/system-design-acceptance.md`, take this week's concept IDs.
2. Load `apps/<active_impl>/acceptance.<lang>.md` (for `node`: `apps/deliveroo-node/acceptance.node.md`).
3. For each concept, run the concrete check by its type and mark GREEN only if the tool confirms it:
   - `codegraph` → `codegraph_search` / `codegraph_callers` / `codegraph_impact` for the named symbol/edge.
   - `grep` → ripgrep the pattern under `apps/<active_impl>/`.
   - `test` → run the manifest's test command, e.g. `cd apps/deliveroo-node && npm test`.
   - `build` → e.g. `cd apps/deliveroo-node && npm run typecheck`.
   - `file` → check the path exists.
   - `git` → `git tag --list` / `git log`.
   - `self` → ask the user the recall question; record the answer but NEVER gate on it.
4. Present a green/red list, one line per concept, each showing what was checked. Name the specific file/symbol for reds so the user knows where to work.

## 5. Record

Append a dated line to the `## Log` summarizing what was covered and which concepts are still red. Offer to bump `plan_week` ONLY if every non-`self` concept for the week is green — or the user explicitly overrides (e.g. deferring the build under slippage). Open reds carry forward; never silently drop them. Offer to bump `elapsed_week` if a real week has passed.
````

- [ ] **Step 4: Verify against the live repo**

Manually execute the Scenario checks (this is a genuine end-to-end test, not a trace):
- `rg -n "canTransition|TRANSITIONS" apps/deliveroo-node/src/modules/orders/service.ts` → expect matches (W2.state-machine GREEN).
- `rg -n "canTransition" apps/deliveroo-node/src/modules/orders/service.ts` inside `placeOrder` → confirm `placeOrder` does NOT call it (W2.enforced RED).
- `ls apps/deliveroo-node/test 2>&1` → expect missing (W2.tests-exist RED).
Confirm the written procedure would produce exactly this green/red verdict.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/learn-sd/references/this-week.md
git commit -m "feat(learn-sd): add this-week mode with acceptance build-check runner"
```

---

## Task 3: `ask` mode — grounded Q&A with repo tie-in

**Files:**
- Create: `.claude/skills/learn-sd/references/ask.md`

**Interfaces:**
- Consumes: startup contract (auth, progress); `active_impl` for the repo tie-in path.
- Produces: optional additions to `weak_concepts`.

- [ ] **Step 1: Define the dry-run scenario (the "test")**

Scenario: `/learn-sd ask "what isolation level prevents write skew?"`. Expected: the procedure issues `notebooklm ask "..." --notebook 173bf885-0641-4c53-b965-f2e910b68768 --json`, relays the grounded answer with source references, then ties it to `apps/deliveroo-node/src/modules/orders/service.ts` (the inventory-decrement transaction), and offers — not automatically — to save a note and/or add a weak concept.

- [ ] **Step 2: Confirm the behavior is absent**

Run: `ls .claude/skills/learn-sd/references/ask.md`
Expected: `No such file or directory`.

- [ ] **Step 3: Write `references/ask.md`**

Create the file with exactly this content:

````markdown
# learn-sd · ask

Assumes startup already passed auth and read progress. Usage: `/learn-sd ask "<question>"`.

1. **Query grounded.** Run:
   `notebooklm ask "<question>" --notebook 173bf885-0641-4c53-b965-f2e910b68768 --json`
   Use `--json` to capture the answer plus source references. If the call errors, report the CLI error verbatim; do NOT fabricate a grounded answer. Only answer from general knowledge if the user explicitly opts in, and label it clearly as ungrounded.

2. **Relay + cite.** Give the answer and name the notebook sources it drew on.

3. **Tie back to the repo.** Locate where the concept lives in the active implementation using `codegraph_search`/`codegraph_context` under `apps/<active_impl>/`, and point the user at the concrete file/flow (e.g. isolation levels → `apps/deliveroo-node/src/modules/orders/service.ts`, the `placeOrder` transaction). If it maps to an open acceptance concept, say so.

4. **Offer follow-ups (ask first).**
   - Save the answer as a notebook note: `notebooklm ask "<question>" --notebook 173bf885-0641-4c53-b965-f2e910b68768 --save-as-note --note-title "<title>"` — only after the user agrees.
   - If the question exposed a gap, offer to add the topic to `weak_concepts` in the progress file.
````

- [ ] **Step 4: Verify the procedure traces correctly**

Trace the Scenario: confirm the command line includes `--notebook 173bf885-0641-4c53-b965-f2e910b68768 --json`, that error handling forbids fabrication, that the repo tie-in uses codegraph against `apps/<active_impl>/`, and that both follow-ups are gated on user consent.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/learn-sd/references/ask.md
git commit -m "feat(learn-sd): add grounded ask mode with repo tie-in"
```

---

## Task 4: `exercise` mode — timed attempt + graded gap analysis

**Files:**
- Create: `.claude/skills/learn-sd/references/exercise.md`

**Interfaces:**
- Consumes: startup contract; `plan_week` (to pick the exercise topic), `weak_concepts`, `exercises_done`.
- Produces: `docs/exercises/<plan_week>-<topic>.md` (committed); updates `exercises_done` and `weak_concepts`.

- [ ] **Step 1: Define the dry-run scenario (the "test")**

Scenario: `plan_week: 1`, `/learn-sd exercise`. Expected: topic resolves to "URL shortener" (Week 1 exercise in the plan), the procedure runs a 45-minute cold attempt with no help during, then grades against the notebook using the plan's template, writes `docs/exercises/1-url-shortener.md` with the attempt + gap analysis, commits it, and updates progress.

- [ ] **Step 2: Confirm the behavior is absent**

Run: `ls .claude/skills/learn-sd/references/exercise.md`
Expected: `No such file or directory`.

- [ ] **Step 3: Write `references/exercise.md`**

Create the file with exactly this content:

````markdown
# learn-sd · exercise

Assumes startup already passed auth and read progress. Usage: `/learn-sd exercise`.

1. **Pick the topic.** From `docs/system-design-plan-detailed.md`, take the current `plan_week`'s Exercise (e.g. Week 1 → URL shortener, Week 2 → rate limiter, Week 3 → pastebin, Week 4 → distributed key-value store). Confirm the topic with the user; let them override.

2. **Timed cold attempt.** Tell the user this is a 45-minute interview-style attempt and note the start time. They write their design here in chat or in a scratch file. Do **not** help, hint, or answer questions about the problem during the attempt — only clarify the format. Collect their attempt when they say done (or at 45 min).

3. **Grade against the notebook.** Query the canonical approach:
   `notebooklm ask "Give the reference solution and the commonly-missed points for designing <topic>, structured as: requirements, capacity estimates, API, data model, high-level design, deep dive, bottlenecks & trade-offs." --notebook 173bf885-0641-4c53-b965-f2e910b68768`
   Produce a **gap analysis** comparing their attempt to the reference, section by section using that same template. Be specific about what they missed.

4. **Write the deliverable.** Create `docs/exercises/<plan_week>-<topic>.md` containing: the topic, date, their attempt (verbatim), and the gap analysis. Then commit:
   `git add docs/exercises/<plan_week>-<topic>.md && git commit -m "docs(exercise): week <plan_week> <topic> attempt + gap analysis"`

5. **Update progress.** Add `<topic>` to `exercises_done`; append clearly-missed items to `weak_concepts`; add a dated `## Log` line. These weak concepts now weight future quizzes and tutoring.
````

- [ ] **Step 4: Verify the procedure traces correctly**

Trace the Scenario: confirm topic resolution reads `plan_week` from the plan doc, the attempt phase forbids assistance, the grading command carries `--notebook 173bf885-0641-4c53-b965-f2e910b68768`, the deliverable path is `docs/exercises/<plan_week>-<topic>.md`, and progress updates touch `exercises_done` + `weak_concepts`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/learn-sd/references/exercise.md
git commit -m "feat(learn-sd): add timed design-exercise coach mode"
```

---

## Task 5: Register the trigger + end-to-end review

**Files:**
- Modify: `CLAUDE.md` (project root)

**Interfaces:**
- Consumes: the completed skill from Tasks 1–4.
- Produces: the `/learn-sd` trigger note in project instructions (mirrors the existing graphify convention).

- [ ] **Step 1: Define the check (the "test")**

Expected: project `CLAUDE.md` documents the `/learn-sd` trigger so the skill is discoverable, and all four skill files exist and cross-reference correctly (SKILL.md dispatch targets resolve to the three reference files).

- [ ] **Step 2: Confirm the behavior is absent**

Run: `rg -n "learn-sd" CLAUDE.md`
Expected: no matches.

- [ ] **Step 3: Append the trigger note to `CLAUDE.md`**

Add this block to the project-root `CLAUDE.md`:

```markdown
# learn-sd
- **learn-sd** (`.claude/skills/learn-sd/SKILL.md`) — drive the system-design study plan: weekly agenda + quiz, grounded Q&A, timed design exercises. Trigger: `/learn-sd`, `/learn-sd ask "…"`, `/learn-sd exercise`.
When the user types `/learn-sd`, invoke the Skill tool with `skill: "learn-sd"` before doing anything else.
```

- [ ] **Step 4: Verify structure and cross-references end-to-end**

Run:
```bash
ls .claude/skills/learn-sd/SKILL.md .claude/skills/learn-sd/references/{this-week,ask,exercise}.md
rg -n "references/(this-week|ask|exercise).md" .claude/skills/learn-sd/SKILL.md
rg -n "learn-sd" CLAUDE.md
```
Expected: all four files exist; SKILL.md dispatch lines reference all three reference files; CLAUDE.md shows the trigger. Then re-trace Scenarios A/B from Task 1 through the finished skill to confirm the modes connect.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register /learn-sd trigger in project instructions"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-12-learn-sd-skill-design.md`):
- Three sub-modes → Tasks 2 (this-week), 3 (ask), 4 (exercise). ✓
- Startup auth gate + progress bootstrap → Task 1. ✓
- Component 1 progress state incl. `active_impl` → Task 1 schema. ✓
- Component 3 acceptance verification (concept doc + manifest, tool-checked, `self` never gates, `plan_week` gating, carry-forward) → Task 2 build-check runner. ✓
- Slippage rule (`elapsed_week` vs `plan_week`) → Task 1 (statement) + Task 2 (application). ✓
- Explicit `--notebook` id everywhere, no `notebooklm use` → Global Constants + Tasks 2–4 commands. ✓
- Repo tie-in for `ask` → Task 3. ✓
- Exercise deliverable `docs/exercises/<planweek>-<topic>.md` committed → Task 4. ✓
- Monorepo manifest indirection (`apps/<impl>/acceptance.<lang>.md`) → Task 2. ✓
- Project-only skill location → Task 1 file path + Task 5 trigger. ✓
- Error handling (auth stale, notebook failure, no progress file) → Task 1 startup + Task 3 step 1. ✓

**Placeholder scan:** No TBD/TODO; every skill file's full content is inline; commands are exact. ✓

**Type/name consistency:** progress fields (`plan_week`, `elapsed_week`, `phase`, `active_impl`, `started`, `exercises_done`, `weak_concepts`) identical across Tasks 1–4; `NOTEBOOK_ID` identical in every command; dispatch targets (`references/this-week.md`, `ask.md`, `exercise.md`) match the created files. ✓

**Note on TDD adaptation:** the deliverables are Markdown skill files, so "tests" are dry-run scenarios; Task 2 step 4 is a genuine live check against the repo (grep/ls), the strongest verification available for a prose skill. Live `notebooklm` behavior is exercised only at real invocation (needs auth + a connected CodeGraph MCP).
