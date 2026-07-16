import { Registry, Histogram, Counter, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpLatency = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1], // p99-friendly
  registers: [registry],
});
export const cacheHits = new Counter({ name: "cache_hits_total", help: "redirect cache hits", registers: [registry] });
export const cacheMisses = new Counter({ name: "cache_misses_total", help: "redirect cache misses", registers: [registry] });
export const idBlocks = new Counter({ name: "id_blocks_total", help: "id blocks allocated", registers: [registry] });
