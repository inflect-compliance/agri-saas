/**
 * AI usage ledger writer (feat/ai-guardrails).
 *
 * Inserts one append-only `AiUsageEvent` row AFTER each completion (cache
 * hits included). The row feeds the monthly token budget aggregate + cost
 * observability. It NEVER stores the raw prompt — only a sha256
 * `promptHash` for correlation/dedupe.
 *
 * The insert runs through `runInTenantContext`, so RLS scopes it to the
 * acting tenant exactly like any other tenant write. It is best-effort:
 * a ledger-write failure must NOT fail the user's completion (the answer
 * is already computed), so callers wrap it defensively.
 */
import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext } from '@/lib/db-context';

export interface RecordAiUsageInput {
    task: string;
    model: string;
    backend: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costMicros: number;
    cacheHit: boolean;
    /** sha256 of the normalised prompt — correlation key, never the prompt. */
    promptHash: string;
}

/**
 * Append a usage row. Best-effort — the caller has already produced the
 * completion, so the ledger write is non-blocking for correctness.
 */
export async function recordAiUsage(ctx: RequestContext, input: RecordAiUsageInput): Promise<void> {
    await runInTenantContext(ctx, async (db) => {
        await db.aiUsageEvent.create({
            data: {
                tenantId: ctx.tenantId,
                userId: ctx.userId,
                task: input.task,
                model: input.model,
                backend: input.backend,
                promptTokens: input.promptTokens,
                completionTokens: input.completionTokens,
                totalTokens: input.totalTokens,
                costMicros: input.costMicros,
                cacheHit: input.cacheHit,
                promptHash: input.promptHash,
            },
        });
    });
}
