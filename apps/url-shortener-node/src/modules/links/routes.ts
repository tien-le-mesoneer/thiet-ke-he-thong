import type { FastifyInstance } from "fastify";
import { shorten, resolve, stats, isValidHttpUrl } from "./service.js";

export async function linkRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { longUrl?: string; owner?: string; metadata?: Record<string, unknown> } }>(
    "/api/v1/urls",
    async (req, reply) => {
      const { longUrl, owner, metadata } = req.body ?? {};
      if (!longUrl || !isValidHttpUrl(longUrl) || longUrl.length > 2048) {
        reply.code(400); return { error: "longUrl must be a valid http(s) URL <= 2048 chars" };
      }
      const { code } = await shorten(longUrl, { owner: owner ?? null, metadata: metadata ?? null });
      reply.code(201);
      return { code, shortUrl: `${req.protocol}://${req.host}/${code}` };
    },
  );

  app.get<{ Params: { code: string } }>("/api/v1/urls/:code", async (req, reply) => {
    const doc = await stats(req.params.code);
    if (!doc) { reply.code(404); return { error: "not found" }; }
    return { shortCode: doc.short_code, longUrl: doc.long_url, clickCount: doc.click_count,
      createdAt: doc.created_at, expiresAt: doc.expires_at, owner: doc.owner };
  });

  // Redirect route LAST so it doesn't shadow /api/*.
  app.get<{ Params: { code: string } }>("/:code", async (req, reply) => {
    const url = await resolve(req.params.code);
    if (!url) { reply.code(404); return { error: "not found" }; }
    reply.code(302).header("location", url).send();
  });
}
