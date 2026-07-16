import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

// Console exporter by default; swap for OTLP when a collector exists.
// Start only when OTEL_ENABLED=1 so tests/dev stay quiet.
export function startTracing(): void {
  if (process.env["OTEL_ENABLED"] !== "1") return;
  const sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] });
  sdk.start();
}
