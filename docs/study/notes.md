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

## 2026-08-30 · Sizing memory: it does not scale with req/day
_week 1 · node · source: ask · tags: capacity-estimation, right-sizing, littles-law, memory_

**"How much memory for N req/day" is usually the wrong question.** Memory scales
with **concurrency and working set**; **CPU** scales with request rate. Decompose
before estimating:

```
memory = FIXED            (runtime, code, pools, live object set)
       + PER-REQUEST x concurrency
       + WORKING SET      (data kept hot)
```

**Worked example — url-shortener at 10,000 req/day.**
`10,000 / 86,400 = 0.116 req/s` average; x10 peak factor = 1.16 req/s. Little's
Law `L = λ × W` with the measured p99 of 7.02 ms gives
`1.16 × 0.00702 = 0.008` requests in flight — under one at any instant. At ~30 KB
per in-flight request that is **250 bytes**. The rate term is noise.

Measured capacity of one process (100 MB heap / 180 MB RSS): 13,655 req/s =
**1.18 billion req/day**, or 826M at 70% utilisation. 10,000/day uses 0.0008% of
it — **118,000x headroom**.

So the answer is the FIXED term: node ~180 MB + mongo ~236 MB + redis ~3 MB =
**~420 MB, identical at 10k/day or 10M/day**. This is also why a 50 MB heap
killed the app regardless of load: the ~49 MB live set exists before the first
request arrives.

**What actually grows is data, driven by WRITES not total requests.** At 10:1
read:write that is 909 new links/day: 99.5 MB after 1 year, 298 MB after 3,
498 MB after 5 — still smaller than the fixed overhead. Hot cache ~66k entries
x 120 B = 8 MB.

**When would rate start to matter?** To add 100 MB via concurrency you need
`L = 3,413` in flight, i.e. `λ = 3413 / 0.00702 = 486,230 req/s` = 42 billion
req/day. CPU dies thousands of times over first.

**Corollary worth remembering:** `L = λ × W` means cutting latency also cuts
memory. A 2-second endpoint needs 285x the concurrency of a 7 ms one at the same
request rate — slow endpoints are expensive in RAM, not just in patience.

**And measure under constraint, not at rest.** Uncapped, these services expand
to fill what they are given (Grafana 296 MB uncapped -> 60 MB capped, same work).
Observed usage tells you a process's appetite, not its requirement. See
[[measuring-latency-without-fooling-yourself]].


## 2026-10-06 · Valkey/Redis Streams: log, consumer group, PEL
_week 1 · node · source: ask · tags: redis-streams, valkey, consumer-group, at-least-once, idempotency · nb: 0bc7b984-83e6-45d0-9236-64e41a4d65cb_

Học theo Feynman (4 phần + lab trên Valkey 8), xuất phát từ chỗ chỉ biết `SET`/`GET`.

**1. Stream là append-only log.** `SET` ghi đè; `XADD orders * order 42 item pho` thêm
entry vào cuối, không mất gì. Mỗi entry là một map field/value và có ID
`<timestamp ms>-<counter>`, tăng dần. ID quan trọng không phải vì "đọc nhanh" mà vì nó
vừa là **thứ tự** vừa là **bookmark**: reader nhớ last ID rồi `XREAD STREAMS orders <lastId>`.
Last ID phải lưu ở chỗ sống sót qua crash, không chỉ trong biến của process.

**2. Blocking read.** `XREAD BLOCK 5000 ...` giữ connection và trả về ngay khi có entry
mới — thay cho polling. `$` = "mới hơn lúc gọi lệnh", chỉ dùng ở lần gọi đầu; dùng `$`
mọi lần sẽ mất entry được ghi trong lúc đang xử lý giữa hai lần gọi.

**3. Consumer group.** `XREAD` thường không chia việc: 5 worker = mỗi entry xử lý 5 lần
(tự lưu last ID cũng không cứu, vì mỗi worker chỉ biết chính nó). `XGROUP CREATE orders
kitchen $ MKSTREAM` + `XREADGROUP GROUP kitchen chef-1 ... STREAMS orders >`. Trong một
group các consumer **chia nhau** entry; giữa các group, **mỗi group nhận đủ**. `>` =
"chưa giao cho ai **trong group của tôi**" — không phải "chưa group nào đọc" (lỗi mình mắc).
Redis nhớ vị trí đọc hộ cả group.

