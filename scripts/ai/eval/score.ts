/**
 * Eval scorers (feat/ai-evals-safety).
 *
 * Three scoring modes:
 *   - exact   : normalised string equality (MCQ answers).
 *   - contains: every required substring present (open-ended keys).
 *   - judge   : an LLM-judge rubric scorer (0..1) that grades an
 *               open-ended answer against a reference, via the AI provider
 *               with a Zod-validated structured output.
 *
 * The judge is OPTIONAL. When no live AI backend is configured (the CI
 * default), the runner skips it entirely — these functions never require
 * a key and never throw on a missing backend; `scoreWithJudge` returns a
 * `skipped` result the runner records and reports.
 */
import { z } from 'zod';
import type { AiProvider } from '@/app-layer/ai/provider';

/** Normalise for exact / contains comparison. */
export function normalise(s: string): string {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Exact (normalised) match — used for MCQ. */
export function scoreExact(actual: string, expected: string): number {
    return normalise(actual) === normalise(expected) ? 1 : 0;
}

/** Contains — 1 only if EVERY required substring is present. */
export function scoreContains(actual: string, required: string[]): number {
    if (required.length === 0) return 1;
    const hay = normalise(actual);
    return required.every((needle) => hay.includes(normalise(needle))) ? 1 : 0;
}

/** Fraction of required substrings present (partial-credit variant). */
export function scoreContainsFraction(actual: string, required: string[]): number {
    if (required.length === 0) return 1;
    const hay = normalise(actual);
    const hits = required.filter((needle) => hay.includes(normalise(needle))).length;
    return hits / required.length;
}

const JudgeSchema = z.object({
    score: z.number().min(0).max(1),
    rationale: z.string().default(''),
});

export interface JudgeResult {
    skipped: boolean;
    score: number;
    rationale: string;
}

/**
 * LLM-judge: grade `answer` against `reference` on a 0..1 scale via the
 * provided AiProvider. Pass `provider = null` (CI default) to skip — it
 * returns `{ skipped: true, score: 0 }` without any network call.
 */
export async function scoreWithJudge(
    provider: AiProvider | null,
    question: string,
    answer: string,
    reference: string,
): Promise<JudgeResult> {
    if (!provider) {
        return { skipped: true, score: 0, rationale: 'judge skipped (no AI backend configured)' };
    }

    const system =
        'You are a strict grader. Compare a candidate answer to a reference ' +
        'answer for an agronomy question. Score 0..1 on factual agreement and ' +
        'completeness. Respond as JSON: { "score": number (0..1), "rationale": string }.';
    const user = [
        `Question: ${question}`,
        `Reference: ${reference}`,
        `Candidate: ${answer}`,
    ].join('\n');

    try {
        const completion = await provider.complete({
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            schema: JudgeSchema,
        });
        const parsed = completion.parsed;
        if (!parsed) {
            return { skipped: true, score: 0, rationale: 'judge returned no structured output' };
        }
        return { skipped: false, score: parsed.score, rationale: parsed.rationale };
    } catch (err) {
        // Degrade gracefully — a judge failure must never crash the runner.
        return {
            skipped: true,
            score: 0,
            rationale: `judge error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
