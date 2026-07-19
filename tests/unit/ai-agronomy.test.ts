/**
 * Unit tests for the agronomy AI generators (copilot + photo ID).
 * Mocks the fail-safe LLM client so no network is touched: proves the
 * configured/unconfigured gates, the Zod validation, and the GDD helper.
 */
jest.mock('@/app-layer/ai/llm-client', () => {
    const actual = jest.requireActual('@/app-layer/ai/llm-client');
    return {
        ...actual,
        isLlmConfigured: jest.fn(),
        llmCompleteJson: jest.fn(),
    };
});

import { isLlmConfigured, llmCompleteJson } from '@/app-layer/ai/llm-client';
import { generateCopilotExplanation, computeGddSum, type CopilotSignalInput } from '@/app-layer/ai/agronomy/copilot';

const mockConfigured = isLlmConfigured as jest.Mock;
const mockComplete = llmCompleteJson as jest.Mock;

const signalInput: CopilotSignalInput = {
    kind: 'SPRAY_WINDOW',
    level: 'UNSUITABLE',
    locationName: 'North Field',
    reasons: ['Wind 28 km/h exceeds 15 km/h limit'],
    weather: [{ date: '2026-06-17', tempMeanC: 18, precipMm: 0, windMaxKmh: 28, humidityMean: 55 }],
    gddSum: 120,
    cropType: 'Wheat',
    growthStage: 'SOWN',
};


beforeEach(() => jest.clearAllMocks());

describe('generateCopilotExplanation', () => {
    it('returns null when the LLM is not configured (no call made)', async () => {
        mockConfigured.mockReturnValue(false);
        expect(await generateCopilotExplanation(signalInput)).toBeNull();
        expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns null when the LLM call fails', async () => {
        mockConfigured.mockReturnValue(true);
        mockComplete.mockResolvedValue(null);
        expect(await generateCopilotExplanation(signalInput)).toBeNull();
    });

    it('returns the validated explanation on a well-formed response', async () => {
        mockConfigured.mockReturnValue(true);
        mockComplete.mockResolvedValue({
            explanation: 'High winds today make spraying drift-prone; wait for calmer air.',
            factors: ['Wind 28 km/h', 'Wheat at sowing'],
            whatIf: 'Conditions improve when wind drops below 15 km/h, likely tomorrow morning.',
            confidence: 'high',
        });
        const out = await generateCopilotExplanation(signalInput);
        expect(out).not.toBeNull();
        expect(out!.confidence).toBe('high');
        expect(out!.factors).toHaveLength(2);
        expect(out!.model).toBeTruthy();
        expect(out!.generatedAt).toBeTruthy();
    });

    it('returns null when the response fails schema validation', async () => {
        mockConfigured.mockReturnValue(true);
        mockComplete.mockResolvedValue({ explanation: 'x', confidence: 'WRONG' });
        expect(await generateCopilotExplanation(signalInput)).toBeNull();
    });
});

describe('computeGddSum', () => {
    it('sums max(0, tempMean - base) over days with a temperature', () => {
        expect(
            computeGddSum([
                { date: 'a', tempMeanC: 15, precipMm: null, windMaxKmh: null, humidityMean: null },
                { date: 'b', tempMeanC: 5, precipMm: null, windMaxKmh: null, humidityMean: null },
                { date: 'c', tempMeanC: null, precipMm: null, windMaxKmh: null, humidityMean: null },
            ]),
        ).toBe(5); // (15-10) + max(0,5-10) = 5
    });
    it('returns null when no day has a temperature', () => {
        expect(computeGddSum([{ date: 'a', tempMeanC: null, precipMm: null, windMaxKmh: null, humidityMean: null }])).toBeNull();
    });
});
