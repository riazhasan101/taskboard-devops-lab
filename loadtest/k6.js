// Drive the HPA:  k6 run -e BASE=http://taskboard-staging.localtest.me loadtest/k6.js
// Watch in another terminal:  kubectl -n taskboard-staging get hpa,pods -w
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 20 },   // ramp up
    { duration: '4m', target: 60 },   // sustained load -> HPA should add pods
    { duration: '2m', target: 0 },    // ramp down -> scale-down after stabilization window
  ],
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1500'] },
};

const BASE = __ENV.BASE || 'http://localhost:8080';

export default function () {
  const r = http.get(`${BASE}/api/burn?ms=150`);   // CPU-heavy endpoint
  check(r, { 'status 200': (x) => x.status === 200 });
  http.get(`${BASE}/api/tasks`);
  sleep(0.2);
}
