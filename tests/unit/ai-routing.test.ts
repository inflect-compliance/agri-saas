/**
 * AI routing policy — unit tests (mocked providers + entitlements, NO
 * live network).
 *
 * Covers:
 *   (a) routeTask maps each task to the expected tier/backend/model
 *   (b) entitlement gating — FREE plan blocked from a premium tier
 *   (c) timeout / retry / failover — a failing primary fails over to
 *       the secondary target; transient failures retry the same target
 *   (d) caller abort short-circuits retries
 */
import { makeRequestContext } from '../helpers/make-context';

// ─── Mock env so providerForTarget can construct targets ───
jest.mock('@/env', () => ({
    env: {
        ANTHROPIC_API_KEY: 'sk-anthropic',
        ANTHROPIC_BASE_URL: undefined,
        AI_API_KEY: 'k',
        AI_BASE_URL: 'http://localhost:11434/v1',
        AI_EMBED_MODEL: 'nomic-embed-text',
    },
}));

// ─── Mock the entitlement gate ───
const mockAssertAiTierAllowed = jest.fn<Promise<void>, [unknown, string]>();
jest.mock('@/lib/billing/entitlements', () => ({
    assertAiTierAllowed: (ctx: unknown, tier: string) => mockAssertAiTierAllowed(ctx, tier),
    AI_TIER_ORDER: ['cheap', 'standard', 'premium'],
}));

// ─── Mock both providers: capture which target each constructor got
// and let each instance's complete() be driven per test. ───
type Complete = jest.Mock;
const claudeInstances: Array<{ model?: string; complete: Complete }> = [];
const openaiInstances: Array<{ backend?: string; model?: string; complete: Complete }> = [];

/**
 * A FIFO queue of `complete` implementations. Each provider instance,
 * regardless of class, pops the next implementation off this queue at
 * construction time — so a test can script "primary fails, secondary
 * succeeds" deterministically in target order (primary is constructed
 * first, then failover targets as the loop reaches them).
 */
let completeQueue: Array<jest.Mock> = [];
function nextComplete(): jest.Mock {
    return completeQueue.shift() ?? jest.fn().mockResolvedValue({ text: 'default' });
}

jest.mock('@/app-layer/ai/provider/claude-provider', () => ({
    ClaudeProvider: class {
        backend = 'claude';
        model?: string;
        complete: Complete;
        constructor(cfg: { model?: string }) {
            this.model = cfg.model;
            this.complete = nextComplete();
            claudeInstances.push(this);
        }
    },
}));

jest.mock('@/app-layer/ai/provider/openai-compatible-provider', () => {
    class AiProviderError extends Error {
        backend: string;
        constructor(backend: string, message: string) {
            super(message);
            this.name = 'AiProviderError';
            this.backend = backend;
        }
    }
    return {
        AiProviderError,
        OpenAiCompatibleProvider: class {
            backend?: string;
            model?: string;
            complete: Complete;
            constructor(cfg: { backend?: string; model?: string }) {
                this.backend = cfg.backend;
                this.model = cfg.model;
                this.complete = nextComplete();
                openaiInstances.push(this);
            }
        },
    };
});

import { routeTask, completeWithRouting } from '@/app-layer/ai/routing';
import { AiProviderError } from '@/app-layer/ai/provider/openai-compatible-provider';

beforeEach(() => {
    mockAssertAiTierAllowed.mockReset();
    mockAssertAiTierAllowed.mockResolvedValue(undefined);
    claudeInstances.length = 0;
    openaiInstances.length = 0;
    completeQueue = [];
});

// ─── (a) task → tier mapping ───

describe('routeTask', () => {
    it('maps copilot-chat to the standard tier on native Claude', () => {
        const r = routeTask('copilot-chat');
        expect(r.tier).toBe('standard');
        expect(r.backend).toBe('claude');
        expect(r.model).toBe('claude-sonnet-4-6');
        expect(r.failover.length).toBeGreaterThan(0);
    });

    it('maps dosage-calc + regulatory + long-horizon to the premium tier on Opus', () => {
        for (const task of ['dosage-calc', 'regulatory', 'long-horizon'] as const) {
            const r = routeTask(task);
            expect(r.tier).toBe('premium');
            expect(r.backend).toBe('claude');
            expect(r.model).toBe('claude-opus-4-8');
        }
    });

    it('maps cheap-bulk to the cheap tier on Groq', () => {
        const r = routeTask('cheap-bulk');
        expect(r.tier).toBe('cheap');
        expect(r.backend).toBe('groq');
    });

    it('every route carries timeout, retries, and a failover chain', () => {
        for (const task of [
            'copilot-chat',
            'spray-explanation',
            'dosage-calc',
            'regulatory',
            'long-horizon',
            'cheap-bulk',
        ] as const) {
            const r = routeTask(task);
            expect(r.timeoutMs).toBeGreaterThan(0);
            expect(r.retries).toBeGreaterThanOrEqual(0);
            expect(Array.isArray(r.failover)).toBe(true);
        }
    });
});

