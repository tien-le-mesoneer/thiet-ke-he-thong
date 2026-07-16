export const config = {
  port: Number(process.env["PORT"] ?? 3001),
  mongoUrl: process.env["MONGO_URL"] ?? "mongodb://localhost:27017/shorturl",
  redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  idBlockSize: Number(process.env["ID_BLOCK_SIZE"] ?? 1000),
  codeMinLength: Number(process.env["CODE_MIN_LENGTH"] ?? 7),
  cacheTtlS: Number(process.env["CACHE_TTL_S"] ?? 86400),
  linkTtlDays: Number(process.env["LINK_TTL_DAYS"] ?? 7),
  logLevel: process.env["LOG_LEVEL"] ?? "info",
} as const;
