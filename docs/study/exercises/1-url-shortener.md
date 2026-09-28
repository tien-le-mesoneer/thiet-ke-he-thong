# Requirements
## Functional
- User paste the link into text fields hit enter then it return to shorten url link, shorten url navigate back to user link
- This link is valid as long as it's active, but it will expire if left unused for 7 days
- Ensure it wont generate used link
- Link should have English words with maxium 7 Characters
- THe link must be https for safety
## Non Functional
- Response time should under 100ms
- The backend can handle 1 millions request per min

# Estimates
## Users
### Asumptions
DAU: 500000 users daily
MAU: 1000000 users monthly 
count as anonymous users because users dont need to login to do that
### QPS estimation
- Writes
  - 500000 users x 3 links = 1500000 writes per day
  - 17.3 WRITE QPS
- Reads
  - 500000 users x 10 links = 5000000 reads per day
  - 57.8 Read QPS
- Ratio: 1:3
- Peak 3x read qps 150/sec

### Storage
Field,Type,Size,Notes
id,BIGINT,8 bytes,"Auto-incrementing sequence (1, 2, 3...)"
original_url,VARCHAR(200),~200 bytes,The target destination destination
created_at,TIMESTAMP,8 bytes,Timestamp
last_accessed_at,TIMESTAMP,8 bytes,Updated on every redirect (sliding window)
user_id,UUID or BIGINT,16 bytes,Owner identification

8
+204
+8
+8
+16
+24
+8 (padding/alignment)
---------------------
≈276 bytes/row

~300 Bytes/record
450000 MB/day
164250 GB/year
- Bandwidth: 17.36 KB/sec × 8 bits/byte = ~138.9 Kbps

### Api & data model
#### API
POST /api/v1/urls
Request:
{
  "longUrl": "https://example.com/very/long/path",
  "customAlias": "my-link",     // optional
  "expiresAt": "2026-12-31T00:00:00Z"  // optional
}

GET /{shortCode}
Response: 302 Found
Location: https://example.com/very/long/path
GET /api/v1/urls/{shortCode}
Response: 200 OK
{
  "shortCode": "aZ9kLp",
  "longUrl": "...",
  "clickCount": 1523,
  "createdAt": "...",
  "expiresAt": "...",
  "isActive": true
}

#### Data model
Column          Type            Notes
----------------------------------------------------
id              BIGINT (PK)     internal, auto-increment
short_code      VARCHAR(8)      indexed, UNIQUE — the base62 encoded key
long_url        TEXT            the original URL
user_id         UUID (FK)       nullable if anonymous allowed
created_at      TIMESTAMP
expires_at      TIMESTAMP       nullable
is_active       BOOLEAN         soft-delete flag
click_count     BIGINT          denormalized counter (see below)


# High level design
Client → LB → API Server
                  │
                  ▼
           Check Cache (Redis) ? 
                  │
        ┌─────────┴─────────┐
       HIT                 MISS
        │                    │
   Return long_url     Query DB
   (~1ms)                    │
                       Populate cache
                              │
                       Return long_url
                              │
                  301 redirect to client
Cache eviction: LRU is a natural fit
DB choice: Key-value access pattern (short_code → long_url) — a NoSQL store
CDN for redirects: Since 302 redirects are just a Location header, you can push this even closer to the edge — mention CDN or edge functions as a scaling option if pushed on "how do you handle 1M QPS."

# Deep Dive
for deep dive can you review 

I want to use combination or 7 chars of [a-zA-Z0-9] and let them auto increase, of course we will have TTL to get rid of them, of there is a way to shuffle the combination with less effort of searching

cache invalidation: so cache for a day with TTL use cache eviction is LRU

If it is go viral I can increase number or chars to 8-9-10

db sharding can based on number of characters
using ObfuscatedIdGenerator approach to generate url also so It can toBase62() / fromBase62() — pure number ↔ string conversion

# Bottom necks
- Single ID generator becomes a bottleneck
- Cache hit ratio can drop even though you added more cache capacity, because the long tail gets longer, not just fatter.
- : Batch/buffer click events in the queue consumer 
- a single URL going mega-viral (think: shared in a presidential tweet) still hits one DB partition and one cache node disproportionately —

---

# Reviewer Feedback (graded 2026-07-15)

**Overall: strong first attempt.** Structure is right; you self-identified the real bottlenecks. Gaps are mostly numeric errors + internal inconsistencies.

## Fixes
1. **Storage off by 1000×.** 1.5M writes/day × 300 B = **450 MB/day** (not 450,000 MB); ~**164 GB/year**; ~820 GB / 5 yr.
2. **NFR contradicts estimates.** "1M req/min" ≈ 16,700 QPS vs your ~58 read QPS. Pick one target and design to it.
3. **301 vs 302.** You track click_count → must use **302** (301 is browser-cached, clicks never reach you). Diagram says 301 — fix.
4. **DB choice.** auto-increment→base62 needs a monotonic counter, which a pure NoSQL KV store doesn't give you. At your corrected scale (58 QPS, <1 TB/5yr) a **single Postgres + cache** suffices; add sharding/Snowflake only ~10k+ QPS or multi-TB. Right-sizing > reflexive NoSQL.

## Deep dive (answers to your questions)
- **Non-guessable keys without searching:** keep sequential `id` internally → apply a **reversible bijection** (Feistel / ×coprime mod 62⁷ / Sqids/Hashids/Optimus) → base62. Deterministic ↔, zero collisions, non-sequential. = your `ObfuscatedIdGenerator`. ✅
- **base62(id):** no collisions, no DB lookup (beats hashing); downside = guessable → hence the obfuscation. 62⁷ ≈ 3.5T keys.
- **Single ID-gen bottleneck:** ID ranges (grab 1,000-id blocks) or Snowflake IDs (ts+node+seq, ~4,096/ms/node, no coordination).
- **Sharding by #chars:** don't — nearly all keys are 7 chars → uneven. Shard by hash(short_code) or id range.
- **Sliding 7-day TTL:** last_accessed write on every read kills the read-heavy win. Use lazy expiry (check expires_at on read + background sweep) or only bump the timestamp when stale.

## Grades
Requirements B · Estimates B− · API+model A− · HLD B · Deep dive B+ · Bottlenecks A

## Weak concepts logged
- `capacity-estimation` (storage units; NFR-vs-estimate consistency)
- `right-sizing` (match machinery to the numbers, not to buzzwords)