**4. PEL, XACK, crash.** Entry đã giao nhưng chưa `XACK` nằm trong Pending Entries List,
để không mất khi worker crash. Khôi phục: cùng consumer khởi động lại đọc bằng `0`
(chỉ trả pending **của chính consumer đó**, không phải cả group); consumer chết hẳn thì
người khác `XAUTOCLAIM orders kitchen chef-2 10000 0` lấy entry idle quá 10s. Xử lý xong
rồi mới ack ⇒ **at-least-once** ⇒ code bắt buộc **idempotent** (ack trước = at-most-once).

**Đọc output trong lab.** `XPENDING orders kitchen` = tổng pending, min ID, max ID, số
pending theo consumer. `XPENDING orders kitchen - + 10` = chi tiết: ID, consumer, idle ms
(tính từ lần **giao** gần nhất), delivery count. Count cao bất thường = poison message →
dead-letter stream. `XAUTOCLAIM` trả về cursor (`0-0` = quét hết), entry đã claim, và ID
đã bị xoá khỏi stream.

**Bài học từ lỗi trong lab.** Lỡ chạy `XADD` hai lần ⇒ hai entry khác ID, cùng nội dung
`order 42`. Stream không dedupe. Có hai kiểu trùng: cùng entry giao lại (nhận ra bằng entry
ID / delivery count) và khác entry cùng nghiệp vụ (chỉ nhận ra bằng **business key**).
Idempotency nên dựa vào business key — khớp với bài 2026-09-16: dedupe theo id của producer,
không theo id do broker cấp.

## 2026-10-07 · Valkey/Redis Streams: retention + observability
_week 1 · node · source: ask · tags: redis-streams, valkey, retention, xtrim, consumer-lag, alerting · nb: de4a3572-2237-409f-8cd7-edc10db4aa05_

**Retention.** Stream append-only, `XACK` chỉ gỡ khỏi PEL, KHÔNG xóa entry → không trim thì RAM tăng mãi. Chạm `maxmemory`: `noeviction` → `XADD` lỗi OOM (cứu được); `allkeys-*` → evict nguyên key, mất stream + PEL + group, không ai biết (tệ nhất).

- `MAXLEN N` giữ N mới nhất; `MINID <ms>-0` giữ theo thời gian (ID = ms timestamp, không có TTL per-entry).
- `~` = "ít nhất N": chỉ xóa nguyên node (~100 entry). Lab: `MAXLEN ~ 3` trên 10 entry không xóa gì; exact còn 3.
- **Bẫy: trim không nhìn PEL.** Lab: `XTRIM MAXLEN 0` với 2 pending → `XPENDING` vẫn 2 (PEL chỉ lưu ID); `XAUTOCLAIM` trả 2 ID ở phần tử thứ 3 (deleted) → order mất. Consumer phải log/alert phần tử thứ 3.
- **Quy tắc:** retention ≥ lag tối đa + thời gian recovery + margin. Sai lầm của mình: chọn 2h cho lag 2h + recovery 1h. Cùng hình dạng với GC trap 2026-09-16: thứ xóa dữ liệu phải chờ lâu hơn thứ chậm nhất còn cần nó.

**Observability (`XINFO GROUPS`).** `lag` = chưa giao cho group (→ thêm consumer, nếu chính consumer là bottleneck); `pending` = giao rồi chưa ack (→ `XAUTOCLAIM`, nhưng xem delivery count trước: cao = poison message, không phải crash). Lab: 2 XADD + đọc COUNT 1 → lag 1, pending 1.

- Alert lag theo **thời gian**, không theo số lượng (lag 5000 lúc trưa = 5 phút; lag 50 lúc 3h sáng = 50 phút). Đo tuổi entry **cũ nhất chưa giao**: `lag = 0` → 0; `lag > 0` → `XRANGE orders (<last-delivered-id> + COUNT 1`, lấy `now − ts` (ts = phần ms trước `-` của ID). **Đính chính:** `now − ts(last-delivered-id)` báo động giả khi producer ngừng gửi (đêm không có order).
- Bắn ở ~50% retention (6h → 3h): nửa còn lại là ngân sách phản ứng — thức dậy, chẩn đoán, scale, và **xả tồn đọng**. Đợi tới 6h = alert bắn đúng lúc dữ liệu bắt đầu bị trim. Ngưỡng chỉnh theo thời gian phản ứng đo được.
- `lag = 0` ≠ ổn: app crash giữ entry thì lag 0 nhưng pending kẹt → cần cả alert pending.
- Alert pending: idle > N phút hoặc delivery count > K.

## 2026-10-16 · Valkey/Redis Streams: poison message, idempotent consumer, khi nào không dùng
_week 1 · node · source: ask · tags: redis-streams, valkey, poison-message, dlq, consumer-idempotency, broker-selection · nb: 4aa27953-5247-4608-b919-4117b5614c62_

