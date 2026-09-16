/* Creates the throwaway test database if it is missing. Run before migrations. */
import pg from "pg";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "";
const url = new URL(DATABASE_URL);
const dbName = url.pathname.slice(1);

// Same guard as test/setup.ts: this script must never touch a dev database.
if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) {
  console.error(`refusing to create ${dbName || "<unset>"}: name must be plain and end in _test`);
  process.exit(1);
}

// CREATE DATABASE cannot run inside the target database, so connect to `postgres`.
const admin = new URL(DATABASE_URL);
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();

const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
if (!rowCount) {
  try {
    // No parameter binding in DDL; the _test guard above is what makes this safe.
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`created ${dbName}`);
  } catch (err) {
    // The compose Postgres makes `app` a superuser, but a pre-existing local
    // server on 5432 shadows it and its `app` role usually cannot create
    // databases. Say so instead of dumping a bare 42501.
    if ((err as { code?: string }).code === "42501") {
      console.error(
        `cannot create ${dbName}: ${url.username} lacks CREATEDB on ${url.host}.\n` +
          `  Create it once as a superuser:  createdb -O ${url.username} ${dbName}`,
      );
      process.exit(1);
    }
    throw err;
  }
}

await client.end();
