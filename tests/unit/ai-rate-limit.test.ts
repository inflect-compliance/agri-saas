/**
 * AI completion rate limit — unit tests (in-memory fallback path).
 */
import { makeRequestContext } from '../helpers/make-context';

// Force the memory-fallback path (no Upstash) + a low limit for the test.
jest.mock('@/env', () => ({
    env: {
        RATE_LIMIT_MODE: 'memory',
        AI_RATE_LIMIT_PER_MIN: 3,
    },
}));

import { assertAiRateLimit } from '@/lib/rate-limit/aiRateLimit';
import { clearAllRateLimits } from '@/lib/security/rate-limit';
import { RateLimitedError } from '@/lib/errors/types';

const ctx = makeRequestContext('ADMIN', { tenantId: 't-rl', userId: 'u-rl' });

const ORIG = { ...process.env };

beforeEach(() => {
    clearAllRateLimits();
    process.env = { ...ORIG };
});
afterAll(() => {
    process.env = ORIG;
});

describe('assertAiRateLimit', () => {
    it('honours bypass in test mode (no enforcement by default)', async () => {
        // NODE_ENV=test → isRateLimitBypassed() returns true unless
        // RATE_LIMIT_ENABLED=1. Many calls, never throws.
        for (let i = 0; i < 10; i++) {
            await expect(assertAiRateLimit(ctx)).resolves.toBeUndefined();
        }
    });

    it('throws RateLimitedError (429) once the per-minute budget is exceeded', async () => {
        // Opt OUT of the test-mode bypass so enforcement runs.
        process.env.RATE_LIMIT_ENABLED = '1';
        process.env.AUTH_TEST_MODE = '0';
        process.env.NEXT_TEST_MODE = '0';

        // limit is 3/min → first 3 pass, 4th throws.
        await assertAiRateLimit(ctx);
        await assertAiRateLimit(ctx);
        await assertAiRateLimit(ctx);
        await expect(assertAiRateLimit(ctx)).rejects.toBeInstanceOf(RateLimitedError);
        await expect(assertAiRateLimit(ctx)).rejects.toThrow(/ai_rate_limited/);
    });

    it('buckets per (tenant, user) — a different user has its own budget', async () => {
        process.env.RATE_LIMIT_ENABLED = '1';
        process.env.AUTH_TEST_MODE = '0';
        process.env.NEXT_TEST_MODE = '0';

        const other = makeRequestContext('ADMIN', { tenantId: 't-rl', userId: 'u-other' });
        // Exhaust ctx's budget.
        await assertAiRateLimit(ctx);
        await assertAiRateLimit(ctx);
        await assertAiRateLimit(ctx);
        await expect(assertAiRateLimit(ctx)).rejects.toBeInstanceOf(RateLimitedError);
        // The other user is unaffected.
        await expect(assertAiRateLimit(other)).resolves.toBeUndefined();
    });
});
