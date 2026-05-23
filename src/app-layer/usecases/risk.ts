import { RequestContext } from '../types';
import { RiskRepository, RiskFilters, RiskListParams } from '../repositories/RiskRepository';
import { RiskTemplateRepository } from '../repositories/RiskTemplateRepository';
import { assertCanRead, assertCanWrite, assertCanAdmin } from '../policies/common';
import { logEvent } from '../events/audit';
import { notFound } from '@/lib/errors/types';
import { calculateRiskScore } from '@/lib/risk-scoring';
import { runInTenantContext } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { cachedListRead, bumpEntityCacheVersion } from '@/lib/cache/list-cache';
import type { TreatmentDecision, RiskStatus } from '@prisma/client';

// Epic D.2 — sanitise optional free-text on UPDATE without disturbing
// the three-state contract: undefined → don't touch, null → SET NULL,
// string → sanitise + SET. The shared `sanitizePlainText` helper
// returns '' for null/undefined inputs, which would silently turn an
// "untouched" column into an empty-string write — hence this guard.
function sanitizeOptional(v: string | null | undefined): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return sanitizePlainText(v);
}

// ─── Tenant-level usecases ───

export async function listRisks(
    ctx: RequestContext,
    filters: RiskFilters = {},
    options: { take?: number } = {},
) {
    assertCanRead(ctx);
    return cachedListRead({
        ctx,
        entity: 'risk',
        operation: 'list',
        // `take` participates in the cache key so a bounded SSR
        // result can't poison the unbounded API GET cache.
        params: options.take ? { ...filters, _take: options.take } : filters,
        loader: async () => {
            const rows = await runInTenantContext(ctx, (db) =>
                RiskRepository.list(db, ctx, filters, options),
            );
            return attachOwnerUsers(ctx, rows);
        },
    });
}

export async function listRisksPaginated(ctx: RequestContext, params: RiskListParams) {
    assertCanRead(ctx);
    return cachedListRead({
        ctx,
        entity: 'risk',
        operation: 'listPaginated',
        params,
        loader: async () => {
            const result = await runInTenantContext(ctx, (db) =>
                RiskRepository.listPaginated(db, ctx, params),
            );
            const enriched = await attachOwnerUsers(
                ctx,
                result.items as RiskRowWithOwner[],
            );
            return { ...result, items: enriched };
        },
    });
}

// Epic 44.4 — batch-attach `owner` ({ id, name, email }) per risk.
// `Risk.ownerUserId` doesn't carry a Prisma `@relation` to User
// today, so this stays a usecase-layer enrichment rather than a
// `findMany({ include })`. Single batched lookup keeps the cost
// bounded — 1 extra query per page of risks regardless of count.
//
// ## Cache-staleness caveat
//
// `listRisks` is wrapped by `cachedListRead`; the enriched shape is
// what gets cached. Cache invalidation fires on Risk writes (via
// `bumpEntityCacheVersion('risk')`), but NOT on User writes — so a
// user renaming themselves will have their previous display name
// linger in the risks-list cache until any other risk write bumps
// the version. Acceptable for now; if it bites, the fix is to
// invalidate the risk cache on user-rename in the auth layer or to
// drop the cache on this list path entirely.
type RiskRowWithOwner = {
    ownerUserId: string | null;
    owner?: { id: string; name: string | null; email: string | null } | null;
    [k: string]: unknown;
};
async function attachOwnerUsers<T extends RiskRowWithOwner>(
    ctx: RequestContext,
    rows: T[],
): Promise<T[]> {
    const ids = Array.from(
        new Set(
            rows
                .map((r) => r.ownerUserId)
                .filter((v): v is string => Boolean(v)),
        ),
    );
    if (ids.length === 0) {
        return rows.map((r) => ({ ...r, owner: null }));
    }
    const users = await runInTenantContext(ctx, (db) =>
        db.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, email: true },
        }),
    );
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
        ...r,
        owner: r.ownerUserId ? (byId.get(r.ownerUserId) ?? null) : null,
    }));
}

export async function getRisk(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const risk = await RiskRepository.getById(db, ctx, id);
        if (!risk) throw notFound('Risk not found');
        return risk;
    });
}

