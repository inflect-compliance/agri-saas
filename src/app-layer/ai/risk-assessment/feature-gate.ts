/**
 * AI Risk Assessment — Feature Gate
 *
 * Controls access to AI risk assessment based on:
 * 1. Global feature flag (env: AI_RISK_ENABLED)
 * 2. Role-based access (admin/editor only)
 * 3. Optional plan-based gating (env: AI_RISK_PLAN_REQUIRED)
 *
 * When billing/entitlements are added, extend `checkPlanEntitlement`
 * to query the tenant's subscription plan.
 */
import { forbidden } from '@/lib/errors/types';
import type { RequestContext } from '@/app-layer/types';
import { env } from '@/env';

// ─── Configuration ───

/** Global kill switch for AI risk assessment. Set to 'false' to disable. */
const AI_RISK_ENABLED = (env.AI_RISK_ENABLED ?? 'true').toLowerCase() !== 'false';

/**
 * If set, AI risk assessment requires this plan tier.
 * Values: 'pro', 'enterprise', or empty (no plan gating).
 * When billing is implemented, check tenant.plan against this value.
 */
const AI_RISK_PLAN_REQUIRED = env.AI_RISK_PLAN_REQUIRED ?? '';

// ─── Feature Gate ───

export interface FeatureGateResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Check whether AI risk assessment is available for this context.
 * Returns { allowed: true } if all gates pass, or { allowed: false, reason } if blocked.
 */
export function checkFeatureGate(ctx: RequestContext): FeatureGateResult {
    // 1. Global feature flag
    if (!AI_RISK_ENABLED) {
        return { allowed: false, reason: 'AI risk assessment is currently disabled' };
    }

    // 2. Role check: admin or editor required
    if (!ctx.permissions.canWrite) {
        return { allowed: false, reason: 'AI risk assessment requires Editor or Admin role' };
    }

    // 3. Plan gating (stub — extend when billing is implemented)
    if (AI_RISK_PLAN_REQUIRED) {
        const planCheck = checkPlanEntitlement(ctx, AI_RISK_PLAN_REQUIRED);
        if (!planCheck.allowed) {
            return planCheck;
        }
    }

    return { allowed: true };
}

/**
 * Enforce the feature gate — throws forbidden if not allowed.
 */
export function enforceFeatureGate(ctx: RequestContext): void {
    const result = checkFeatureGate(ctx);
    if (!result.allowed) {
        throw forbidden(result.reason ?? 'AI risk assessment is not available');
    }
}

/**
 * Check plan entitlement for the tenant.
 *
 * STUB: Currently always returns { allowed: true } since billing is not yet implemented.
 * When billing is added, query the tenant's subscription plan here.
 *
 * Example future implementation:
 * ```
 * const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } });
 * if (tenant.plan !== requiredPlan && tenant.plan !== 'enterprise') {
 *   return { allowed: false, reason: `AI risk assessment requires ${requiredPlan} plan` };
 * }
 * ```
 */

function checkPlanEntitlement(_ctx: RequestContext, _requiredPlan: string): FeatureGateResult {
    // TODO: Implement plan-based gating when billing/entitlements are available
    // For now, always allow (feature flag + role check are the active gates)
    return { allowed: true };
}

/**
 * Check if AI risk assessment is enabled globally.
 * Useful for UI to conditionally show/hide entry points.
 */
export function isAIRiskEnabled(): boolean {
    return AI_RISK_ENABLED;
}

/**
 * Get the required plan for AI risk features (empty if no plan required).
 */
export function getRequiredPlan(): string {
    return AI_RISK_PLAN_REQUIRED;
}
