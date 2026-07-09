/**
 * Agronomy copilot — turns a fired AgroSignal into a plain-language
 * explanation a grower can act on (why now, what's driving it, what-if).
 *
 * Pure-ish: builds the prompt, calls the fail-safe LLM client, validates
 * the shape. Returns `null` when the LLM is off or the call fails — the
 * signal already exists and already notified; the copilot text is pure
 * enrichment stored under `AgroSignal.detailsJson.copilot`.
 */
import { z } from 'zod';
import { llmCompleteJson, isLlmConfigured, type LlmMessage } from '../llm-client';

export interface CopilotWeatherDay {
    date: string;
    tempMeanC: number | null;
    precipMm: number | null;
    windMaxKmh: number | null;
    humidityMean: number | null;
}

export interface CopilotSignalInput {
    kind: 'SPRAY_WINDOW' | 'DISEASE_RISK';
    level: string | null;
    locationName: string;
    reasons: string[];
    weather: CopilotWeatherDay[];
    /** Accumulated growing-degree-days over the window (base 10°C), if computed. */
    gddSum: number | null;
    cropType: string | null;
    growthStage: string | null;
    /** Owning user's UI locale — pins the explanation's output language. */
    locale?: string | null;
}

const CopilotSchema = z.object({
    explanation: z.string().min(1).max(1200),
    factors: z.array(z.string().min(1)).max(6),
    whatIf: z.string().min(1).max(400),
    confidence: z.enum(['low', 'medium', 'high']),
});

export interface CopilotExplanation extends z.infer<typeof CopilotSchema> {
    model: string;
    generatedAt: string;
}

const MODEL = 'anthropic/claude-3.5-sonnet';

function buildMessages(input: CopilotSignalInput): LlmMessage[] {
    const system =
        'You are an experienced agronomist advising a working farmer. Explain a ' +
        'weather-derived field signal in clear, plain language a non-specialist can act on. ' +
        'Be specific and concise; never invent data not provided. Respond ONLY with a JSON ' +
        'object: { "explanation": string (2-4 sentences: why this signal fired now, tying in ' +
        'crop stage / GDD / weather / pest pressure where relevant), "factors": string[] ' +
        '(3-5 short bullet drivers), "whatIf": string (one concrete what-if, e.g. when conditions ' +
        'would become favourable again), "confidence": "low"|"medium"|"high" (your confidence ' +
        'given the data completeness) }.';

    const signalLabel =
        input.kind === 'SPRAY_WINDOW'
            ? `Spray window is ${input.level ?? 'unsuitable'}`
            : `Disease risk is ${input.level ?? 'elevated'}`;

    const recent = input.weather
        .slice(-7)
        .map(
            (w) =>
                `${w.date}: temp ${w.tempMeanC ?? '?'}°C, rain ${w.precipMm ?? '?'}mm, wind ${w.windMaxKmh ?? '?'}km/h, humidity ${w.humidityMean ?? '?'}%`,
        )
        .join('\n');

    const user = [
        `Field: ${input.locationName}`,
        input.cropType ? `Crop: ${input.cropType}` : null,
        input.growthStage ? `Growth stage: ${input.growthStage}` : null,
        input.gddSum != null ? `Accumulated GDD (base 10°C, window): ${input.gddSum}` : null,
        `Signal: ${signalLabel}`,
        input.reasons.length ? `Rule reasons: ${input.reasons.join('; ')}` : null,
        '',
        'Recent daily weather:',
        recent || '(none available)',
    ]
        .filter(Boolean)
        .join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

export async function generateCopilotExplanation(
    input: CopilotSignalInput,
): Promise<CopilotExplanation | null> {
    if (!isLlmConfigured()) return null;
    const raw = await llmCompleteJson(buildMessages(input), { maxTokens: 700, temperature: 0.2, model: MODEL, locale: input.locale });
    if (!raw) return null;
    const parsed = CopilotSchema.safeParse(raw);
    if (!parsed.success) return null;
    return { ...parsed.data, model: MODEL, generatedAt: new Date().toISOString() };
}

/** Growing-degree-days (base 10°C) over the window — a small, honest context number. */
export function computeGddSum(weather: CopilotWeatherDay[], base = 10): number | null {
    const days = weather.filter((w) => w.tempMeanC != null);
    if (days.length === 0) return null;
    const sum = days.reduce((acc, w) => acc + Math.max(0, (w.tempMeanC as number) - base), 0);
    return Math.round(sum * 10) / 10;
}
