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

Slippage = `elapsed_week - plan_week`. When positive, protect reading + the timed exercise + `self` reflection, and defer or stub the **build** first — the build is where overruns actually accrue, and the timed exercise is the graded milestone deliverable (the "4 written design docs"). This intentionally adapts the plan's raw slippage wording to protect the exercise; the one hard rule carried over unchanged: never skip two exercises in a row. Frame slippage neutrally ("2 weeks behind syllabus pace — normal for this plan").

## Autonomy

Run freely: `notebooklm auth check`, `ask` (without `--save-as-note`), `status`, `list`, and all read-only `codegraph_*`/grep/test checks. Ask first before: `notebooklm ask … --save-as-note`, any `notebooklm delete`, and committing files.
