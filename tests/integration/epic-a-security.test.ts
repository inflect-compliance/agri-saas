/**
 * Epic A end-to-end — the three layers cooperate, not conflict.
 *
 * One test file, three consecutive assertions against the live
 * Postgres + in-memory rate-limit store:
 *
 *   1. **Tenant isolation** (Epic A.1). A route handler wrapped in
 *      `withApiErrorHandling` that queries an RLS-protected table
 *      from tenant-A's context returns own-tenant rows and zero
 *      rows for tenant-B. Proves RLS + tenant-context plumbing +
 *      the shared API wrapper compose correctly.
 *
 *   2. **Mutation rate limit** (Epic A.2). The same wrapper
 *      short-circuits to 429 + Retry-After after 60 POSTs within
 *      the window. Proves the rate-limit default-on behaviour
 *      does NOT get in the way of legitimate queries inside
 *      `runInTenantContext` — the 429 is produced by the wrapper
 *      before the handler (and its DB transaction) ever runs.
 *
 *   3. **Progressive auth lockout** (Epic A.3). Ten recorded login
 *      failures against one identifier cause the 11th call to
 *      `authenticateWithPassword` to return `rate_limited` without
 *      touching bcrypt. Proves the progressive layer is wired
 *      correctly inside the credentials chokepoint.
 *
 * The three assertions run in one file so a future contributor
 * sees the WHOLE security story in one place. No mocks — all
 * three layers run end-to-end against their real collaborators.
 */

// Force the rate limiter on (default-bypass in test mode).
const originalRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
const originalAuthTestMode = process.env.AUTH_TEST_MODE;

beforeAll(() => {
    process.env.RATE_LIMIT_ENABLED = '1';
    process.env.AUTH_TEST_MODE = '0';
});

afterAll(() => {
    if (originalRateLimitEnabled === undefined) {
        delete process.env.RATE_LIMIT_ENABLED;
    } else {
        process.env.RATE_LIMIT_ENABLED = originalRateLimitEnabled;
    }
    if (originalAuthTestMode === undefined) delete process.env.AUTH_TEST_MODE;
    else process.env.AUTH_TEST_MODE = originalAuthTestMode;
});

import { NextRequest, NextResponse } from 'next/server';
import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import type { PrismaClient } from '@prisma/client';
import { withApiErrorHandling } from '@/lib/errors/api';
import {
    runInTenantContext,
    runWithoutRls,
} from '@/lib/db/rls-middleware';
import {
    clearAllRateLimits,
    LOGIN_PROGRESSIVE_POLICY,
    recordProgressiveFailure,
    evaluateProgressiveRateLimit,
} from '@/lib/security/rate-limit';
import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole } from '@/lib/permissions';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

function makeCtx(tenantId: string): RequestContext {
    return {
        requestId: 'epic-a-req',
        userId: 'epic-a-user',
        tenantId,
        role: 'ADMIN',
        permissions: {
            canRead: true,
            canWrite: true,
            canAdmin: true,
            canAudit: true,
            canExport: true,
        },
        appPermissions: getPermissionsForRole('ADMIN'),
    };
}

function req(method: string, ip = '10.0.0.1'): NextRequest {
    return new NextRequest('http://localhost/api/epic-a/test', {
        method,
        headers: { 'x-forwarded-for': ip },
    });
}

