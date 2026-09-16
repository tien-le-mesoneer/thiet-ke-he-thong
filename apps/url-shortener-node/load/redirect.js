import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: { redirects: { executor: "ramping-vus", startVUs: 0,
    stages: [ { duration: "30s", target: 50 }, { duration: "1m", target: 200 }, { duration: "30s", target: 0 } ] } },
  thresholds: { http_req_duration: ["p(99)<50"] }, // p99 < 50ms redirect target
};

const BASE = __ENV.BASE || "http://localhost:3001";

export function setup() {
  const res = http.post(`${BASE}/api/v1/urls`, JSON.stringify({ longUrl: "https://example.com/loadtest" }),
    { headers: { "Content-Type": "application/json" } });

  // Fail loudly. If this POST errors and we carry on, `code` is undefined,
  // every VU requests /undefined, and the run measures the 404 path while
  // still reporting a p99 against a 302 threshold that was never exercised.
  // That happened on 2026-08-24 and the numbers looked plausible enough to
  // believe. A load test that crashes is far better than one that lies.
  const code = res.status === 201 || res.status === 200 ? res.json("code") : null;
  if (!code) {
    throw new Error(
      `setup failed: POST /api/v1/urls returned ${res.status} — ${String(res.body).slice(0, 200)}`,
    );
  }
  return { code };
}

export default function (data) {
  const res = http.get(`${BASE}/${data.code}`, { redirects: 0 });
  check(res, { "is 302": (r) => r.status === 302 });
}
