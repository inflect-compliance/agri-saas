/**
 * AI metrics — unit test. Confirms recordAiCompletion is callable with the
 * noop meter (OTel not initialised in unit tests) and never throws.
 */
import { recordAiCompletion } from '@/lib/observability/ai-metrics';

describe('recordAiCompletion', () => {
    it('records a success without throwing (noop meter)', () => {
        expect(() =>
            recordAiCompletion({
                task: 'copilot-chat',
                model: 'claude-sonnet-4-6',
                backend: 'claude',
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                costMicros: 1234,
                latencyMs: 42,
                cacheHit: false,
                outcome: 'success',
            }),
        ).not.toThrow();
    });

    it('records an error outcome with no usage', () => {
        expect(() =>
            recordAiCompletion({
                task: 'dosage-calc',
                model: 'claude-opus-4-8',
                backend: 'claude',
                costMicros: 0,
                latencyMs: 10,
                cacheHit: false,
                outcome: 'error',
            }),
        ).not.toThrow();
    });
});
