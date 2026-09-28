# 0001 — Build the url-shortener on MongoDB + Redis, deliberately over-built

- **Status:** Accepted
- **Date:** 2026-07-16

## Context
The timed design exercise for the same problem was graded down for reaching
for NoSQL: at the real load (~58 read QPS, under 1 TB over 5 years) one
Postgres would do. But this service exists to practise the machinery that load
*doesn't* need yet.

## Decision
MongoDB for links, Redis for the redirect cache and click counters. Build the
cache, block id allocation, and a shard-routing seam — and give every heavy
piece a code comment naming the **trigger point** where it would actually be
justified. Right-sizing is documented, not skipped.

## Alternatives
- **Single Postgres.** The right-sized answer, and what the exercise grade
  asked for. Lost because it leaves nothing to learn about caching, sharding,
  or the document model.
- **Postgres + Redis.** Lost to Mongo on native TTL indexes and first-class
  hashed sharding.

## Consequences
- The monorepo now runs two datastores (Mongo here, Postgres in deliveroo) —
  more to operate, on purpose (DDIA ch. 2, polyglot persistence).
- Mongo needs `--wiredTigerCacheSizeGB` in a container; see
  [0006](0006-containerise-apps-per-area-compose.md).

## Evidence
- [url-shortener spec](../specs/2026-07-16-url-shortener-service-design.md) — "Deliberately over-built for learning", "Why MongoDB"
- [exercise attempt](../study/exercises/1-url-shortener.md) — Fix 4: right-sizing
