import type { FastifyInstance } from "fastify";
import { createUser, getUser } from "./service.js";

interface CreateUserBody {
  email: string;
  name: string;
}

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateUserBody }>("/", async (req, reply) => {
    const user = await createUser(req.body);
    return reply.code(201).send(user);
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const user = await getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: "user not found" });
    return user;
  });
}
