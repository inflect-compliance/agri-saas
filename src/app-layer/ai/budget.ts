/**
 * Per-tenant+plan AI token budget (feat/ai-guardrails).
 *
 * A MONTHLY (current-UTC-month) cap on total AI tokens, layered on top of
 * the existing entitlement machinery (`src/lib/billing/entitlements.ts`):
 *   • the limit comes from `PLAN_LIMITS[plan].ai_tokens`,
 *   • the used amount is the SUM of `AiUsageEvent.totalTokens` this month,
 *   • self-hosted / ENTERPRISE (null limit) never blocks.
 *
 * Two thresholds:
 *   • HARD-STOP — `used >= limit` → throws `forbidden('ai_budget_exceeded…')`
 *     (same 403 shape + upgrade-hint contract as `assertWithinLimit`), so
 *     `withApiErrorHandling` surfaces it without new plumbing.
 *   • SOFT-WARN — `used >= 0.8 * limit` → does NOT block; returns
 *     `softWarn:true` so the caller can annotate the span / log / surface a
 *     "running low" hint.
 *
 * Per-REQUEST size is already capped by the route's `maxTokens`
 * (`completeWithRouting`); this is the cumulative monthly guard. The two
 * are complementary: maxTokens bounds one call, the budget bounds the month.
 */
import type { RequestContext } from '@/app-layer/types';
import { forbidden } from '@/lib/errors/types';
import {
    getEffectivePlan,
    getLimit,
    getAiTokensUsedThisMonth,
    getBillingMode,
    type BillingMode,
} from '@/lib/billing/entitlements';

/** Fraction of the limit at which the soft warning trips. */
const SOFT_WARN_RATIO = 0.8;

export interface AiBudgetStatus {
    /** Tokens consumed this UTC month. */
    used: number;
    /** Monthly cap (null = unlimited — self-hosted / ENTERPRISE). */
    limit: number | null;
    /** Tokens left before the hard stop (null when unlimited). */
    remaining: number | null;
    /** True when at/over 80% of the limit (advisory, non-blocking). */
    softWarn: boolean;
    /** Billing mode the status was evaluated under. */
    mode: BillingMode;
}

/**
 * Assert the tenant is within its monthly AI token budget. Throws a 403
 * `forbidden('ai_budget_exceeded…')` on hard stop; otherwise returns the
 * status (so the caller can react to `softWarn`). Call BEFORE the model
 * call in `completeWithRouting`.
 */
export async function assertAiBudget(ctx: RequestContext): Promise<AiBudgetStatus> {
    const mode = getBillingMode();
    const plan = await getEffectivePlan(ctx);
    const limit = getLimit(plan, 'ai_tokens');

    // Unlimited (self-hosted / ENTERPRISE) — never block, never query usage.
    if (limit === null) {
        return { used: 0, limit: null, remaining: null, softWarn: false, mode };
    }

    const used = await getAiTokensUsedThisMonth(ctx);

    if (used >= limit) {
        throw forbidden(
            `ai_budget_exceeded: ${plan} plan allows ${limit} AI tokens per month; ` +
                `tenant has used ${used} this month. Upgrade for a higher budget.`,
        );
    }

    const remaining = Math.max(0, limit - used);
    const softWarn = used >= SOFT_WARN_RATIO * limit;
    return { used, limit, remaining, softWarn, mode };
}