// ─── (b) entitlement gating ───

describe('entitlement gating', () => {
    it('blocks a FREE tenant from a premium-tier task before any model call', async () => {
        const ctx = makeRequestContext('READER');
        mockAssertAiTierAllowed.mockRejectedValueOnce(new Error('ai_tier_not_allowed: FREE'));

        await expect(
            completeWithRouting(ctx, 'dosage-calc', { messages: [{ role: 'user', content: 'q' }] }),
        ).rejects.toThrow('ai_tier_not_allowed');

        // No provider was constructed / called.
        expect(claudeInstances.length).toBe(0);
        expect(mockAssertAiTierAllowed).toHaveBeenCalledWith(ctx, 'premium');
    });

    it('allows the call through when the tier is permitted', async () => {
        const ctx = makeRequestContext('ADMIN');
        completeQueue = [jest.fn().mockResolvedValue({ text: 'ok' })];

        const result = await completeWithRouting(ctx, 'copilot-chat', {
            messages: [{ role: 'user', content: 'hi' }],
        });

        expect(result.text).toBe('ok');
        expect(mockAssertAiTierAllowed).toHaveBeenCalledWith(ctx, 'standard');
        // First target is native Claude.
        expect(claudeInstances[0].complete).toHaveBeenCalledTimes(1);
    });
});

// ─── (c) timeout / retry / failover ───

describe('retry + failover', () => {
    it('fails over to the secondary target when the primary hard-fails', async () => {
        const ctx = makeRequestContext('ADMIN');

        // spray-explanation: primary = claude haiku (retries:1),
        // failover[0] = openrouter haiku. Primary hard-fails (a
        // non-transient AiProviderError → no same-target retry benefit,
        // straight to failover); failover succeeds.
        completeQueue = [
            jest.fn().mockRejectedValue(new AiProviderError('claude', 'model unavailable')),
            jest.fn().mockResolvedValue({ text: 'failover-ok' }),
        ];

        const result = await completeWithRouting(ctx, 'spray-explanation', {
            messages: [{ role: 'user', content: 'explain' }],
        });

        expect(result.text).toBe('failover-ok');
        // Primary (claude) tried once; failover (openrouter) succeeded.
        expect(claudeInstances[0].complete).toHaveBeenCalledTimes(1);
        expect(openaiInstances.length).toBe(1);
        expect(openaiInstances[0].backend).toBe('openrouter');
        expect(openaiInstances[0].complete).toHaveBeenCalledTimes(1);
    });

    it('retries the SAME target on a transient (429) failure before failover', async () => {
        const ctx = makeRequestContext('ADMIN');
        // copilot-chat: retries:1. Primary transient-fails once, then
        // succeeds on the retry — no failover construction at all.
        const transient = Object.assign(new Error('rate limited'), { status: 429 });
        const primaryComplete = jest
            .fn()
            .mockRejectedValueOnce(transient)
            .mockResolvedValueOnce({ text: 'retry-ok' });
        completeQueue = [primaryComplete];

        const result = await completeWithRouting(ctx, 'copilot-chat', {
            messages: [{ role: 'user', content: 'hi' }],
        });

        expect(result.text).toBe('retry-ok');
        expect(primaryComplete).toHaveBeenCalledTimes(2);
        // No failover target was constructed.
        expect(openaiInstances.length).toBe(0);
        expect(claudeInstances.length).toBe(1);
    });

    it('throws the last error when every target fails', async () => {
        const ctx = makeRequestContext('ADMIN');
        // spray-explanation: primary + one failover. Both hard-fail.
        completeQueue = [
            jest.fn().mockRejectedValue(new AiProviderError('claude', 'down')),
            jest.fn().mockRejectedValue(new AiProviderError('openrouter', 'also down')),
        ];

        await expect(
            completeWithRouting(ctx, 'spray-explanation', { messages: [{ role: 'user', content: 'x' }] }),
        ).rejects.toThrow('also down');
    });
});

// ─── (d) caller abort short-circuits ───

describe('caller abort', () => {
    it('does not keep retrying once the caller signal is aborted', async () => {
        const ctx = makeRequestContext('ADMIN');
        const controller = new AbortController();
        controller.abort(); // already aborted before the call

        // Primary fails with an abort-shaped error; because the caller
        // signal is aborted, routing must NOT retry or fail over.
        completeQueue = [jest.fn().mockRejectedValue(new Error('aborted by caller'))];

        await expect(
            completeWithRouting(ctx, 'copilot-chat', {
                messages: [{ role: 'user', content: 'hi' }],
                signal: controller.signal,
            }),
        ).rejects.toThrow();

        expect(claudeInstances[0].complete).toHaveBeenCalledTimes(1);
        expect(openaiInstances.length).toBe(0);
    });
});
