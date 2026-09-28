# 0006 — Containerise the apps, one compose file per area, two memory ceilings

- **Status:** Accepted
- **Date:** 2026-08-30

## Context
The goal was to cap app memory at 50–100 MB. A process on the host gets no
cgroup, so `NODE_OPTIONS=--max-old-space-size` bounds only the V8 heap —
nothing enforces a limit on RSS.

**Earlier the same day** everything was merged into one root `compose.yaml`
with the apps left on the host. It was reverted the same day: one file for
unrelated areas, and still no real limit on the apps. Both are recorded here
because the reversal is the lesson.

## Decision
Each area has its own compose file (`apps/url-shortener-node`,
`apps/deliveroo-node`, `infra/observability`); all join the external network
`sd-net`. Apps run in containers with **both** ceilings:

| | Bounds | Set by |
|---|---|---|
| `mem_limit: 256m` | RSS — the kernel kills past it | compose |
| `NODE_MAX_HEAP_MB: 100` | the V8 heap inside that | `NODE_OPTIONS` |

## Alternatives
- **Single root compose, apps on host.** Tried and reverted, see Context.
- **Heap flag alone.** Lost: RSS runs ~1.8× the heap and stays unbounded.

## Consequences
- Measured floors: 50 MB heap dies at startup (921 ms in), 75 MB works, 100 MB
  chosen for margin. Under load: 8,190 req/s, p99 9.89 ms, 155.8 MB of 256.
- **A container limit is invisible to the process inside unless you tell it.**
  Mongo needs `--wiredTigerCacheSizeGB 0.25` (at 100m it idled fine at 74 MB
  and was OOM-killed by the test suite); the JVM needs `-Xmx`.
- `podman compose up -d --build` reuses the existing **container**. Two
  game-day experiments ran stale code because of it. `podman rm -f` first.
- Hot reload is host-only; containers run watch-free scripts.

## Evidence
- [progress log](../study/progress.md), both 2026-08-30 infra entries
- `apps/url-shortener-node/CLAUDE.md` — Memory
