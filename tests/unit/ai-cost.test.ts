/**
 * AI cost estimation — unit tests.
 */
jest.mock('@/lib/observability/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { estimateCostMicros } from '@/app-layer/ai/cost';
import type { AiUsage } from '@/app-layer/ai/provider/types';

function usage(prompt: number, completion: number): AiUsage {
    return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
}

describe('estimateCostMicros', () => {
    it('prices a known model (Opus: $15/$75 per 1M)', () => {
        // 1M prompt + 1M completion → 15_000_000 + 75_000_000 micros.
        const micros = estimateCostMicros('claude-opus-4-8', usage(1_000_000, 1_000_000));
        expect(micros).toBe(15_000_000 + 75_000_000);
    });

    it('prices Sonnet and Haiku correctly', () => {
        expect(estimateCostMicros('claude-sonnet-4-6', usage(1_000_000, 0))).toBe(3_000_000);
        expect(estimateCostMicros('claude-haiku-4-5', usage(0, 1_000_000))).toBe(5_000_000);
    });

    it('matches OpenRouter-prefixed model ids to the same price', () => {
        const a = estimateCostMicros('claude-sonnet-4-6', usage(1000, 1000));
        const b = estimateCostMicros('anthropic/claude-sonnet-4-6', usage(1000, 1000));
        expect(a).toBe(b);
        expect(a).toBeGreaterThan(0);
    });

    it('prices the groq llama model', () => {
        const micros = estimateCostMicros('llama-3.3-70b-versatile', usage(1_000_000, 0));
        expect(micros).toBe(590_000); // $0.59/1M
    });

    it('charges 0 for a local ollama-tagged model', () => {
        expect(estimateCostMicros('qwen3:1.7b', usage(1_000_000, 1_000_000))).toBe(0);
    });

    it('returns 0 for an unknown model', () => {
        expect(estimateCostMicros('totally-unknown-model', usage(1000, 1000))).toBe(0);
    });

    it('returns an integer (micro-dollars)', () => {
        const micros = estimateCostMicros('claude-haiku-4-5', usage(123, 456));
        expect(Number.isInteger(micros)).toBe(true);
    });
});
