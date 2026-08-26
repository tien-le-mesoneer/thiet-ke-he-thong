# Study notes

Freeform study notes captured via `/learn-sd note`. Newest at the bottom.

## 2026-07-26 · Load parameters & Twitter fan-out
_week 1 · node · source: quiz · tags: scalability, load-parameters, fan-out · nb: 2375e52a_

Load parameters describe a system's demand quantitatively. Examples:
- Requests per second (web server)
- Ratio of reads to writes (database)
- Number of simultaneously active users (chat room)
- Hit rate on a cache
- Fan-out factor (write amplification — số lần write amplification)

Twitter home-timeline illustrates the fan-out challenge: posts run 4.6k RPS
average / 12k RPS peak, while reads run 300k RPS. Fan-out-on-write amplifies
1 tweet → ~75 writes on average, and up to ~30M writes for a celebrity. That is
why the **write path**, not the read path, is the real scaling bottleneck — the
cost of a post is paid at write time, once per follower.

## 2026-08-25 · Reading percentiles, and the fan-out budget
_week 1 · node · source: quiz · tags: percentiles, tail-latency, fan-out, slo · nb: 397ca0ed_

**Definitions, stated carefully.** `p50 = 20ms` means half of requests finish in
under 20ms — not that 99% do. `p99 = 800ms` means 1 in 100 takes 800ms **or
worse**; the true maximum is unbounded above it. A p50/p99 spread of 40x is the
diagnosis, not the problem: it says the slow requests are slow for *situational*
reasons (queueing, GC pause, cache miss, a heavy account), not because the work
is harder. The mean here lands near 28ms and hides all of it.

**Fan-out multiplies the tail, it does not average it.** A request that fans out
to N backends in parallel waits for the slowest. With each backend at p99:
`P(user hits the slow path) = 1 - 0.99^N` — 9.56% at N=10, 18.2% at N=20,
63.4% at N=100.

**The budget formula.** To promise the user p99 while fanning out to N services,
each service needs success rate `q` where `q^N = 0.99`, i.e.
**`q = 0.99^(1/N)`**. At N=20 that is q = 0.99950, so each service must hold its
**p99.95** — not its p99 — under the deadline. N=100 demands p99.99.

**When they cannot hit it,** in order of leverage: reduce N (fewer, fatter
calls); hedged/backup requests — duplicate after the p95 and cancel the loser,
so only the slowest ~5% are duplicated (Dean & Barroso, *The Tail at Scale*, via
DDIA ch.1); deadline propagation — pass the *remaining* budget downstream so
nobody works on a request the user already abandoned (*Building Microservices*
ch.12, Resiliency / Time-Outs); bulkheads and circuit breakers; partial results;
or renegotiate the SLO, which is often the honest answer.

## 2026-08-25 · Measuring latency without fooling yourself
_week 1 · node · source: quiz · tags: percentiles, measurement, slo, observability · nb: 658939cb_

**Never average percentiles.** Instance p99s of 40 / 45 / 200 ms do not make a
fleet p99 of 95ms. That average is not merely imprecise, it is **biased low**:
with equal traffic the slow instance owns a third of all requests, so its
slowest 3% land inside the overall top 1% and the true p99 sits near 200ms. The
average hides your worst instance. Correct method: pool the raw latencies, or
sum the histogram buckets (which is traffic-weighted by construction), and
recompute the percentile from the combined data.

**Server time is not user time.** A server can honestly report p99 = 5ms while
users are honestly reporting slowness, because the server's clock starts when it
*picks the request up* — not when it arrived. A request queued behind a heavy one
for 900ms still shows as 5ms of processing. Both statements are true; they time
different intervals. Network and client-side rendering add more, and fan-out
amplification more again.

**Survivorship bias.** Server logs only contain requests that were actually
served. Dropped, timed-out and rejected requests never appear, so the metric
*improves* precisely as the system degrades.

**Therefore measure client-side** — RUM, browser timing APIs, or a load
generator like k6. In this repo the k6 numbers are the trustworthy ones, and the
in-process histogram is trusted only because it is counted, not interpolated.

