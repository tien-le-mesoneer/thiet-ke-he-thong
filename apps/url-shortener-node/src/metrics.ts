import { metrics } from "@opentelemetry/api";

// Bound to whichever MeterProvider is global when this module first loads.
// With OTEL_ENABLED unset no provider is registered, so every instrument below
// is a no-op — that is the intended zero-overhead default, not a failure.
const meter = metrics.getMeter("url-shortener");

export const httpLatency = meter.createHistogram("http_request_duration_seconds", {
  description: "HTTP request latency",
  unit: "s",
});

export const cacheHits = meter.createCounter("cache_hits_total", {
  description: "redirect cache hits",
});

export const cacheMisses = meter.createCounter("cache_misses_total", {
  description: "redirect cache misses",
});

export const idBlocks = meter.createCounter("id_blocks_total", {
  description: "id blocks allocated",
});
