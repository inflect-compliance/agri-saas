/**
 * Product-safety accessor (feat/ai-evals-safety).
 *
 * The ONLY read path for structured PESTICIDE dosage / REI / PHI numbers.
 * Reads a tenant-scoped `Item` and parses `attributesJson.safety` through
 * `PesticideSafetySpecSchema`. Returns `null` — never a guess — when the
 * item is not found, is not a PESTICIDE, has no `safety` block, or fails
 * validation. The advisory layer treats `null` as "no trusted data" and
 * refuses rather than letting the LLM invent the number.
 *
 * Tenant isolation: the read runs inside `runInTenantContext` (RLS) AND
 * restates the `tenantId` filter (defence-in-depth + the structural
 * tenant-isolation guard).
 */
import { runInTenantContext } from '@/lib/db-context';
import {
    parsePesticideSafety,
    type PesticideSafetySpec,
} from '@/app-layer/schemas/product-safety';
import type { RequestContext } from '@/app-layer/types';

/**
 * Resolve the structured safety spec for a PESTICIDE item, or `null`.
 */
export async function getPesticideSafety(
    ctx: RequestContext,
    itemId: string,
): Promise<PesticideSafetySpec | null> {
    if (!itemId) return null;

    return runInTenantContext(ctx, async (db) => {
        const item = await db.item.findFirst({
            where: { id: itemId, tenantId: ctx.tenantId },
            select: { category: true, attributesJson: true },
        });

        if (!item || item.category !== 'PESTICIDE') return null;

        const attrs = item.attributesJson;
        if (attrs == null || typeof attrs !== 'object') return null;

        // `attributesJson` is untyped Json; reach for the `safety` block.
        const safety = (attrs as Record<string, unknown>).safety;
        return parsePesticideSafety(safety);
    });
}
