# <Topic> — timed attempt

- **Date:** YYYY-MM-DD · **Start:** HH:MM · **End:** HH:MM
- **Rules:** 45 min, cold, no help. Fill every heading, even with one line —
  an empty section scores zero, a thin one scores something.

---

## 1. Requirements · ~5 min

**Functional** — what the system does (verbs):
-

**Non-functional** — with numbers where you can:
- Scale:
- Latency:
- Availability / durability:
- Consistency:

**Out of scope** — what you're deliberately not designing:
-

## 2. Capacity estimates · ~5 min

Show the arithmetic, not just the answer. Round hard.

| Quantity | Working | Result |
|---|---|---|
| Average QPS | | |
| Peak QPS | | |
| Storage / year | | |
| Bandwidth | | |

**What the numbers tell you** (one line — does anything here force a design choice?):

## 3. API · ~3 min

External and internal interfaces. Signature + one-line purpose.

```
METHOD /path          → response     # purpose
```

## 4. Data model · ~3 min

```
table_or_collection(field, field, …)   -- key / index notes
```

**Storage choice and why** (one line):

## 5. High-level design · ~9 min

```mermaid
flowchart LR
  A[box] --> B[box]
```

**Walk one request through it** (3–5 numbered steps):
1.

## 6. Deep dive · ~15 min

Pick the 2–3 parts that are genuinely hardest. For each: the problem, your
answer, and what goes wrong with the obvious answer.

### 6a.

### 6b.

### 6c. (optional)

One sequence **or** state diagram belongs here, for whichever part is hardest.

## 7. Bottlenecks & trade-offs · ~5 min

| Bottleneck / risk | What happens | Mitigation | Cost of the mitigation |
|---|---|---|---|
| | | | |

**What you'd change at 10× the load:**

---

## Self-check before saying "done" (30 seconds)

- [ ] Every section has something in it
- [ ] Guarantees are **named** (at-most-once, at-least-once, exactly-once…), not described
- [ ] Every "retry" says what stops it retrying forever
- [ ] Every trade-off names what you gave up
