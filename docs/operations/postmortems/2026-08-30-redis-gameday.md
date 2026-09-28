# Game-day — kill Redis under load

Slices 1–4 built a pipeline on the *assumption* it would be useful during an
incident. Nobody has checked. This deliberately breaks something while watching
the instruments, to find out whether they answer the question you would actually
be asking at 3am: **what broke, and why?**

## Hypothesis — written BEFORE the run

`resolve()` catches Redis errors and falls through to Mongo, so reads should
**degrade, not fail**. Predicted chain:

| # | Prediction | Confidence |
|---|---|---|
| 1 | Redis dies, redirects keep returning 302 (no 5xx) | high — there is a test for it |
| 2 | `cache_hits_total` flattens, `cache_misses_total` climbs to 100% | high |
| 3 | p99 rises above the 50 ms SLO threshold | **medium — the real unknown** |
| 4 | Burn rate climbs off 0.01×, `RedirectLatencyBudgetBurnCritical` fires | medium, depends on 3 |
| 5 | A slow trace in Tempo shows time in Mongo, not Redis | medium |
| 6 | That trace's `trace_id` appears in the app logs next to the Redis error | high |

**Where this could fail to prove anything:** if Mongo absorbs the load
comfortably, p99 stays under 50 ms, nothing fires, and the finding is that the
SLO is too loose rather than that the pipeline works.

**Specific prediction worth recording:** ioredis defaults to
`maxRetriesPerRequest: 20`. In the test suite a dead Redis took ~42 s to finally
throw. If that backoff applies on the request path, requests will not be "slow",
they will *hang* — a far bigger latency spike than a Mongo fallback would
explain, and itself a defect (a dead cache should fail fast, not block).

## Method

Load must stay **low**. The app saturated a core at 30 VUs; if it is already
CPU-bound the Redis effect gets buried under CPU queueing and we would measure
the wrong bottleneck. Aim for enough requests to give the SLI samples, not
maximum throughput.

Alert timing matters too. `RedirectLatencyBudgetBurnCritical` needs the 1h *and*
5m windows above 14.4%, then `for: 2m`. Since `rate[1h]` averages over whatever
data exists, a long healthy warm-up **dilutes the outage below the threshold**.
Keep the baseline short.

```
0:00  start load, short baseline
~4:00 kill Redis
      observe: cache misses, p99, burn rate, alert state
~9:00 restart Redis
      observe: recovery, and whether the short window clears faster than the long one
```

## Run log — 2026-08-30

Four attempts. The first three were invalid for reasons worth recording.

### Attempt 1 — the service died

Baseline was clean: SLI 100%, burn 0x, 5,264 cache hits/s, 0 misses, p99 5 ms.
Killed Redis. Throughput fell 3,921 -> 1,556 -> **0 req/s**. The app container
was `exited`, not hung.

**Prediction 1 was wrong.** Reads did not degrade. `resolve()` catches its Redis
errors and there is a passing test for exactly this, yet the process died anyway
— because the failure never reached that try/catch:

```
node:internal/process/promises:394
    triggerUncaughtException(err, true /* fromPromise */);
MaxRetriesPerRequestError: Reached the max retries per request limit (which is 20)
    at Socket.<anonymous> (ioredis/built/redis/event_handler.js:207:37)
```

No application frame on the stack. ioredis was rejecting its **queued** commands
en masse when the connection dropped — promises nobody was awaiting, which is an
unhandled rejection, which since Node 15 kills the process.

### What the dashboards said while the service was down

**Nothing.**

| | |
|---|---|
| `RedirectLatencyBudgetBurnCritical` | inactive |
| `RedirectLatencyBudgetBurnHigh` | inactive |
| `RedirectLatencyBudgetBurnSlow` | inactive |
| `RedirectLatencySLIMissing` | inactive |
| SLO dashboard error ratio | **0** — i.e. perfect |

This is the blind spot documented in slice 4, confirmed in the worst way: the SLI
filters `status="302"`, so a total outage makes it go **absent, not bad**. There
were no successful redirects left to be slow. `RedirectLatencySLIMissing` did not
save us either — its `absent()` only trips once the 5m rate window empties, then
`for: 10m` on top, so a *complete outage* takes ~15 minutes to alert. Everything
was green while nothing worked.

