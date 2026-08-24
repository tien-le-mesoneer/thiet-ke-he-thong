import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  PeriodicExportingMetricReader,
  View,
  ExplicitBucketHistogramAggregation,
} from "@opentelemetry/sdk-metrics";

/**
 * Latency histogram buckets, in SECONDS.
 *
 * 0.05 is load-bearing: the SLO is "99% of redirects under 50 ms", and a
 * latency SLI is counted, not averaged — good / total, where good is the
 * bucket count at or below the threshold. Without a boundary exactly at the
 * threshold the SLI is not computable, only interpolatable, and an
 * interpolated error budget is a fiction. Do not remove it.
 */
export const LATENCY_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1] as const;

/** The SLO threshold, and therefore a required bucket boundary. */
export const SLO_THRESHOLD_S = 0.05;

// Traces and metrics both leave over OTLP to the Collector (see
// infra/observability, host port 7318). Starts only when OTEL_ENABLED=1, so
// tests and plain `npm run dev` carry no OTel overhead at all.
export function startOtel(): void {
  if (process.env["OTEL_ENABLED"] !== "1") return;
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 10_000,
    }),
    views: [
      new View({
        instrumentName: "http_request_duration_seconds",
        aggregation: new ExplicitBucketHistogramAggregation(
          [...LATENCY_BUCKETS_S],
          true, // keep min/max, cheap and useful for spotting the extreme tail
        ),
      }),
    ],
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

// Side-effect: importing this module (e.g. via `--import`/preload) starts the
// SDK immediately, before any instrumented module (fastify, mongodb, ioredis)
// loads. This ordering also matters for metrics: metrics.getMeter() binds to
// whatever provider is global AT CALL TIME and does not re-bind later, so the
// SDK must be running before ./metrics.js is imported. Still a no-op unless
// OTEL_ENABLED=1 — in which case the meter is a no-op and nothing is recorded.
startOtel();
