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
