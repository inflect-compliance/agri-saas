/**
 * AI Risk Suggestions — Use Cases (Enterprise-hardened)
 *
 * Business logic for managing AI-generated risk suggestion sessions.
 * All operations are tenant-scoped, rate-limited, feature-gated, and audit-logged.
 *
 * Privacy: Only sanitized asset/framework data is sent to external AI models.
 * Rate limits: Per-tenant daily quota + per-user burst protection.
 * Feature gate: Global flag, role-based, and optional plan-based gating.
 * Audit: Every generate/apply/dismiss action is logged with full context.
 */
import { runInTenantContext } from '@/lib/db-context';
import { recordScoreEvent } from './risk-score-events';
import { logEvent } from '@/app-layer/events/audit';
import type { RequestContext } from '@/app-layer/types';
import { getProvider } from '@/app-layer/ai/risk-assessment';
import type { RiskAssessmentInput, RiskAssessmentAsset } from '@/app-layer/ai/risk-assessment/types';
import type { ApplySessionInput, RiskAssessmentApiInput } from '@/app-layer/ai/risk-assessment/schemas';
import { forbidden, notFound } from '@/lib/errors/types';
import { sanitizeProviderInput, describePayload } from '@/app-layer/ai/risk-assessment/privacy-sanitizer';
import { checkRateLimit, recordGeneration } from '@/app-layer/ai/risk-assessment/rate-limiter';
import { enforceFeatureGate } from '@/app-layer/ai/risk-assessment/feature-gate';
import { bumpEntityCacheVersion } from '@/lib/cache/list-cache';

// ─── Generate Risk Suggestions ───

export async function generateRiskSuggestions(
    ctx: RequestContext,
    apiInput: RiskAssessmentApiInput,
) {
    // 1. Feature gate (global flag + role + optional plan)
    enforceFeatureGate(ctx);

    // 2. Permission check (admin/editor only — redundant with feature gate but explicit)
    if (!ctx.permissions.canWrite) {
        throw forbidden('Only editors and admins can generate AI risk suggestions');
    }

    // 3. Rate limit check (before any DB work)
    checkRateLimit(ctx.tenantId, ctx.userId);

    return runInTenantContext(ctx, async (db) => {
        // 4. Fetch tenant profile
        const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } });
        if (!tenant) throw notFound('Tenant not found');

        // 5. Fetch assets by IDs (or all if none specified)
        const assetWhere = apiInput.assetIds.length > 0
            ? { tenantId: ctx.tenantId, id: { in: apiInput.assetIds }, deletedAt: null }
            : { tenantId: ctx.tenantId, deletedAt: null };
        const dbAssets = await db.asset.findMany({ where: assetWhere, take: 50 });

        const assets: RiskAssessmentAsset[] = dbAssets.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            criticality: a.criticality,
        }));

        // 6. Fetch existing controls (to avoid suggesting already-mitigated risks)
        const existingControls = await db.control.findMany({
            where: { tenantId: ctx.tenantId },
            select: { name: true, code: true },
            take: 100,
        });
        const controlNames = existingControls.map(c => c.code ?? c.name);

        // 7. Build provider input
        const providerInput: RiskAssessmentInput = {
            tenantIndustry: tenant.industry,
            tenantContext: apiInput.context ?? tenant.context,
            frameworks: apiInput.frameworks,
            assets,
            existingControls: controlNames,
            maxRiskScale: tenant.maxRiskScale,
        };

        // 8. *** PRIVACY: Sanitize before sending to AI ***
        const sanitizedInput = sanitizeProviderInput(providerInput);
        const payloadDescription = describePayload(sanitizedInput);

        // 9. Create session record (DRAFT → will be GENERATED on success)
        const session = await db.riskSuggestionSession.create({
            data: {
                tenantId: ctx.tenantId,
                createdByUserId: ctx.userId,
                status: 'DRAFT',
                inputJson: JSON.stringify(sanitizedInput), // Store sanitized input only
                provider: 'pending',
            },
        });

        // 10. Call provider with sanitized input
        const provider = getProvider();
        let output;
        try {
            output = await provider.generateSuggestions(sanitizedInput);
        } catch (err) {
            // Mark session as failed
            await db.riskSuggestionSession.update({
                where: { id: session.id },
                data: {
                    status: 'DISMISSED',
                    errorMessage: err instanceof Error ? err.message : 'Unknown error',
                },
            });

            // Audit log the failure
            await logEvent(db, ctx, {
                action: 'AI_RISK_SUGGESTIONS_GENERATED',
                entityType: 'RiskSuggestionSession',
                entityId: session.id,
                details: `AI generation FAILED: ${err instanceof Error ? err.message : 'Unknown error'}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'RiskSuggestionSession', operation: 'created', summary: 'AI_RISK_SUGGESTIONS_GENERATED' },
                metadata: {
                    success: false,
                    provider: provider.providerName,
                    payloadSummary: payloadDescription,
                },
            });

            throw err;
        }

        // 11. Store suggestion items
        const items = await Promise.all(
            output.suggestions.map(async (s) => {
                // Try to find matching asset by name (use original assets for ID lookup)
                const matchedAsset = s.relatedAssetName
                    ? assets.find(a => a.name.toLowerCase() === s.relatedAssetName?.toLowerCase())
                    : undefined;

                return db.riskSuggestionItem.create({
                    data: {
                        sessionId: session.id,
                        tenantId: ctx.tenantId,
                        assetId: matchedAsset?.id ?? null,
                        title: s.title,
                        description: s.description,
                        category: s.category,
                        threat: s.threat,
                        vulnerability: s.vulnerability,
                        likelihoodSuggested: s.likelihood,
                        impactSuggested: s.impact,
                        rationale: s.rationale,
                        suggestedControlsJson: JSON.stringify(s.suggestedControls),
                        status: 'PENDING',
                    },
                });
            })
        );

        // 12. Update session to GENERATED
        const updatedSession = await db.riskSuggestionSession.update({
            where: { id: session.id },
            data: {
                status: 'GENERATED',
                modelName: output.modelName,
                provider: output.provider,
            },
        });

        // 13. Record rate limit usage (after success)
        recordGeneration(ctx.tenantId, ctx.userId);

        // 14. Audit log with full traceability
        await logEvent(db, ctx, {
            action: 'AI_RISK_SUGGESTIONS_GENERATED',
            entityType: 'RiskSuggestionSession',
            entityId: session.id,
            details: `Generated ${items.length} risk suggestions using ${output.provider}/${output.modelName}. ${output.isFallback ? 'FALLBACK mode (baseline templates).' : 'AI model used.'}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'RiskSuggestionSession', operation: 'created', summary: 'AI_RISK_SUGGESTIONS_GENERATED' },
            metadata: {
                success: true,
                provider: output.provider,
                modelName: output.modelName,
                isFallback: output.isFallback ?? false,
                itemCount: items.length,
                frameworks: apiInput.frameworks,
                assetCount: assets.length,
                payloadSummary: payloadDescription,
            },
        });

        return { session: updatedSession, items };
    });
}

