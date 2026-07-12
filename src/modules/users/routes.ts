import type { FastifyInstance } from "fastify";
import { pool } from "../../db.js";

interface CreateUserBody {
  email: string;
  name: string;
}

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateUserBody }>("/", async (req, reply) => {
    const { email, name } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO users.users (email, name) VALUES ($1, $2) RETURNING *",
      [email, name],
    );
    return reply.code(201).send(rows[0]);
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { rows } = await pool.query("SELECT * FROM users.users WHERE id = $1", [
      req.params.id,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: "user not found" });
    return rows[0];
  });
}