export async function createRisk(ctx: RequestContext, data: {
    title: string;
    description?: string | null;
    category?: string | null;
    threat?: string;
    vulnerability?: string;
    impact?: number;
    likelihood?: number;
    treatment?: string | null;
    treatmentOwner?: string | null;
    treatmentNotes?: string | null;
    ownerUserId?: string | null;
    targetDate?: string | null;
    nextReviewAt?: string | null;
}) {
    assertCanWrite(ctx);

    const created = await runInTenantContext(ctx, async (db) => {
        // Tenant lookup is global (Tenant table has no RLS)
        const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } });
        const maxScale = tenant?.maxRiskScale || 5;
        const inherentScore = calculateRiskScore(data.likelihood ?? 3, data.impact ?? 3, maxScale);

        const risk = await RiskRepository.create(db, ctx, {
            // Epic D.2 — sanitise free-text before persistence.
            title: sanitizePlainText(data.title),
            description: data.description ? sanitizePlainText(data.description) : null,
            category: data.category ? sanitizePlainText(data.category) : null,
            threat: data.threat ? sanitizePlainText(data.threat) : '',
            vulnerability: data.vulnerability ? sanitizePlainText(data.vulnerability) : '',
            impact: data.impact ?? 3,
            likelihood: data.likelihood ?? 3,
            inherentScore,
            score: inherentScore,

            treatment: (data.treatment || null) as TreatmentDecision | null,
            treatmentOwner: data.treatmentOwner ? sanitizePlainText(data.treatmentOwner) : null,
            treatmentNotes: data.treatmentNotes ? sanitizePlainText(data.treatmentNotes) : null,
            ownerUserId: data.ownerUserId || null,
            createdByUserId: ctx.userId,
            targetDate: data.targetDate ? new Date(data.targetDate) : null,
            nextReviewAt: data.nextReviewAt ? new Date(data.nextReviewAt) : null,
        });

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'Risk',
            entityId: risk.id,
            details: `Created risk: ${risk.title} (score: ${inherentScore})`,
            detailsJson: { category: 'custom', event: 'create' },
        });

        return risk;
    });
    await bumpEntityCacheVersion(ctx, 'risk');
    return created;
}

interface RiskCreateInput {
    title: string;
    description?: string | null;
    category?: string | null;
    threat?: string;
    vulnerability?: string;
    impact?: number;
    likelihood?: number;
    treatment?: string | null;
    treatmentOwner?: string | null;
    treatmentNotes?: string | null;
    ownerUserId?: string | null;
    status?: string;
    targetDate?: string | null;
    nextReviewAt?: string | null;
}

export async function createRiskFromTemplate(ctx: RequestContext, templateId: string, overrides: Partial<RiskCreateInput> = {}) {
    assertCanWrite(ctx);

    const template = await RiskTemplateRepository.getById(templateId);
    if (!template) throw notFound('Risk template not found');

    const created = await runInTenantContext(ctx, async (db) => {
        const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } });
        const maxScale = tenant?.maxRiskScale || 5;
        const likelihood = overrides.likelihood ?? template.defaultLikelihood;
        const impact = overrides.impact ?? template.defaultImpact;
        const score = calculateRiskScore(likelihood, impact, maxScale);

        const risk = await RiskRepository.create(db, ctx, {
            // Epic D.2 — sanitise the merged value (override OR template),
            // since the override comes from the API caller.
            title: sanitizePlainText(overrides.title ?? template.title),
            description: ((): string | null => {
                const v = overrides.description ?? template.description ?? null;
                return v ? sanitizePlainText(v) : null;
            })(),
            category: ((): string | null => {
                const v = overrides.category ?? template.category ?? null;
                return v ? sanitizePlainText(v) : null;
            })(),
            likelihood,
            impact,
            score,
            inherentScore: score,

            status: (overrides.status || 'OPEN') as RiskStatus,
            ownerUserId: overrides.ownerUserId || null,
            createdByUserId: ctx.userId,
            targetDate: overrides.targetDate ? new Date(overrides.targetDate) : null,
            nextReviewAt: overrides.nextReviewAt ? new Date(overrides.nextReviewAt) : null,
        });

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'Risk',
            entityId: risk.id,
            details: `Created risk from template: ${risk.title} (score: ${score})`,
            detailsJson: { category: 'custom', event: 'create' },
        });

        return risk;
    });
    await bumpEntityCacheVersion(ctx, 'risk');
    return created;
}