**The game-day earned its keep here.** Four alerts, a burn-rate panel and an SLO
dashboard, and not one of them noticed a dead service.

### Attempts 2 and 3 — invalid, and instructive

Both "failed" identically. The cause was not the code:

```
container image:  f62ab7af...   <- original
latest built:     6864ed10...   <- had the fixes
grep enableOfflineQueue in the RUNNING container: 0
```

`podman compose up -d --build` rebuilt the **image** and reused the existing
**container**. The same trap as resource limits, which also apply only at create
time. Two full experiments were run against code that was never loaded. Only
`podman rm -f` then `up -d` actually swaps it.

### Attempt 4 — three fixes, then real degradation

With the fixes genuinely in the running container and Redis stopped:

| path | result |
|---|---|
| | Redis alive | Redis dead |
|---|---|---|
| read (redirect) | 302 in 2.4 ms | **302 in 322 ms** |
| write (shorten) | — | **201 in 111 ms** |
| app | running | **running** |

322 ms is three cache calls x the 100 ms budget. Degraded, but bounded — against
a 10 s hang before the timeout, and a dead process before any of the fixes.

## Bugs found

1. **`void flushOnce()` in the click flusher** (`clicks.ts`) — `void` discards
   the promise rather than handling it, so a Redis failure in the background
   timer became an unhandled rejection and killed the process. The request path
   was carefully defended; the timer was not.
2. **No timeout on cache calls** (`cache.ts`) — took three tries to get right,
   and the two wrong turns are the lesson.
   - `enableOfflineQueue: false` gives fail-fast but **removes the queue startup
     depends on**: every command issued before the socket is ready rejects with
     "Stream isn't writeable". All 26 tests failed.
   - `maxRetriesPerRequest: 1` breaks **normal reconnects** — 9 tests died with
     "max retries per request limit (which is 1)".
   - What works is neither driver setting but an **application-level timeout**:
     `withTimeout(..., 100ms)` around every cache call. The cache is an
     optimisation, and an optimisation is never worth waiting on. The driver
     keeps its resilient defaults for transient blips; the caller owns the
     latency budget. That is the Release It! lesson: **put your own timeout on
     every remote call.**
   - Subtlety worth keeping: when the timeout wins the race the original promise
     is still pending, and its later rejection has no handler — an unhandled
     rejection, i.e. the exact bug being fixed. `p.catch(() => {})` closes it.
3. **Unguarded `cacheSet` in `shorten()`** (`service.ts`) — the link was already
   durable in Mongo, but warming the cache was awaited unguarded, so a dead cache
   turned every *write* into a 500. Reads were defended, writes were not.

## Fixes still owed

- **An availability SLO.** The latency SLI cannot see a total outage by
  construction. This is the second time that gap has been written down; the
  game-day is the argument for closing it.
- **Faster outage detection.** ~15 minutes to notice a dead service is too slow.
  A `rate(http_request_duration_seconds_count[5m]) == 0` alert would fire in
  about a minute.
- A regression test that kills Redis under load, so bug 1 cannot return quietly.


## Process notes — how the run itself went wrong

Worth recording, because these cost more time than the bugs.

- **The container never had the fixes.** Two whole experiments were run against
  stale code because `podman compose up -d --build` rebuilds the image and
  reuses the container. Always verify the fix is in the *running* container:
  `podman exec <c> grep -c <marker> <file>`.
- **The Collector and Tempo were silently gone** for one attempt, killed by an
  earlier `podman rm -f $(podman ps -aq)`. The app served traffic happily with
  nowhere to send telemetry, and every metric read `n/a` — which looks identical
  to "the service is dead". Check the pipeline before trusting a null reading.
- **Redis was left stopped** after a verification step, and the next several test
  runs "hung" for that reason alone. Restore the environment between experiments.
- **`increase()` on a freshly-created series returns 0**, which twice looked like
  "no telemetry" when data was flowing fine. Query the raw counter to confirm.
