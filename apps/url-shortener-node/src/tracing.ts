import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// Exports OTLP to the Collector in infra/observability (default
// http://localhost:4318, overridable via OTEL_EXPORTER_OTLP_ENDPOINT — the
// exporter reads that env var itself and appends /v1/traces).
// Start only when OTEL_ENABLED=1 so tests/dev stay quiet.
export function startTracing(): void {
  if (process.env["OTEL_ENABLED"] !== "1") return;
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

// Side-effect: importing this module (e.g. via `--import`/preload) starts
// tracing immediately, before any instrumented module (fastify, mongodb,
// ioredis) is loaded. Still a no-op unless OTEL_ENABLED=1.
startTracing();
