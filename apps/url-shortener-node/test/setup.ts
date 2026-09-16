// Preloaded via --import before any test file loads.
//
// These tests talk to a real MongoDB and a real Redis — there are no mocks for
// the data layer. That is deliberate (Testcontainers-style fidelity without the
// container overhead), but it means a misconfigured run writes to whatever
// database the developer happens to be using.
//
// It has bitten us: on 2026-08-24 a test run reset the `counters` collection in
// the dev database while leaving `links` populated. Because short codes are
// derived deterministically from that counter, the app then re-issued codes
// that already existed, and the next insert died with
// `E11000 duplicate key error ... index: short_code_1`. A k6 run picked up the
// damage minutes later and silently measured the 404 path.
//
// So: refuse to start unless both URLs point somewhere disposable.

const mongoUrl = process.env["MONGO_URL"] ?? "";
const redisUrl = process.env["REDIS_URL"] ?? "";

function die(what: string, value: string, expected: string): never {
  throw new Error(
    `Refusing to run tests: ${what} is ${value || "unset"}.\n` +
      `  Expected ${expected}.\n` +
      `  Tests destroy data. Run them via \`npm test\`, which sets both.`,
  );
}

// Database name must end in _test — mongodb://host:port/<name>[?opts]
const mongoDbName = mongoUrl.split("/").pop()?.split("?")[0] ?? "";
if (!mongoDbName.endsWith("_test")) {
  die("MONGO_URL", mongoUrl, "a database name ending in `_test`");
}

// Redis has no names, only numbered databases. db 0 is the default a dev app
// uses, so tests must be anywhere else.
const redisDb = redisUrl.split("/").pop() ?? "";
if (!/^[1-9][0-9]*$/.test(redisDb)) {
  die("REDIS_URL", redisUrl, "an explicit non-zero database index, e.g. redis://localhost:6379/1");
}
