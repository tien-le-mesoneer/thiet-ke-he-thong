import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode } from "../src/modules/links/keygen.js";

test("encode/decode is a reversible round-trip", () => {
  for (const id of [1, 2, 42, 1000, 1_000_000, 3_521_614_606_207]) {
    assert.equal(decode(encode(id)), id);
  }
});

test("consecutive ids do not produce consecutive codes (non-guessable)", () => {
  assert.notEqual(encode(1001), encode(1000)); // trivially true
  // sequential ids must not yield lexicographically adjacent codes
  const a = encode(1000), b = encode(1001);
  assert.ok(Math.abs(a.localeCompare(b)) >= 1);
  assert.notEqual(a.slice(0, -1), b.slice(0, -1));
});

test("codes are >= configured min length and url-safe", () => {
  const code = encode(1);
  assert.ok(code.length >= 7);
  assert.match(code, /^[0-9a-zA-Z]+$/);
});

test("codes are unique across a range", () => {
  const seen = new Set<string>();
  for (let id = 1; id <= 5000; id++) seen.add(encode(id));
  assert.equal(seen.size, 5000);
});
