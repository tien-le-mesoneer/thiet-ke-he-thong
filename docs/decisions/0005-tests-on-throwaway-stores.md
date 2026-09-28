# 0005 — Run tests against dedicated `_test` stores behind a startup guard

- **Status:** Accepted
- **Date:** 2026-08-24

## Context
Tests shared the dev database. One test reset `counters` but not `links`; short
codes derive from the counter, so the app then re-issued codes that already
existed (`E11000`). A k6 run's `setup()` hit that 500, got no code, and measured
112k requests to `/undefined` — **all 404s, reported as a plausible p99.**

## Decision
`npm test` targets `shorturl_test` and Redis db 1 (deliveroo: `deliveroo_test`).
A preloaded `test/setup.ts` **refuses to start** unless the Mongo URL ends in
`_test` and the Redis URL names a non-zero db. Tests that reset `counters` also
reset `links`. The k6 `setup()` throws if it can't get a code.

## Alternatives
- **Clean up carefully in each test.** Lost: that is exactly what failed.
- **Mocks instead of real stores.** Lost: the bugs worth catching live in the
  real Mongo/Redis behaviour.

## Consequences
- Tests need Mongo and Redis running.
- Never bypass the guard. A run against the dev database silently corrupts it.

## Evidence
- [progress log](../study/progress.md), 2026-08-24 BUG FOUND / BUG FIXED
- `apps/url-shortener-node/test/setup.ts`, `apps/deliveroo-node/test/setup.ts`
