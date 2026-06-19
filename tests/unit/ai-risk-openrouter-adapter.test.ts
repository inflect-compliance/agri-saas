/**
 * Risk-assessment OpenRouter provider — now a thin adapter over the
 * swappable OpenAiCompatibleProvider. These tests assert the adapter
 * contract WITHOUT live network by injecting a fake AiProvider:
 *   - on success it calls complete({ messages, schema }) and maps the
 *     parsed structured output to RiskSuggestionOutput (provider=openrouter,
 *     isFallback=false);
 *   - on any failure it falls back to the deterministic stub.
 */
import { OpenRouterRiskSuggestionProvider } from '@/app-layer/ai/risk-assessment/openrouter-provider';
import type { AiProvider, AiCompleteOptions, AiCompletion } from '@/app-layer/ai/provider';
import type { RiskAssessmentInput } from '@/app-layer/ai/risk-assessment/types';

type CompleteFn = (opts: AiCompleteOptions<unknown>) => Promise<AiCompletion<unknown>>;

const input: RiskAssessmentInput = {
    frameworks: ['ISO27001'],
    assets: [{ id: '1', name: 'App', type: 'APPLICATION' }],
    maxRiskScale: 5,
};

// The fake's `complete` is a plainly-typed jest.Mock; `fakeAi` wraps it in
// the generic AiProvider.complete signature so the adapter type-checks while
// the test still drives + inspects the mock directly.
function fakeAi(complete: jest.Mock): AiProvider {
    return {
        backend: 'openrouter',
        complete: ((opts) => complete(opts)) as AiProvider['complete'],
        health: async () => ({ ok: true, model: 'm', modelAvailable: true }),
    };
}

describe('OpenRouterRiskSuggestionProvider adapter', () => {
    it('maps parsed structured output to RiskSuggestionOutput', async () => {
        const parsed = {
            suggestions: [
                {
                    title: 'SQL Injection',
                    description: 'Unsanitised input reaches the DB.',
                    likelihood: 3,
                    impact: 4,
                    rationale: 'Input handling is weak.',
                    suggestedControls: ['Parameterised queries'],
                    confidence: 'high' as const,
                    structuredRationale: {
                        whyThisRisk: 'Direct query concatenation',
                        affectedAssetCharacteristics: ['Internet-facing'],
                        suggestedControlThemes: ['Input validation'],
                    },
                },
            ],
        };
        const complete = jest.fn<ReturnType<CompleteFn>, Parameters<CompleteFn>>(
            async () => ({ text: JSON.stringify(parsed), parsed }),
        );
        const provider = new OpenRouterRiskSuggestionProvider('k', 'test-model', fakeAi(complete));

        const out = await provider.generateSuggestions(input);

        expect(out.provider).toBe('openrouter');
        expect(out.isFallback).toBe(false);
        expect(out.modelName).toBe('test-model');
        expect(out.suggestions[0].title).toBe('SQL Injection');
        // complete() was called with messages + a schema (structured output).
        const callArg = complete.mock.calls[0][0];
        expect(Array.isArray(callArg.messages)).toBe(true);
        expect(callArg.schema).toBeTruthy();
    });

    it('falls back to the deterministic stub when the AI call throws', async () => {
        const complete = jest.fn<ReturnType<CompleteFn>, Parameters<CompleteFn>>(async () => {
            throw new Error('network down');
        });
        const provider = new OpenRouterRiskSuggestionProvider('k', 'test-model', fakeAi(complete));

        const out = await provider.generateSuggestions(input);

        expect(out.isFallback).toBe(true);
        expect(out.provider).toBe('fallback');
        expect(out.suggestions.length).toBeGreaterThan(0);
    });

    it('falls back when the AI returns no parsed output', async () => {
        const complete = jest.fn<ReturnType<CompleteFn>, Parameters<CompleteFn>>(async () => ({ text: 'oops' }));
        const provider = new OpenRouterRiskSuggestionProvider('k', 'test-model', fakeAi(complete));

        const out = await provider.generateSuggestions(input);
        expect(out.isFallback).toBe(true);
    });

    it('keeps the RiskSuggestionProvider interface (providerName=openrouter)', () => {
        const provider = new OpenRouterRiskSuggestionProvider('k', 'm');
        expect(provider.providerName).toBe('openrouter');
    });
});