export async function updateRisk(ctx: RequestContext, id: string, data: {
    title?: string;
    description?: string | null;
    category?: string | null;
    threat?: string;
    vulnerability?: string;
    impact?: number;
    likelihood?: number;
    treatment?: string | null;
    treatmentOwner?: string | null;
    treatmentNotes?: string | null;
    ownerUserId?: string | null;
    status?: string;
    targetDate?: string | null;
    nextReviewAt?: string | null;
}) {
    assertCanWrite(ctx);

    const updated = await runInTenantContext(ctx, async (db) => {
        // Tenant lookup is global (Tenant table has no RLS)
        const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } });
        const maxScale = tenant?.maxRiskScale || 5;
        const inherentScore = data.likelihood && data.impact
            ? calculateRiskScore(data.likelihood, data.impact, maxScale)
            : undefined;

        const risk = await RiskRepository.update(db, ctx, id, {
            // Epic D.2 — sanitise on update only when the field is
            // actually being written (preserves "don't touch" semantics
            // for undefined; preserves explicit-clear for null).
            title: sanitizeOptional(data.title) ?? undefined,
            description: sanitizeOptional(data.description),
            category: sanitizeOptional(data.category),
            threat: sanitizeOptional(data.threat) ?? undefined,
            vulnerability: sanitizeOptional(data.vulnerability) ?? undefined,
            impact: data.impact,
            likelihood: data.likelihood,

            treatment: data.treatment as TreatmentDecision | undefined,
            treatmentOwner: sanitizeOptional(data.treatmentOwner),
            treatmentNotes: sanitizeOptional(data.treatmentNotes),
            targetDate: data.targetDate ? new Date(data.targetDate) : undefined,
            nextReviewAt: data.nextReviewAt ? new Date(data.nextReviewAt) : undefined,
            inherentScore,
            score: inherentScore,

            status: data.status as RiskStatus | undefined,
        });

        if (!risk) throw notFound('Risk not found');

        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'Risk',
            entityId: id,
            details: JSON.stringify(data),
            detailsJson: { category: 'custom', event: 'update' },
        });

        return risk;
    });
    await bumpEntityCacheVersion(ctx, 'risk');
    return updated;
}

export async function deleteRisk(ctx: RequestContext, id: string) {
    assertCanAdmin(ctx);

    const result = await runInTenantContext(ctx, async (db) => {
        const deleted = await RiskRepository.delete(db, ctx, id);
        if (!deleted) throw notFound('Risk not found');

        await logEvent(db, ctx, {
            action: 'SOFT_DELETE',
            entityType: 'Risk',
            entityId: id,
            details: 'Risk soft-deleted',
            detailsJson: { category: 'entity_lifecycle', entityName: 'Risk', operation: 'deleted', summary: 'SOFT_DELETE' },
        });

        return { success: true };
    });
    await bumpEntityCacheVersion(ctx, 'risk');
    return result;
}

// ─── Restore / Purge / Include Deleted ───

import { restoreEntity, purgeEntity } from './soft-delete-operations';
import { withDeleted } from '@/lib/soft-delete';

export async function restoreRisk(ctx: RequestContext, id: string) {
    const result = await restoreEntity(ctx, 'Risk', id);
    await bumpEntityCacheVersion(ctx, 'risk');
    return result;
}

export async function purgeRisk(ctx: RequestContext, id: string) {
    const result = await purgeEntity(ctx, 'Risk', id);
    await bumpEntityCacheVersion(ctx, 'risk');
    return result;
}

export async function listRisksWithDeleted(ctx: RequestContext) {
    assertCanAdmin(ctx);
    return runInTenantContext(ctx, (db) =>
        db.risk.findMany(withDeleted({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' as const } }))
    );
}

export async function linkControlToRisk(ctx: RequestContext, riskId: string, controlId: string) {
    assertCanWrite(ctx);

    const linked = await runInTenantContext(ctx, async (db) => {
        const rc = await RiskRepository.linkControl(db, ctx, riskId, controlId);
        if (!rc) throw notFound('Risk not found');

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'RiskControl',
            entityId: rc.id,
            details: `Mapped control ${controlId} to risk ${riskId}`,
            detailsJson: { category: 'custom', event: 'create' },
        });

        return rc;
    });
    // Linking affects both risk list (controls[] count) and control list
    // (risks[] count). Bump both.
    await bumpEntityCacheVersion(ctx, 'risk');
    await bumpEntityCacheVersion(ctx, 'control');
    return linked;
}

