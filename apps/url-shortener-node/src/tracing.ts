import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

// Console exporter by default; swap for OTLP when a collector exists.
// Start only when OTEL_ENABLED=1 so tests/dev stay quiet.
export function startTracing(): void {
  if (process.env["OTEL_ENABLED"] !== "1") return;
  const sdk = new NodeSDK({
    traceExporter: new tracing.ConsoleSpanExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

// Side-effect: importing this module (e.g. via `--import`/preload) starts
// tracing immediately, before any instrumented module (fastify, mongodb,
// ioredis) is loaded. Still a no-op unless OTEL_ENABLED=1.
startTracing();
