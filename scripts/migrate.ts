/* Minimal migration runner: applies migrations/*.sql in filename order, tracks applied ones. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://app:app@localhost:5432/deliveroo";

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);

const dir = join(import.meta.dirname, "..", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const { rowCount } = await client.query("SELECT 1 FROM _migrations WHERE name = $1", [file]);
  if (rowCount) continue;
  const sql = await readFile(join(dir, file), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`applied ${file}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`failed ${file}:`, err);
    process.exit(1);
  }
}

await client.end();
console.log("migrations up to date");
