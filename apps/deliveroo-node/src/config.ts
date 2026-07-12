export const config = {
  port: Number(process.env["PORT"] ?? 3000),
  databaseUrl:
    process.env["DATABASE_URL"] ?? "postgres://app:app@localhost:5432/deliveroo",
  logLevel: process.env["LOG_LEVEL"] ?? "info",
} as const;