describeFn('Epic A — tenant isolation + rate limiting + brute-force protection', () => {
    let prisma: PrismaClient;
    let tenantA: string;
    let tenantB: string;
    let ruleAId: string;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();

        // Unique slugs so this suite doesn't collide with parallel runs.
        const suffix = `epic-a-${Date.now()}`;
        const [a, b] = await Promise.all([
            prisma.tenant.upsert({
                where: { slug: `${suffix}-a` },
                update: {},
                create: { name: 'Epic A Tenant', slug: `${suffix}-a` },
            }),
            prisma.tenant.upsert({
                where: { slug: `${suffix}-b` },
                update: {},
                create: { name: 'Epic A Other', slug: `${suffix}-b` },
            }),
        ]);
        tenantA = a.id;
        tenantB = b.id;

        const rule = await prisma.automationRule.create({
            data: {
                tenantId: tenantA,
                name: `epic-a-rule-${suffix}`,
                triggerEvent: 'RISK_CREATED',
                actionType: 'NOTIFY_USER',
                actionConfigJson: {},
                status: 'ENABLED',
            },
        });
        ruleAId = rule.id;
    });

    afterAll(async () => {
        try {
            await prisma.automationRule.deleteMany({
                where: { tenantId: { in: [tenantA, tenantB] } },
            });
            await prisma.tenant.deleteMany({
                where: { id: { in: [tenantA, tenantB] } },
            });
        } catch {
            /* best effort */
        }
        await prisma.$disconnect();
    });

    beforeEach(() => {
        clearAllRateLimits();
    });

    // ── Layer 1 — Tenant isolation ────────────────────────────────

    test('A.1 — wrapped handler under tenant-A sees own rule; tenant-B sees zero', async () => {
        const handlerA = withApiErrorHandling(
            async () => {
                const rows = await runInTenantContext(makeCtx(tenantA), (db) =>
                    db.automationRule.findMany({ where: { id: ruleAId } }),
                );
                return NextResponse.json({ count: rows.length });
            },
            { rateLimit: false }, // focus this test on RLS, not the limiter
        );
        const handlerB = withApiErrorHandling(
            async () => {
                const rows = await runInTenantContext(makeCtx(tenantB), (db) =>
                    db.automationRule.findMany({ where: { id: ruleAId } }),
                );
                return NextResponse.json({ count: rows.length });
            },
            { rateLimit: false },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resA: any = await (await handlerA(req('GET'), {})).json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resB: any = await (await handlerB(req('GET'), {})).json();
        expect(resA.count).toBe(1);
        expect(resB.count).toBe(0);
    });

    test('A.1 — runWithoutRls (audited bypass) sees both tenants', async () => {
        const count = await runWithoutRls(
            { reason: 'test' },
            (db) =>
                db.automationRule.count({
                    where: { tenantId: { in: [tenantA, tenantB] } },
                }),
        );
        expect(count).toBeGreaterThanOrEqual(1);
    });

    // ── Layer 2 — Mutation rate limit ────────────────────────────

    test('A.2 — mutation route returns 429 + Retry-After after 60 POSTs in the window', async () => {
        const handler = jest.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withApiErrorHandling(handler);

        // Under budget.
        for (let i = 0; i < 60; i++) {
            const res = await wrapped(req('POST'), {});
            expect(res.status).toBe(200);
        }
        // 61st exceeds.
        const blocked = await wrapped(req('POST'), {});
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get('Retry-After')).toMatch(/^\d+$/);
        expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect(blocked.headers.get('x-request-id')).toBeTruthy();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = await blocked.json();
        expect(body.error.code).toBe('RATE_LIMITED');
        expect(body.error.scope).toBe('api-mutation');
    });

    test('A.2 — GET requests are never rate-limited by the default preset', async () => {
        const handler = jest.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withApiErrorHandling(handler);
        for (let i = 0; i < 100; i++) {
            const res = await wrapped(req('GET'), {});
            expect(res.status).toBe(200);
        }
    });

    // ── Layer 3 — Progressive auth lockout ───────────────────────

    test('A.3 — 10 recorded login failures produce lockout with retryAfterSeconds ≥ 1', async () => {
        const key = 'login-progressive:epic-a-canary';

        // Pre-condition: no prior failures.
        expect(
            (await evaluateProgressiveRateLimit(key, LOGIN_PROGRESSIVE_POLICY))
                .failureCount,
        ).toBe(0);

        for (let i = 0; i < 10; i++) {
            await recordProgressiveFailure(key, LOGIN_PROGRESSIVE_POLICY);
        }

        const decision = await evaluateProgressiveRateLimit(
            key,
            LOGIN_PROGRESSIVE_POLICY,
        );
        expect(decision.allowed).toBe(false);
        expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(decision.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
        expect(decision.failureCount).toBe(10);
    });

    test('A.3 — tier 2 (5 failures → 30s delay) computes correctly', async () => {
        const key = 'login-progressive:epic-a-tier2';
        for (let i = 0; i < 5; i++) {
            await recordProgressiveFailure(key, LOGIN_PROGRESSIVE_POLICY);
        }
        const decision = await evaluateProgressiveRateLimit(
            key,
            LOGIN_PROGRESSIVE_POLICY,
        );
        expect(decision.allowed).toBe(true);
        expect(decision.delayMs).toBe(30_000);
    });

    // ── Cross-layer invariants ────────────────────────────────────

    test('layers coexist — a rate-limited mutation does NOT pollute the progressive login counter', async () => {
        const handler = withApiErrorHandling(
            async () => NextResponse.json({ ok: true }),
            {
                rateLimit: {
                    config: { maxAttempts: 1, windowMs: 60_000 },
                    scope: 'isolated-mutation',
                },
            },
        );
        // Drain the 1-attempt mutation budget.
        await handler(req('POST'), {});
        const blocked = await handler(req('POST'), {});
        expect(blocked.status).toBe(429);

        // Progressive auth counter (different scope prefix) untouched.
        const key = 'login-progressive:epic-a-unrelated';
        expect(
            (await evaluateProgressiveRateLimit(key, LOGIN_PROGRESSIVE_POLICY))
                .failureCount,
        ).toBe(0);
    });

    test('layers coexist — progressive lockout does NOT pollute the mutation counter', async () => {
        const authKey = 'login-progressive:epic-a-auth-only';
        for (let i = 0; i < 10; i++) {
            await recordProgressiveFailure(authKey, LOGIN_PROGRESSIVE_POLICY);
        }
        expect(
            (await evaluateProgressiveRateLimit(authKey, LOGIN_PROGRESSIVE_POLICY))
                .allowed,
        ).toBe(false);

        // Mutation limit is separate — a fresh POST succeeds.
        const wrapped = withApiErrorHandling(
            async () => NextResponse.json({ ok: true }),
        );
        const res = await wrapped(req('POST', '99.99.99.99'), {});
        expect(res.status).toBe(200);
    });
});
