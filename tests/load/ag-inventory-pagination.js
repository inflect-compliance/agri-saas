// k6 load-test scenario — authenticated inventory-lot cursor pagination
// baseline ("ag-inventory-pagination").
//
// Each VU logs in once at iteration 0 and reuses the resulting
// session-token cookie (carried automatically by the per-VU jar)
// for all subsequent iterations, so we measure the steady-state
// paged-read path rather than the cold login path. (auth.js covers
// the cold-login throughput separately.)
//
// Design profile: "10 operators × 10k-lot location, p95<500ms". The
// realistic access pattern is an operator scrolling a large field's
// inventory page-by-page, so each iteration WALKS THE CURSOR:
//
//   GET /api/t/{slug}/inventory/lots?limit=50
//     → { items, pageInfo: { nextCursor, hasNextPage } }
//   while hasNextPage (up to ~3 pages):
//     GET /api/t/{slug}/inventory/lots?limit=50&cursor={nextCursor}
//
// The cursor-page walk is what an operator paging a 10k-lot field
// actually does; the p95<500ms budget below gates the per-request
// latency of that walk. CI runs it at VUS=10 / 30s against the seed
// — so the threshold mechanism gates without needing 10k seeded rows
// (the small seed just won't fill the full 3-page walk every time).
//
// Requires the INVENTORY module (enabled by default for the seed
// tenant `acme-corp`).
//
// Run staged baselines:
//   k6 run -e VUS=10  -e DURATION=2m tests/load/ag-inventory-pagination.js
//   k6 run -e VUS=50  -e DURATION=2m tests/load/ag-inventory-pagination.js
//   k6 run -e VUS=100 -e DURATION=2m tests/load/ag-inventory-pagination.js
//
// See tests/load/README.md for running against a heavier seed.

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { textSummary } from './vendor/k6-summary.js';
import { loadConfig } from './lib/config.js';
import { login } from './lib/auth.js';

const cfg = loadConfig();

// Page size per request and the max pages a single VU iteration walks
// — a realistic operator paging through a large field's lot list.
const PAGE_SIZE = 50;
const MAX_PAGES = 3;

// Per-endpoint counters so the summary breaks throughput out by surface.
const lotsRequests = new Counter('inventory_lots_requests');
const listSuccessRate = new Rate('list_success_rate');

// Per-VU module state — k6 loads each module once per VU init, so a
// top-level `let` is effectively a per-VU singleton. Used to gate the
// once-per-VU login.
let loggedIn = false;

export const options = {
    scenarios: {
        inventory_pagination_baseline: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: cfg.rampUp, target: cfg.vus },
                { duration: cfg.duration, target: cfg.vus },
                { duration: cfg.rampDown, target: 0 },
            ],
            gracefulRampDown: '30s',
            gracefulStop: '30s',
        },
    },
    thresholds: {
        // Read-path error budget. Anything above 1% is a real problem.
        'http_req_failed{type:list}': ['rate<0.01'],

        // THE ag-inventory-pagination p95<500ms budget — the per-request
        // latency of a cursor-page walk over a large lot list. p99 caps
        // the long tail so a slow-path regression also fails CI.
        'http_req_duration{endpoint:inventory_lots}': ['p(95)<500', 'p(99)<1500'],

        // Aggregate success rate across every paged request.
        list_success_rate: ['rate>0.99'],

        // Per-endpoint check rate.
        'checks{check:inventory_lots_ok}': ['rate>0.99'],

        // Login-step health (gate the warm-up, not the steady state).
        'http_req_failed{step:login}': ['rate<0.05'],
    },
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    discardResponseBodies: false,
};

// One paged GET against the lots endpoint. Tags + checks every request
// uniformly so the threshold covers the whole cursor walk. Returns the
// nextCursor if the page reports hasNextPage, else null.
function fetchLotsPage(base, cursor) {
    const url = cursor
        ? `${base}/inventory/lots?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
        : `${base}/inventory/lots?limit=${PAGE_SIZE}`;
    const r = http.get(url, {
        tags: { type: 'list', endpoint: 'inventory_lots' },
    });
    const ok = check(
        r,
        {
            'inventory_lots 200': (res) => res.status === 200,
            'inventory_lots items is array': (res) => {
                try {
                    const body = res.json();
                    return Array.isArray(body.items);
                } catch (_e) {
                    return false;
                }
            },
        },
        { check: 'inventory_lots_ok' },
    );
    lotsRequests.add(1);
    listSuccessRate.add(ok);

    if (!ok) return null;
    try {
        const body = r.json();
        if (body.pageInfo && body.pageInfo.hasNextPage) {
            return body.pageInfo.nextCursor || null;
        }
    } catch (_e) {
        return null;
    }
    return null;
}

export default function inventoryPaginationIteration() {
    // ── Per-VU one-time login ──
    if (!loggedIn) {
        const ok = login(cfg);
        if (!ok) {
            // No point in this VU walking the cursor without a session
            // — let the iteration return so the threshold on
            // login_failed picks it up rather than spamming 401s.
            sleep(1);
            return;
        }
        loggedIn = true;
    }

    // Use the per-VU default jar — it now carries the session cookie
    // from the login call above and will attach it to every request.
    const base = `${cfg.baseUrl}/api/t/${cfg.tenant}`;

    group('inventory:lots-cursor-walk', () => {
        // Walk the cursor: first page, then follow nextCursor for up to
        // MAX_PAGES total — simulating an operator paging a large field.
        let cursor = null;
        for (let page = 0; page < MAX_PAGES; page++) {
            cursor = fetchLotsPage(base, cursor);
            if (!cursor) break;
        }
    });

    // 250ms think-time per iteration. With 10 VUs this keeps the cursor
    // walk at an operator-realistic cadence. Tune via DURATION or by
    // adjusting this sleep if you want sharper or softer load.
    sleep(0.25);
}

export function handleSummary(data) {
    return {
        stdout: textSummary(data, { indent: ' ', enableColors: true }),
        'tests/load/results/ag-inventory-pagination-summary.json': JSON.stringify(data, null, 2),
    };
}
