/**
 * Unit tests — eval scorers (feat/ai-evals-safety).
 * Exact + contains are pure; the LLM-judge is exercised with a mocked
 * provider and with the null (skipped / CI-default) path.
 */
import {
    scoreExact,
    scoreContains,
    scoreContainsFraction,
    scoreWithJudge,
} from '../../scripts/ai/eval/score';
import type { AiProvider } from '@/app-layer/ai/provider';

describe('scoreExact', () => {
    it('matches case- and whitespace-insensitively', () => {
        expect(scoreExact('Legumes', 'legumes')).toBe(1);
        expect(scoreExact('  Crop  Plan ', 'crop plan')).toBe(1);
        expect(scoreExact('Cereals', 'Legumes')).toBe(0);
    });
});

describe('scoreContains', () => {
    it('returns 1 only when every required substring is present', () => {
        expect(scoreContains('The re-entry interval is a time window', ['re-entry', 'time'])).toBe(1);
        expect(scoreContains('only one keyword', ['one', 'missing'])).toBe(0);
        expect(scoreContains('anything', [])).toBe(1);
    });
});

describe('scoreContainsFraction', () => {
    it('gives partial credit', () => {
        expect(scoreContainsFraction('has one of two', ['one', 'three'])).toBe(0.5);
        expect(scoreContainsFraction('both one two', ['one', 'two'])).toBe(1);
        expect(scoreContainsFraction('x', [])).toBe(1);
    });
});

describe('scoreWithJudge', () => {
    it('skips (no network) when provider is null — the CI default', async () => {
        const res = await scoreWithJudge(null, 'q', 'a', 'ref');
        expect(res.skipped).toBe(true);
        expect(res.score).toBe(0);
    });

    it('uses the mocked provider and returns its structured score', async () => {
        const complete = jest.fn().mockResolvedValue({
            text: '{"score":0.9,"rationale":"close"}',
            parsed: { score: 0.9, rationale: 'close' },
        });
        const provider = { complete } as unknown as AiProvider;
        const res = await scoreWithJudge(provider, 'q', 'answer', 'reference');
        expect(res.skipped).toBe(false);
        expect(res.score).toBe(0.9);
        expect(res.rationale).toBe('close');
        expect(complete).toHaveBeenCalledTimes(1);
    });

    it('degrades gracefully when the provider throws (never crashes)', async () => {
        const complete = jest.fn().mockRejectedValue(new Error('boom'));
        const provider = { complete } as unknown as AiProvider;
        const res = await scoreWithJudge(provider, 'q', 'a', 'ref');
        expect(res.skipped).toBe(true);
        expect(res.score).toBe(0);
        expect(res.rationale).toContain('judge error');
    });

    it('degrades when the provider returns no parsed output', async () => {
        const complete = jest.fn().mockResolvedValue({ text: 'garbage', parsed: undefined });
        const provider = { complete } as unknown as AiProvider;
        const res = await scoreWithJudge(provider, 'q', 'a', 'ref');
        expect(res.skipped).toBe(true);
    });
});