**Poison message.** Entry làm chết mọi consumer đọc nó. `XAUTOCLAIM` chữa lỗi do consumer, không chữa lỗi do entry: nó chỉ chuyển entry độc cho người kế tiếp. Dấu hiệu là **delivery count** (cột 4 của `XPENDING`) tăng mãi. Idle không dùng được vì bị reset mỗi lần giao/claim. Lab: 1 XREADGROUP + 2 XAUTOCLAIM → count 3, idle chỉ 9.6s.

- Cách ly: `XRANGE` lấy nội dung → `XADD <stream>:dlq * …fields… orig-id <id> error "…"` → `XACK`. **XADD trước, XACK sau.** Ngược lại thì crash ở giữa là mất order (dual-write).
- DLQ entry có ID mới → phải lưu `orig-id`. DLQ là hàng chờ cho người: alert `XLEN dlq > 0`, sửa, replay. Replay lại sinh ID mới → consumer phải dedupe theo business key.

**Idempotent consumer** (cuối cùng đã đạt, ở lần thứ 6):
- Dedupe theo business key, ở **đúng độ mịn của từng side effect** (`(order_id,'stock')`, `(order_id,'ticket')`), INSERT `ON CONFLICT DO NOTHING` **cùng transaction** với side effect. Dedupe cấp order mà commit cùng bước 1 → replay bỏ qua bước 2 chưa làm.
- `fn` đặt trước transaction dedupe → side effect chạy 2 lần; đặt sau → không bao giờ chạy; cùng transaction → an toàn. Đây là dual-write problem bên trong consumer.
- Side effect bên ngoài (email, SMS) không chung transaction được: gửi → ghi `(order_id,'sms')` → XACK. Crash giữa gửi và ghi = gửi trùng = **at-least-once**. Nếu provider có idempotency key thì dedupe chuyển sang phía provider.
- `points = points + 10` là delta → không idempotent → bắt buộc phải dedupe.

**Khi nào không dùng Streams** (Valkey là in-memory DB):
1. Durability: mặc định chỉ có RDB snapshot; AOF `everysec` vẫn có thể mất khoảng 1s; replication async.
2. Retention dài tốn RAM, không có compaction. → Kafka.
3. 1 stream = 1 key = 1 node; muốn shard phải tự làm. → Kafka partitions.
4. Routing phức tạp. → RabbitMQ.
5. **Không dùng chung instance với cache:** cache cần `allkeys-lru`, stream cần `noeviction`, mà một instance chỉ có một policy. Đây là lý do ADR 0007 loại Valkey (cache và queue phải ở hai failure domain riêng).

Chọn công cụ: báo bếp trong 1s, 10k/ngày, đã có Valkey riêng → Streams. Giữ 90 ngày để rebuild read model → Kafka (RabbitMQ xóa message sau khi ack; Streams tốn RAM).

## 2026-10-19 · Stress test: trước, sau, và scale theo gì
_week 1 · node · source: ask · tags: load-testing, capacity-planning, littles-law, right-sizing, k6 · nb: e0aab6fb-6824-473f-b4c6-69940457938e_

Stress test là một thí nghiệm. **Trước:** SLO pass/fail, baseline lúc không tải, load profile thật (req/s, tỉ lệ đọc/ghi, nhiễu như cache miss và request lỗi), **open model** (bắn theo rate, không chờ response, nếu không hàng đợi bị giữ ngắn giả tạo, DDIA ch.1), và một giả thuyết ghi ra trước ("ở X req/s, Y nghẽn trước"). **Sau:** vẽ throughput và p99 theo tải tăng dần, tìm **knee** (p99 dựng đứng, throughput đi ngang). Lúc đó chỉ **một** resource chạm trần, và chỉ resource đó đáng để dự báo capacity.

- Scale theo bottleneck: app stateless → scale out; DB quá tải vì đọc → cache/replica; DB quá tải vì ghi → scale up rồi mới shard.
- Little's Law `L = λ × W`: 8,166 req/s × 11.4ms ≈ 93 request đang xử lý. Downstream chậm gấp đôi thì L gấp đôi dù req/s không đổi.
- Saturation cao mà utilization vừa phải = contention ở pool (tăng pool, chưa cần thêm máy). p99/error tăng mà req/s đứng yên = hết capacity.
- Right-size bằng cách giảm **đến khi gãy** rồi lùi lại (heap: 50MB crash, 75MB chạy được, chọn 100MB). Idle memory không phải requirement.
- Áp vào repo: `load/redirect.js` đang dùng `ramping-vus` (closed model) và chỉ gọi một short code (~100% cache hit) → p99 41.65ms là trần của cache path, không phải của cả service.
