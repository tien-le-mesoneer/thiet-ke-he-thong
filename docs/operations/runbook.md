# Runbook

How to start, check, and stop the stack, and the traps that have each cost real
time. Service-specific detail stays in each area's `README.md` and `CLAUDE.md`.

## Start

```bash
podman machine start                                           # if stopped
podman network create sd-net                                   # once, ever
podman compose -f infra/observability/compose.yaml up -d       # telemetry first
podman compose -f apps/url-shortener-node/compose.yaml up -d   # app + mongo + redis
podman compose -f apps/deliveroo-node/compose.yaml up -d       # app + postgres
```

Start observability first: url-shortener exports to `otel-collector:4318` and
logs export errors until the Collector exists.

## Check it's working

| Check | Command or URL | Healthy |
|---|---|---|
| url-shortener | `curl -s localhost:3001/health` | `{"status":"ok"}` |
| deliveroo | `curl -s localhost:3000/health` | `{"status":"ok"}` |
| Collector | `curl -s localhost:7133` | `Server available` |
| Prometheus targets | http://localhost:7090/targets | `otel-collector-apps` and `-self` UP |
| Tempo | `curl -s localhost:7200/ready` | `ready` (takes 30–60 s after start) |
| Grafana | http://localhost:7080 | dashboards under *Dashboards* |
| End to end | shorten a URL, hit the redirect, then look for `service.name=url-shortener` in Tempo | a trace with HTTP → MongoDB spans |

## Test

```bash
# unit + integration — each needs its own datastores running
(cd apps/url-shortener-node && npm test)   # uses shorturl_test + redis db 1
(cd apps/deliveroo-node && npm test)       # uses deliveroo_test

# load test url-shortener — two terminals, both in apps/url-shortener-node
npm run load:otel                          # starts the app: no watch, 10% trace sampling
k6 run load/redirect.js                    # ramps to 200 VUs; threshold p(99)<50 = the SLO
```

## Stop

```bash
podman compose -f apps/url-shortener-node/compose.yaml down
podman compose -f apps/deliveroo-node/compose.yaml down
podman compose -f infra/observability/compose.yaml down
podman machine stop
```

`down` keeps named volumes. Add `-v` only if you mean to wipe data.

## Traps

| Symptom | Cause | Fix |
|---|---|---|
| Code change has no effect in a container | `podman compose up -d --build` reuses the existing **container** | `podman rm -f <c>` first; verify with `podman exec <c> grep -c <marker> <file>` |
| Sampler / OTLP endpoint ignored | `tsx watch` doesn't pass env to the process it respawns | use `load:otel` or `container:otel`, not `dev:otel` |
| Every panel reads `n/a` | Collector or Tempo isn't running | `podman ps`; restart observability |
| `increase()` shows 0 on a fresh series | needs two samples in the window | wait one scrape interval before concluding anything |
| Counter doubled after a restart | Prometheus keeps the dead instance's series ~5 min | use `increase(...[5m])`, not `sum()` |
| deliveroo tests hit the wrong DB | Homebrew Postgres owns 5432 | the container is on **5433** |
| Mongo killed during tests | WiredTiger sized its cache from host RAM | keep `--wiredTigerCacheSizeGB 0.25` |
| Prometheus has a permanently DOWN job | a temporary stack left its file in `prometheus/scrape/` | delete the file, restart Prometheus |
| Tests "hang" | Redis or Mongo is stopped | start the app's compose file |
| `podman`, `git push`, `curl localhost` fail inside Claude Code | the sandbox blocks the socket / SSH / local network | these need `dangerouslyDisableSandbox`; manage with `/sandbox` |

## Incidents and game-days

Write them up in [`postmortems/`](postmortems/) as `YYYY-MM-DD-slug.md`:
hypothesis written **before** the run, what happened, what the telemetry saw,
the fixes, and what was wrong with the process.
