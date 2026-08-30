import { pool } from "../../db.js";

export interface CreateUserInput {
  email: string;
  name: string;
}

export async function createUser(input: CreateUserInput): Promise<unknown> {
  const { rows } = await pool.query(
    "INSERT INTO users.users (email, name) VALUES ($1, $2) RETURNING *",
    [input.email, input.name],
  );
  return rows[0];
}

/** Returns undefined when no such user exists; the route decides the status code. */
export async function getUser(id: string): Promise<unknown | undefined> {
  const { rows } = await pool.query("SELECT * FROM users.users WHERE id = $1", [id]);
  return rows[0];
}
