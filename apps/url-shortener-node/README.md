# url-shortener-node

Practice project for the system design study plan (see `docs/`) — DDIA ch.1 scalability/maintainability practice: a URL shortener service.

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

## Test

```sh
npm test
```
