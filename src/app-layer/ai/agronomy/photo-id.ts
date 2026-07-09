/**
 * Photo pest/disease identification — runs a crop-scouting photo through
 * a Claude vision model and returns a structured, confidence-scored
 * identification + recommendation. Stored under
 * `LogEntry.attributesJson.pestId` and surfaced in-page with an explicit
 * "verify with an agronomist" disclaimer (AI is a triage aid, not a
 * diagnosis).
 *
 * Fail-safe: returns `null` when the LLM is off or the call fails — the
 * photo still uploaded and the log entry stands.
 */
import { z } from 'zod';
import { llmCompleteJson, isLlmConfigured, imageDataUri, type LlmMessage } from '../llm-client';

export interface PhotoIdInput {
    imageBase64: string;
    mimeType: string;
    cropType?: string | null;
    /** Optional free-text context from the log entry (title / notes). */
    contextNote?: string | null;
    /** Owning user's UI locale — pins the recommendation's output language. */
    locale?: string | null;
}

const PhotoIdSchema = z.object({
    /** A confident-enough pest/disease/deficiency was identified. */
    identified: z.boolean(),
    category: z.enum(['PEST', 'DISEASE', 'DEFICIENCY', 'HEALTHY', 'UNKNOWN']),
    /** Best-guess name (null when nothing identifiable). */
    name: z.string().nullable(),
    /** What the grower should do next (always agronomist-verifiable). */
    recommendation: z.string().min(1).max(600),
    confidence: z.enum(['low', 'medium', 'high']),
});

export interface PhotoIdResult extends z.infer<typeof PhotoIdSchema> {
    model: string;
    generatedAt: string;
}

const MODEL = 'anthropic/claude-3.5-sonnet';

function buildMessages(input: PhotoIdInput): LlmMessage[] {
    const system =
        'You are a careful crop-scouting assistant examining a field photo. Identify any pest, ' +
        'disease, or nutrient deficiency visible. Be conservative: if the image is unclear or you ' +
        'are not reasonably sure, set identified=false, category="UNKNOWN", name=null, and a low ' +
        'confidence. NEVER fabricate a specific diagnosis. Respond ONLY with a JSON object: ' +
        '{ "identified": boolean, "category": "PEST"|"DISEASE"|"DEFICIENCY"|"HEALTHY"|"UNKNOWN", ' +
        '"name": string|null, "recommendation": string (a brief, practical next step a grower can ' +
        'take; always frame it as provisional pending agronomist confirmation), ' +
        '"confidence": "low"|"medium"|"high" }.';

    const promptText = [
        input.cropType ? `Crop: ${input.cropType}.` : null,
        input.contextNote ? `Field note: ${input.contextNote}.` : null,
        'Examine the attached photo and identify any pest / disease / deficiency.',
    ]
        .filter(Boolean)
        .join(' ');

    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: imageDataUri(input.imageBase64, input.mimeType) } },
            ],
        },
    ];
}

export async function identifyPhoto(input: PhotoIdInput): Promise<PhotoIdResult | null> {
    if (!isLlmConfigured()) return null;
    const raw = await llmCompleteJson(buildMessages(input), { maxTokens: 500, temperature: 0.1, model: MODEL, locale: input.locale });
    if (!raw) return null;
    const parsed = PhotoIdSchema.safeParse(raw);
    if (!parsed.success) return null;
    return { ...parsed.data, model: MODEL, generatedAt: new Date().toISOString() };
}
