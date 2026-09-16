// Preloaded via --import before any test file loads.
//
// These tests talk to a real Postgres — there are no mocks for the data layer.
// That is deliberate (real transactions, real enum constraints, real row locks
// are the whole point of Weeks 2–3), but it means a misconfigured run truncates
// whatever database the developer happens to be using. The sibling
// `url-shortener-node` learned this the hard way on 2026-08-24, when a test run
// wiped a collection out from under the dev app.
//
// So: refuse to start unless DATABASE_URL points somewhere disposable.

const databaseUrl = process.env["DATABASE_URL"] ?? "";

// postgres://user:pass@host:port/<name>[?opts]
const dbName = databaseUrl.split("/").pop()?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL is ${databaseUrl || "unset"}.\n` +
      `  Expected a database name ending in \`_test\`.\n` +
      `  Tests truncate tables. Run them via \`npm test\`, which sets it.`,
  );
}
