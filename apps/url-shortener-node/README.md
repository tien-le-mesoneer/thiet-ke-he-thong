# url-shortener-node

Practice project for the system design study plan (see `docs/`) — DDIA ch.1 scalability/maintainability practice: a URL shortener service, built full-scale (cache, ranged ID allocation, shard-routing seam, metrics/tracing) to learn how each piece earns its keep. See `document.md` for the full service doc.

## Stack

Node 22 + TypeScript + Fastify + MongoDB + Redis. Containers via **Podman**.

## Setup

```sh
# 1. start mongo + redis
podman compose up -d

# 2. install deps
npm install

# 3. run
npm run dev
curl localhost:3001/health
```

## Try it

```sh
# shorten
curl -s -X POST localhost:3001/api/v1/urls \
  -H 'Content-Type: application/json' \
  -d '{"longUrl":"https://example.com/some/long/path"}'
# → 201 {"code":"abc1234","shortUrl":"http://localhost:3001/abc1234"}

# redirect
curl -si localhost:3001/abc1234
# → 302 Location: https://example.com/some/long/path

# stats
curl -s localhost:3001/api/v1/urls/abc1234
# → 200 {"shortCode":"abc1234","longUrl":"...","clickCount":3,"createdAt":"...","expiresAt":"...","owner":null}
```

## Test

```sh
npm test              # unit + integration + concurrency
npm run dev:otel      # dev, with OTel console tracing enabled
```

## Configuration

| Env var          | Default                              | Meaning                                  |
|-------------------|---------------------------------------|-------------------------------------------|
| `PORT`             | `3001`                                 | HTTP listen port                          |
| `MONGO_URL`        | `mongodb://localhost:27017/shorturl`   | Mongo connection string                   |
| `REDIS_URL`        | `redis://localhost:6379`               | Redis connection string                   |
| `ID_BLOCK_SIZE`    | `1000`                                 | Ids claimed per counter refill            |
| `CODE_MIN_LENGTH`  | `7`                                     | Minimum short-code length                 |
| `CACHE_TTL_S`      | `86400`                                 | Redirect cache TTL (seconds)              |
| `LINK_TTL_DAYS`    | `7`                                      | Link expiry (days), enforced by Mongo TTL index |
| `LOG_LEVEL`        | `info`                                  | pino log level                            |
| `OTEL_ENABLED`     | unset                                   | `1` enables OTel tracing (`dev:otel`/`start:otel`) |