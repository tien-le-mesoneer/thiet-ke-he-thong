---
plan_week: 1
elapsed_week: 1
phase: 1
active_impl: node
started: 2026-07-12
exercises_done: [url-shortener]
weak_concepts: [capacity-estimation, right-sizing]
---
## Log
- 2026-07-12: Progress file created. Study plan started.
- 2026-07-13 Week 1 (reading): reliability quiz (3 Qs) via notebook. Q2 (human/software faults) flagged not-fully-understood → tutored (correlated vs independent failures; redundancy only beats independent faults). Added weak_concept: human-and-software-faults.
- 2026-07-13 Week 1 (reading): full reliability explanation via ask mode; user confirmed solid → cleared weak_concept human-and-software-faults. Saved reliability summary to notebook as a note.
- 2026-07-13 Week 1 (build): W1.migrations GREEN — reused local Postgres (created role app + db deliveroo), migration applied all 4 module schemas. Fixed esbuild platform-binary mismatch (reinstalled node_modules) which also unblocks npm dev/test. Week 1 build fully green.
- 2026-07-15 Week 1 (exercise): URL shortener attempt graded (avg ~B). Strengths: structure, bottleneck spotting, obfuscated-id instinct. Fixes: storage units 1000× off, NFR-vs-estimate mismatch, 301→302, right-size DB (single Postgres, not NoSQL). exercises_done += url-shortener; weak: capacity-estimation, right-sizing. User wants to build it as a real service in the practice project (next: brainstorm apps/url-shortener).
