/**
 * Unit Test: Epic A.3 progressive rate-limit primitive.
 *
 * Pins the three-tier escalation contract from LOGIN_PROGRESSIVE_POLICY:
 *   1 — 2 failures:  no delay
 *   3 — 4 failures:  5s delay
 *   5 — 9 failures:  30s delay
 *   10 failures:     hard lockout (15 min)
 *
 * Plus:
 *   - reset clears the counter (success path)
 *   - lockout auto-expires and then permits the next attempt with zero delay
 *   - failures older than windowMs age out
 *   - concurrent keys are independent
 *
 * The primitive is now distributed-first (Roadmap-5 PR1): with no Upstash env
 * configured (the test default) it uses the in-process Map, so the semantics
 * asserted here are the fallback path — identical to before, just async.
 */

import {
    evaluateProgressiveRateLimit,
    recordProgressiveFailure,
    resetProgressiveFailures,
    clearAllRateLimits,
    LOGIN_PROGRESSIVE_POLICY,
    type ProgressiveRateLimitPolicy,
} from '@/lib/security/rate-limit';

describe('Progressive rate-limit primitive', () => {
    beforeEach(() => {
        clearAllRateLimits();
    });

    describe('LOGIN_PROGRESSIVE_POLICY tiers', () => {
        it('no delay for the first 2 failures', async () => {
            const k = 'user-a';
            // Pre-check before any failure: zero.
            expect(await evaluateProgressiveRateLimit(k, LOGIN_PROGRESSIVE_POLICY)).toMatchObject({
                allowed: true,
                delayMs: 0,
                failureCount: 0,
            });
            // After 1 failure.
            expect(await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY)).toMatchObject({
                allowed: true,
                delayMs: 0,
                failureCount: 1,
            });
            // After 2 failures.
            expect(await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY)).toMatchObject({
                allowed: true,
                delayMs: 0,
                failureCount: 2,
            });
        });

        it('applies 5s delay after the 3rd failure', async () => {
            const k = 'user-b';
            for (let i = 0; i < 3; i++) {
                await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY);
            }
            const decision = await evaluateProgressiveRateLimit(
                k,
                LOGIN_PROGRESSIVE_POLICY,
            );
            expect(decision.allowed).toBe(true);
            expect(decision.delayMs).toBe(5_000);
            expect(decision.failureCount).toBe(3);
        });

        it('still 5s at 4 failures (tier 1 covers 3–4)', async () => {
            const k = 'user-c';
            for (let i = 0; i < 4; i++) {
                await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY);
            }
            expect(
                (await evaluateProgressiveRateLimit(k, LOGIN_PROGRESSIVE_POLICY)).delayMs,
            ).toBe(5_000);
        });

        it('escalates to 30s at 5 failures', async () => {
            const k = 'user-d';
            for (let i = 0; i < 5; i++) {
                await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY);
            }
            expect(
                (await evaluateProgressiveRateLimit(k, LOGIN_PROGRESSIVE_POLICY)).delayMs,
            ).toBe(30_000);
        });

        it.each([5, 6, 7, 8, 9])(
            'stays at 30s through failure %i',
            async (count) => {
                const k = `user-${count}`;
                for (let i = 0; i < count; i++) {
                    await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY);
                }
                expect(
                    (await evaluateProgressiveRateLimit(k, LOGIN_PROGRESSIVE_POLICY))
                        .delayMs,
                ).toBe(30_000);
            },
        );

        it('locks out at 10 failures with retryAfterSeconds ≥ 1', async () => {
            const k = 'user-locked';
            for (let i = 0; i < 10; i++) {
                await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY);
            }
            const decision = await evaluateProgressiveRateLimit(
                k,
                LOGIN_PROGRESSIVE_POLICY,
            );
            expect(decision.allowed).toBe(false);
            expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
            expect(decision.failureCount).toBe(10);
        });

        it('reports retryAfterSeconds ≤ lockoutMs in seconds (15 * 60)', async () => {
            const k = 'user-locked-duration';
            for (let i = 0; i < 10; i++) {
                await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY);
            }
            const decision = await evaluateProgressiveRateLimit(
                k,
                LOGIN_PROGRESSIVE_POLICY,
            );
            expect(decision.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
        });
    });

    describe('reset + isolation', () => {
        it('resetProgressiveFailures clears the counter', async () => {
            const k = 'user-reset';
            for (let i = 0; i < 5; i++) {
                await recordProgressiveFailure(k, LOGIN_PROGRESSIVE_POLICY);
            }
            await resetProgressiveFailures(k);
            expect(
                await evaluateProgressiveRateLimit(k, LOGIN_PROGRESSIVE_POLICY),
            ).toMatchObject({ allowed: true, delayMs: 0, failureCount: 0 });
        });

        it('separate keys have independent counters', async () => {
            for (let i = 0; i < 10; i++) {
                await recordProgressiveFailure('alice', LOGIN_PROGRESSIVE_POLICY);
            }
            expect(
                (await evaluateProgressiveRateLimit('alice', LOGIN_PROGRESSIVE_POLICY))
                    .allowed,
            ).toBe(false);
            expect(
                await evaluateProgressiveRateLimit('bob', LOGIN_PROGRESSIVE_POLICY),
            ).toMatchObject({ allowed: true, failureCount: 0 });
        });
    });

    describe('lockout expiry', () => {
        it('after the lockout window elapses, the counter resets to zero', async () => {
            // Margins large enough to survive OS-descheduling jitter between the
            // async calls under a loaded CI machine (the functions read the real
            // clock; 300ms lockout + 600ms wait leaves comfortable slack).
            const policy: ProgressiveRateLimitPolicy = {
                tiers: [{ atFailures: 2, delayMs: 1 }],
                lockoutAtFailures: 3,
                lockoutMs: 300,
                windowMs: 60_000,
            };
            const k = 'u-expire';
            for (let i = 0; i < 3; i++) await recordProgressiveFailure(k, policy);
            expect((await evaluateProgressiveRateLimit(k, policy)).allowed).toBe(false);

            await new Promise<void>((resolve) => setTimeout(resolve, 600));
            const decision = await evaluateProgressiveRateLimit(k, policy);
            expect(decision.allowed).toBe(true);
            expect(decision.delayMs).toBe(0);
            expect(decision.failureCount).toBe(0);
        });
    });

    describe('window expiry', () => {
        it('failures older than windowMs stop contributing', async () => {
            const policy: ProgressiveRateLimitPolicy = {
                tiers: [{ atFailures: 2, delayMs: 1 }],
                lockoutAtFailures: 5,
                lockoutMs: 60_000,
                windowMs: 300, // rolling window — margin for async jitter
            };
            const k = 'u-window';
            for (let i = 0; i < 3; i++) await recordProgressiveFailure(k, policy);
            expect(
                (await evaluateProgressiveRateLimit(k, policy)).failureCount,
            ).toBe(3);

            await new Promise<void>((resolve) => setTimeout(resolve, 600));
            expect(
                (await evaluateProgressiveRateLimit(k, policy)).failureCount,
            ).toBe(0);
        });
    });
});
