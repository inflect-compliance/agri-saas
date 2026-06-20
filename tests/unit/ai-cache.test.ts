/**
 * AI response + embedding cache — unit tests.
 *
 * A Map-backed fake Redis exercises the hit/miss paths; setting it to
 * null exercises the graceful no-Redis bypass.
 */
jest.mock('@/env', () => ({
    env: { AI_CACHE_TTL_SECONDS: undefined, AI_EMBED_CACHE_TTL_SECONDS: undefined },
}));

let fakeStore: Map<string, string> | null = new Map();
jest.mock('@/lib/redis', () => ({
    getRedis: () =>
        fakeStore === null
            ? null
            : {
                  get: async (k: string) => fakeStore!.get(k) ?? null,
                  set: async (k: string, v: string) => {
                      fakeStore!.set(k, v);
                      return 'OK';
                  },
              },
}));
jest.mock('@/lib/observability/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
    getCachedCompletion,
    setCachedCompletion,
    getCachedEmbedding,
    setCachedEmbedding,
    isCacheableCompletion,
    normalizeText,
} from '@/lib/cache/ai-cache';
import type { AiCompleteOptions, AiCompletion } from '@/app-layer/ai/provider/types';

beforeEach(() => {
    fakeStore = new Map();
});

function opts(content: string, extra: Partial<AiCompleteOptions> = {}): AiCompleteOptions {
    return { messages: [{ role: 'user', content }], ...extra };
}

describe('isCacheableCompletion', () => {
    it('caches low/zero temperature non-streaming non-tool calls', () => {
        expect(isCacheableCompletion(opts('q'))).toBe(true);
        expect(isCacheableCompletion(opts('q', { temperature: 0.1 }))).toBe(true);
    });
    it('does not cache streaming, tool-call, or hot-temperature calls', () => {
        expect(isCacheableCompletion(opts('q', { stream: true }))).toBe(false);
        expect(
            isCacheableCompletion(opts('q', { tools: [{ name: 't', parameters: {} }] })),
        ).toBe(false);
        expect(isCacheableCompletion(opts('q', { temperature: 0.9 }))).toBe(false);
    });
});

describe('response cache', () => {
    it('miss then hit for an identical prompt', async () => {
        const o = opts('how much nitrogen?');
        expect(await getCachedCompletion('t1', 'm', 'copilot-chat', o)).toBeNull();
        const completion: AiCompletion = { text: '120 kg/ha', usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } };
        await setCachedCompletion('t1', 'm', 'copilot-chat', o, completion);
        const hit = await getCachedCompletion('t1', 'm', 'copilot-chat', o);
        expect(hit).not.toBeNull();
        expect(hit!.text).toBe('120 kg/ha');
        expect(hit!.usage!.totalTokens).toBe(8);
    });

    it('normalises whitespace so equal-but-spaced prompts share an entry', async () => {
        const a = opts('how   much  nitrogen?');
        const b = opts('how much nitrogen?');
        await setCachedCompletion('t1', 'm', 'copilot-chat', a, { text: 'cached' });
        const hit = await getCachedCompletion('t1', 'm', 'copilot-chat', b);
        expect(hit?.text).toBe('cached');
    });

    it('does not share a cached response across tenants (tenant-scoped key)', async () => {
        const o = opts('how much nitrogen?');
        await setCachedCompletion('t1', 'm', 'copilot-chat', o, { text: 'tenant-1 answer' });
        // Same model + identical prompt, different tenant → must be a miss.
        expect(await getCachedCompletion('t2', 'm', 'copilot-chat', o)).toBeNull();
        // The owning tenant still hits.
        expect((await getCachedCompletion('t1', 'm', 'copilot-chat', o))?.text).toBe('tenant-1 answer');
    });

    it('does not store streaming responses', async () => {
        const o = opts('q', { stream: true });
        await setCachedCompletion('t1', 'm', 'copilot-chat', o, { text: 'x' });
        expect(fakeStore!.size).toBe(0);
    });

    it('is graceful without Redis (always a miss, no throw)', async () => {
        fakeStore = null;
        const o = opts('q');
        await setCachedCompletion('t1', 'm', 'copilot-chat', o, { text: 'x' });
        expect(await getCachedCompletion('t1', 'm', 'copilot-chat', o)).toBeNull();
    });
});

describe('embedding cache', () => {
    it('miss then hit for identical text', async () => {
        expect(await getCachedEmbedding('emb', 'wheat')).toBeNull();
        await setCachedEmbedding('emb', 'wheat', [0.1, 0.2, 0.3]);
        expect(await getCachedEmbedding('emb', 'wheat')).toEqual([0.1, 0.2, 0.3]);
    });
    it('is graceful without Redis', async () => {
        fakeStore = null;
        await setCachedEmbedding('emb', 'x', [1]);
        expect(await getCachedEmbedding('emb', 'x')).toBeNull();
    });
});

describe('normalizeText', () => {
    it('trims and collapses whitespace', () => {
        expect(normalizeText('  a   b\n c ')).toBe('a b c');
    });
});
