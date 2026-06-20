/**
 * Agronomy advisor usecase (feat/ai-evals-safety).
 *
 * Thin pass-through to the safety-gated advisor so route handlers / jobs
 * have a usecase-layer entry point consistent with the rest of the app
 * layer. Additive — the existing copilot SSE route is untouched; callers
 * that want the safety guard (refusal, escalation, no-fabrication,
 * disclaimer) call this instead of the raw model path.
 */
import {
    askAgronomyAdvisor,
    type AdvisoryResult,
    type AskAdvisorOptions,
} from '@/app-layer/ai/safety/advisor';
import type { RequestContext } from '../types';

export type { AdvisoryResult, AskAdvisorOptions };

export async function askAdvisor(
    ctx: RequestContext,
    query: string,
    opts: AskAdvisorOptions = {},
): Promise<AdvisoryResult> {
    return askAgronomyAdvisor(ctx, query, opts);
}
