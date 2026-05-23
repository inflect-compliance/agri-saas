#!/usr/bin/env node
/**
 * Post-Deploy Smoke Test — safe, non-destructive validation.
 *
 * Verifies that a deployed environment is healthy and serving traffic
 * by hitting only read-only, public endpoints. NEVER mutates data.
 *
 * Endpoints checked:
 *   1. /api/livez   — process liveness (always 200 if Node is up)
 *   2. /api/readyz  — readiness probe  (DB + optional Redis)
 *   3. /api/health  — legacy health    (DB check, deprecated but still active)
 *   4. /login       — login page renders (HTML, status 200)
 *   5. /api/auth/session — auth framework responds (any status)
 *
 * Usage:
 *   node scripts/smoke-prod.mjs                         # default: http://localhost:3000
 *   node scripts/smoke-prod.mjs https://staging.example.com
 *   SMOKE_URL=https://app.example.com node scripts/smoke-prod.mjs
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 *
 * Environment variables:
 *   SMOKE_URL         — base URL to test (overrides argv[2])
 *   SMOKE_TIMEOUT_MS  — per-request timeout in ms (default: 15000)
 *   SMOKE_RETRIES     — number of retry attempts per check (default: 3)
 *   SMOKE_RETRY_DELAY — delay between retries in ms (default: 5000)
 */

const BASE_URL = process.env.SMOKE_URL || process.argv[2] || 'http://localhost:3000';
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT_MS || '15000', 10);
const MAX_RETRIES = parseInt(process.env.SMOKE_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.SMOKE_RETRY_DELAY || '5000', 10);

// ── Helpers ────────────────────────────────────────────────

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single check with retries. Returns structured result.
 *
 * @param {string} name          — human-readable check name
 * @param {string} url           — full URL to fetch
 * @param {function} validate    — (data, response) => boolean
 * @returns {{ name: string, passed: boolean, status: number|null, error: string|null, attempts: number }}
 */
async function check(name, url, validate) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
                redirect: 'manual',
                headers: { 'User-Agent': 'inflect-smoke/1.0' },
            });
            const body = await res.text();
            let data;
            try {
                data = JSON.parse(body);
            } catch {
                data = body;
            }

            const passed = validate(data, res);
            if (passed) {
                return { name, passed: true, status: res.status, error: null, attempts: attempt };
            }

            // Validation failed — retry if we have attempts left
            if (attempt < MAX_RETRIES) {
                await sleep(RETRY_DELAY);
                continue;
            }
            return { name, passed: false, status: res.status, error: 'Validation failed', attempts: attempt };
        } catch (err) {
            if (attempt < MAX_RETRIES) {
                await sleep(RETRY_DELAY);
                continue;
            }
            return { name, passed: false, status: null, error: err.message || String(err), attempts: attempt };
        }
    }
}

// ── Smoke checks ───────────────────────────────────────────

const CHECKS = [
    {
        name: 'Liveness probe (/api/livez)',
        path: '/api/livez',
        validate: (_data, res) => res.status === 200,
    },
    {
        name: 'Readiness probe (/api/readyz)',
        path: '/api/readyz',
        validate: (data, res) => {
            if (res.status !== 200) return false;
            // readyz returns { status: "ready"|"not_ready", checks: { database: { status: "ok" } } }
            return data?.status === 'ready' && data?.checks?.database?.status === 'ok';
        },
    },
    {
        name: 'Health check (/api/health)',
        path: '/api/health',
        validate: (data, res) => {
            if (res.status !== 200) return false;
            return data?.status === 'healthy' && data?.checks?.database?.status === 'ok';
        },
    },
    {
        name: 'Login page (/login)',
        path: '/login',
        validate: (_data, res) => res.status === 200 || res.status === 302,
    },
    {
        name: 'Auth session (/api/auth/session)',
        path: '/api/auth/session',
        validate: (_data, res) => {
            // NextAuth returns 200 with empty/null session for unauthenticated requests.
            // Any response proves the auth framework is functional.
            return res.status === 200;
        },
    },
];

// ── Main ───────────────────────────────────────────────────

async function main() {
    const startTime = Date.now();

    console.log('');
    console.log('═'.repeat(60));
    console.log('  🔍 Post-Deploy Smoke Test');
    console.log(`  Target: ${BASE_URL}`);
    console.log(`  Timeout: ${TIMEOUT_MS}ms | Retries: ${MAX_RETRIES} | Delay: ${RETRY_DELAY}ms`);
    console.log('═'.repeat(60));
    console.log('');

    const results = [];

    for (const { name, path, validate } of CHECKS) {
        const url = `${BASE_URL}${path}`;
        process.stdout.write(`  ${name.padEnd(45)} `);
        const result = await check(name, url, validate);
        results.push(result);

        if (result.passed) {
            const retryNote = result.attempts > 1 ? ` (attempt ${result.attempts})` : '';
            console.log(`✅ ${result.status}${retryNote}`);
        } else {
            console.log(`❌ ${result.error} (HTTP ${result.status || 'N/A'}, ${result.attempts} attempts)`);
        }
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const elapsed = Date.now() - startTime;

    console.log('');
    console.log('═'.repeat(60));
    if (failed === 0) {
        console.log(`  ✅ All ${passed} checks passed (${elapsed}ms)`);
    } else {
        console.log(`  ❌ ${failed}/${results.length} checks FAILED (${elapsed}ms)`);
        console.log('');
        console.log('  Failed checks:');
        for (const r of results.filter((r) => !r.passed)) {
            console.log(`    • ${r.name}: ${r.error}`);
        }
    }
    console.log('═'.repeat(60));
    console.log('');

    // Output JSON summary for CI consumption
    if (process.env.GITHUB_STEP_SUMMARY) {
        const { appendFileSync } = await import('node:fs');
        const summary = [
            `### ${failed === 0 ? '✅' : '❌'} Smoke Test Results`,
            '',
            `| Check | Status | HTTP | Attempts |`,
            `|-------|--------|------|----------|`,
            ...results.map(
                (r) =>
                    `| ${r.name} | ${r.passed ? '✅' : '❌'} | ${r.status || 'N/A'} | ${r.attempts} |`
            ),
            '',
            `**Target:** \`${BASE_URL}\`  `,
            `**Duration:** ${elapsed}ms  `,
            `**Result:** ${passed}/${results.length} passed`,
        ].join('\n');

        appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    }

    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('Smoke test runner crashed:', err);
    process.exit(1);
});
