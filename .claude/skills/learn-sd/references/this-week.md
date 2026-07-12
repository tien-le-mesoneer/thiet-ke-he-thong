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
