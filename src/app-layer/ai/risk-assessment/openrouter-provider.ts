/**
 * AI Risk Assessment — OpenRouter Provider (thin adapter).
 *
 * Previously this was a bespoke fetch implementation. It is now a thin
 * adapter over the single swappable `OpenAiCompatibleProvider`
 * (src/app-layer/ai/provider) configured for OpenRouter. The same risk
 * call site therefore runs on local Ollama OR OpenRouter purely via env
 * — the only thing that changes is the provider's base URL / key / model.
 *
 * The class name + `RiskSuggestionProvider` interface are preserved so
 * the factory + call site + existing tests keep working. On any failure
 * it still falls back to the deterministic knowledge-base stub.
 */
import type { RiskAssessmentInput, RiskSuggestionOutput, RiskSuggestionProvider } from './types';
import { buildRiskAssessmentPrompt } from './prompt-builder';
import { RiskSuggestionOutputSchema } from './schemas';
import { StubRiskSuggestionProvider } from './stub-provider';
import { logger } from '@/lib/observability/logger';
import { OpenAiCompatibleProvider } from '@/app-layer/ai/provider';
import type { AiProvider } from '@/app-layer/ai/provider';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';

export class OpenRouterRiskSuggestionProvider implements RiskSuggestionProvider {
    readonly providerName = 'openrouter';
    private readonly model: string;
    private readonly ai: AiProvider;
    private readonly fallback: StubRiskSuggestionProvider;

    constructor(apiKey: string, model?: string, aiProvider?: AiProvider) {
        this.model = model ?? DEFAULT_MODEL;
        // Default to a real OpenRouter-configured OpenAiCompatibleProvider;
        // `aiProvider` is injectable for tests.
        this.ai =
            aiProvider ??
            new OpenAiCompatibleProvider({
                backend: 'openrouter',
                baseURL: OPENROUTER_BASE_URL,
                apiKey,
                model: this.model,
            });
        this.fallback = new StubRiskSuggestionProvider(/* isFallbackMode */ true);
    }

    async generateSuggestions(input: RiskAssessmentInput): Promise<RiskSuggestionOutput> {
        try {
            return await this.callApi(input);
        } catch {
            logger.error('OpenRouter API call failed, using fallback', { component: 'ai' });
            return this.fallback.generateSuggestions(input);
        }
    }

    private async callApi(input: RiskAssessmentInput): Promise<RiskSuggestionOutput> {
        const prompt = buildRiskAssessmentPrompt(input);

        const completion = await this.ai.complete({
            schema: RiskSuggestionOutputSchema,
            schemaName: 'risk_suggestions',
            temperature: 0.3,
            maxTokens: 4096,
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
            ],
        });

        const validated = completion.parsed;
        if (!validated) {
            throw new Error('AI provider returned no parsed structured output');
        }

        return {
            suggestions: validated.suggestions.map((s) => ({
                ...s,
                suggestedControls: s.suggestedControls ?? [],
                confidence: s.confidence ?? 'medium',
                structuredRationale: s.structuredRationale ?? {
                    whyThisRisk: s.rationale,
                    affectedAssetCharacteristics: [],
                    suggestedControlThemes: s.suggestedControls ?? [],
                },
            })),
            modelName: this.model,
            provider: 'openrouter',
            isFallback: false,
        };
    }
}