// ─── Get Session ───

export async function getSession(ctx: RequestContext, sessionId: string) {
    if (!ctx.permissions.canRead) {
        throw forbidden('Insufficient permissions');
    }

    return runInTenantContext(ctx, async (db) => {
        const session = await db.riskSuggestionSession.findFirst({
            where: { id: sessionId, tenantId: ctx.tenantId },
            include: { items: true },
        });

        if (!session) throw notFound('Session not found');
        return session;
    });
}

// ─── Apply Session (create real Risk records) ───

export async function applySession(ctx: RequestContext, sessionId: string, input: ApplySessionInput) {
    // Feature gate + permission check
    enforceFeatureGate(ctx);
    if (!ctx.permissions.canWrite) {
        throw forbidden('Only editors and admins can apply AI risk suggestions');
    }

    const { updatedSession, createdRiskCount } = await runInTenantContext(ctx, async (db) => {
        const session = await db.riskSuggestionSession.findFirst({
            where: { id: sessionId, tenantId: ctx.tenantId },
            include: { items: true },
        });

        if (!session) throw notFound('Session not found');
        if (session.status === 'APPLIED') {
            throw forbidden('Session has already been applied');
        }
        if (session.status === 'DISMISSED') {
            throw forbidden('Session has been dismissed');
        }

        const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } });
        const maxScale = tenant?.maxRiskScale ?? 5;

        const acceptedIds = new Set(input.acceptedItemIds);
        const createdRisks: string[] = [];

        for (const item of session.items) {
            if (acceptedIds.has(item.id)) {
                // Check idempotency — skip if risk with same title exists
                const existingRisk = await db.risk.findFirst({
                    where: { tenantId: ctx.tenantId, title: item.title },
                });
                if (existingRisk) {
                    // Mark as accepted but don't create duplicate
                    await db.riskSuggestionItem.update({
                        where: { id: item.id },
                        data: { status: 'ACCEPTED', createdRiskId: existingRisk.id },
                    });
                    createdRisks.push(existingRisk.id);
                    continue;
                }

                const likelihood = item.likelihoodSuggested ?? 3;
                const impact = item.impactSuggested ?? 3;
                const score = Math.round((likelihood / maxScale) * (impact / maxScale) * maxScale * maxScale);

                const risk = await db.risk.create({
                    data: {
                        tenantId: ctx.tenantId,
                        title: item.title,
                        description: item.description,
                        category: item.category,
                        threat: item.threat,
                        vulnerability: item.vulnerability,
                        likelihood,
                        impact,
                        score,
                        inherentScore: score,
                        status: 'OPEN',
                        createdByUserId: ctx.userId,
                    },
                });

                // RQ2-7 — accepted AI suggestions land with honest
                // provenance: the inherent anchor is an AI-source
                // ledger event (RQ2-1), not an unattributed write.
                await recordScoreEvent(db, ctx.tenantId, {
                    riskId: risk.id,
                    kind: 'INHERENT',
                    likelihood,
                    impact,
                    score,
                    source: 'AI',
                    justification: item.rationale ?? null,
                    createdByUserId: ctx.userId,
                });

                await db.riskSuggestionItem.update({
                    where: { id: item.id },
                    data: { status: 'ACCEPTED', createdRiskId: risk.id },
                });
                createdRisks.push(risk.id);
            } else {
                // Not in accepted list → mark rejected
                if (item.status === 'PENDING') {
                    await db.riskSuggestionItem.update({
                        where: { id: item.id },
                        data: { status: 'REJECTED' },
                    });
                }
            }
        }

        // Mark session as APPLIED
        const updatedSession = await db.riskSuggestionSession.update({
            where: { id: session.id },
            data: { status: 'APPLIED' },
            include: { items: true },
        });

        // Audit log with full traceability
        await logEvent(db, ctx, {
            action: 'AI_RISK_SUGGESTIONS_APPLIED',
            entityType: 'RiskSuggestionSession',
            entityId: session.id,
            details: `Applied ${createdRisks.length} risk suggestions, rejected ${session.items.length - createdRisks.length}`,
            detailsJson: { category: 'custom', event: 'ai_risk_suggestions_applied' },
            metadata: {
                acceptedCount: createdRisks.length,
                rejectedCount: session.items.length - createdRisks.length,
                createdRiskIds: createdRisks,
                sessionProvider: session.provider,
                sessionModel: session.modelName,
            },
        });

        return { updatedSession, createdRiskCount: createdRisks.length };
    });

    // applySession creates/links Risk rows directly (not via the
    // `createRisk` usecase), so it must invalidate the risk list cache
    // itself — every other Risk-mutating usecase in `risk.ts` does the
    // same. Without this, AI-applied risks stay invisible in the Risk
    // Register until the cache TTL expires.
    if (createdRiskCount > 0) {
        await bumpEntityCacheVersion(ctx, 'risk');
    }

    return updatedSession;
}

// ─── Dismiss Session ───

export async function dismissSession(ctx: RequestContext, sessionId: string) {
    // Feature gate + permission check
    enforceFeatureGate(ctx);
    if (!ctx.permissions.canWrite) {
        throw forbidden('Only editors and admins can dismiss AI risk suggestions');
    }

    return runInTenantContext(ctx, async (db) => {
        const session = await db.riskSuggestionSession.findFirst({
            where: { id: sessionId, tenantId: ctx.tenantId },
        });

        if (!session) throw notFound('Session not found');

        const updated = await db.riskSuggestionSession.update({
            where: { id: session.id },
            data: { status: 'DISMISSED' },
        });

        // Audit log
        await logEvent(db, ctx, {
            action: 'AI_RISK_SUGGESTIONS_DISMISSED',
            entityType: 'RiskSuggestionSession',
            entityId: session.id,
            details: `Risk suggestion session dismissed. Provider: ${session.provider}, items: ${session.modelName ?? 'unknown'}`,
            detailsJson: { category: 'custom', event: 'ai_risk_suggestions_dismissed' },
            metadata: {
                sessionProvider: session.provider,
                sessionModel: session.modelName,
            },
        });

        return updated;
    });
}
