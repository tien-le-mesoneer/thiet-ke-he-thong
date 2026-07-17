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
  return { code: res.json("code") };
}

export default function (data) {
  const res = http.get(`${BASE}/${data.code}`, { redirects: 0 });
  check(res, { "is 302": (r) => r.status === 302 });
}
