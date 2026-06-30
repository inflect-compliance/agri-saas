import { RequestContext } from '../types';
import { RiskRepository, RiskFilters, RiskListParams } from '../repositories/RiskRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { RiskTemplateRepository } from '../repositories/RiskTemplateRepository';
import { assertCanRead, assertCanWrite, assertCanAdmin } from '../policies/common';
import { logEvent } from '../events/audit';
import { notFound, badRequest } from '@/lib/errors/types';
import { calculateRiskScore } from '@/lib/risk-scoring';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { cachedListRead, bumpEntityCacheVersion } from '@/lib/cache/list-cache';
import { createAssignmentNotification } from '../notifications/assignment';
import { logger } from '@/lib/observability';
import type { TreatmentDecision, RiskStatus, TaskLinkEntityType, FairConfidence } from '@prisma/client';
// Value import — `Prisma.DbNull` is a runtime sentinel (RQ3-2 clears
// stored triples with it), not just a type namespace.
import { Prisma } from '@prisma/client';
import { computeTEF, computeVulnerability, computeLEF, computePLM, computeFairALE, pertMean } from './fair-calculator';
import { recordScoreEvent } from './risk-score-events';

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
            // B7 — fetch rows + unified linked-task counts (TaskLink RISK)
            // in one tenant context so the list page can show a Tasks column.
            const { rows, counts } = await runInTenantContext(
                ctx,
                async (db) => {
                    const rows = await RiskRepository.list(
                        db,
                        ctx,
                        filters,
                        options,
                    );
                    const counts =
                        await WorkItemRepository.countLinkedToEntities(
                            db,
                            ctx,
                            'RISK' as TaskLinkEntityType,
                            rows.map((r: { id: string }) => r.id),
                        );
                    return { rows, counts };
                },
            );
            const withCounts = rows.map((r) => ({
                ...r,
                taskTotal: counts.get(r.id)?.total ?? 0,
                taskDone: counts.get(r.id)?.done ?? 0,
            }));
            return attachOwnerUsers(ctx, withCounts);
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

        // RQ2-1 — opening INHERENT ledger entry, same transaction as
        // the row write so provenance can never drift from state.
        await recordScoreEvent(db, ctx.tenantId, {
            riskId: risk.id,
            kind: 'INHERENT',
            likelihood: data.likelihood ?? 3,
            impact: data.impact ?? 3,
            score: inherentScore,
            source: 'USER',
            createdByUserId: ctx.userId,
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

        // RQ2-1 — opening INHERENT ledger entry (template-accepted
        // values are a human decision → USER source).
        await recordScoreEvent(db, ctx.tenantId, {
            riskId: risk.id,
            kind: 'INHERENT',
            likelihood,
            impact,
            score,
            source: 'USER',
            justification: `Created from template: ${template.title}`,
            createdByUserId: ctx.userId,
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
    /// RQ2-1 — direct residual assessment. Both must be supplied
    /// together; residualScore is DERIVED from them (never accepted
    /// raw) and the write lands a RESIDUAL ledger event.
    residualLikelihood?: number;
    residualImpact?: number;
    /// Optional rationale recorded on the ledger event (override
    /// reasons etc.). Ignored when no score dimension changes.
    scoreJustification?: string | null;
    treatment?: string | null;
    treatmentOwner?: string | null;
    treatmentNotes?: string | null;
    ownerUserId?: string | null;
    status?: string;
    targetDate?: string | null;
    nextReviewAt?: string | null;
}) {
    assertCanWrite(ctx);

    const { risk: updated, previousOwnerId } = await runInTenantContext(ctx, async (db) => {
        // Tenant lookup is global (Tenant table has no RLS)
        const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } });
        const maxScale = tenant?.maxRiskScale || 5;
        const inherentScore = data.likelihood && data.impact
            ? calculateRiskScore(data.likelihood, data.impact, maxScale)
            : undefined;

        // RQ2-1 — residual decomposition: both-or-neither, derived
        // rollup. An incomplete pair is a caller bug, not a partial
        // write.
        if ((data.residualLikelihood === undefined) !== (data.residualImpact === undefined)) {
            throw badRequest(
                'residualLikelihood and residualImpact must be supplied together',
            );
        }
        const residualScore =
            data.residualLikelihood !== undefined && data.residualImpact !== undefined
                ? calculateRiskScore(data.residualLikelihood, data.residualImpact, maxScale)
                : undefined;

        // Capture the prior owner so the assignment notification only
        // fires on an actual change (not on every unrelated risk edit).
        const before = await RiskRepository.getById(db, ctx, id);
        const previousOwnerId = before?.ownerUserId ?? null;

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
            // "Assigned to" — undefined leaves it untouched; '' or null
            // clears (an empty string would be an invalid FK).
            ownerUserId:
                data.ownerUserId === undefined
                    ? undefined
                    : data.ownerUserId || null,
            targetDate: data.targetDate ? new Date(data.targetDate) : undefined,
            nextReviewAt: data.nextReviewAt ? new Date(data.nextReviewAt) : undefined,
            inherentScore,
            score: inherentScore,
            residualLikelihood: data.residualLikelihood,
            residualImpact: data.residualImpact,
            residualScore,
            residualScoreSetAt: residualScore !== undefined ? new Date() : undefined,

            status: data.status as RiskStatus | undefined,
        });

        if (!risk) throw notFound('Risk not found');

        // RQ2-1 — ledger entries, same transaction as the row write.
        if (inherentScore !== undefined) {
            await recordScoreEvent(db, ctx.tenantId, {
                riskId: id,
                kind: 'INHERENT',
                likelihood: data.likelihood as number,
                impact: data.impact as number,
                score: inherentScore,
                source: 'USER',
                justification: data.scoreJustification ?? null,
                createdByUserId: ctx.userId,
            });
        }
        if (residualScore !== undefined) {
            await recordScoreEvent(db, ctx.tenantId, {
                riskId: id,
                kind: 'RESIDUAL',
                likelihood: data.residualLikelihood as number,
                impact: data.residualImpact as number,
                score: residualScore,
                source: 'USER',
                justification: data.scoreJustification ?? null,
                createdByUserId: ctx.userId,
            });
        }

        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'Risk',
            entityId: id,
            details: JSON.stringify(data),
            detailsJson: { category: 'custom', event: 'update' },
        });

        return { risk, previousOwnerId };
    });
    await bumpEntityCacheVersion(ctx, 'risk');

    // In-app RISK_ASSIGNED bell notification for the new owner — only
    // when the assignee actually changed to a real user. Mirrors the
    // control-owner pattern: after-commit, own short transaction,
    // fire-and-forget, day-granular dedupe. See setControlOwner.
    const newOwnerId = updated.ownerUserId ?? null;
    if (newOwnerId && newOwnerId !== previousOwnerId && ctx.tenantSlug) {
        const tenantSlug = ctx.tenantSlug;
        try {
            await runInTenantContext(ctx, (db) =>
                createAssignmentNotification(db, 'RISK_ASSIGNED', {
                    tenantId: ctx.tenantId,
                    assigneeUserId: newOwnerId,
                    entityId: id,
                    entityLabel: updated.title ?? '(untitled)',
                    entityKey: updated.key ?? null,
                    tenantSlug,
                }),
            );
        } catch (err) {
            logger.warn('failed to create risk-assigned notification', {
                component: 'notifications',
                riskId: id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return updated;
}

// ── RQ-1 FAIR taxonomy ────────────────────────────────────────────────

/** A PERT triple as accepted on the wire (RQ3-2). */
export interface FairTripleInput {
    min: number;
    mode: number;
    max: number;
}

/** RQ3-2 — the five calibrated ranges; null clears a factor. */
export interface FairDistributionsInput {
    tef?: FairTripleInput | null;
    vulnerability?: FairTripleInput | null;
    plm?: FairTripleInput | null;
    slef?: FairTripleInput | null;
    slm?: FairTripleInput | null;
}

/** The FAIR input fields a client may set (all optional, all nullable). */
export interface RiskFairInput {
    threatEventFrequency?: number | null;
    contactFrequency?: number | null;
    probabilityOfAction?: number | null;
    vulnerabilityProbability?: number | null;
    threatCapability?: number | null;
    controlStrength?: number | null;
    primaryLossMagnitude?: number | null;
    productivityLoss?: number | null;
    responseCost?: number | null;
    replacementCost?: number | null;
    secondaryLossEventFrequency?: number | null;
    secondaryLossMagnitude?: number | null;
    regulatoryFineEstimate?: number | null;
    reputationDamageEstimate?: number | null;
    competitiveAdvantageLoss?: number | null;
    fairConfidence?: FairConfidence | null;
    fairInputsJson?: Record<string, unknown> | null;
    /** RQ3-2 — range-first path. When present (even null), the five
     *  triples become the source of truth: they are persisted to
     *  fairInputsJson and the point columns are DERIVED (PERT mean). */
    distributions?: FairDistributionsInput | null;
}

/**
 * RQ3-2 — canonicalise a wire triple: the three values are a
 * calibration SET; order is presentation. Sorting ascending recovers
 * the only coherent reading (smallest = min, middle = likely,
 * largest = max) and keeps the stored JSON safe for the simulator's
 * triangular inverse-CDF (a mode outside [min, max] would NaN it).
 * The panel's warn-only validator already told the user about the
 * inversion — the write path just refuses to store a poisoned triple.
 */
function normalizeTriple(t: FairTripleInput): FairTripleInput {
    const s = [t.min, t.mode, t.max].sort((a, b) => a - b);
    return { min: s[0], mode: s[1], max: s[2] };
}

/**
 * Recompute the stored FAIR derived columns (LEF, fairAle) from the
 * current inputs. Uses TEF/Vuln directly when set, else derives them
 * from their sub-factors. Clears the derived columns when there isn't
 * enough data — so a half-filled FAIR section never leaves a stale ALE.
 */
async function recomputeFairDerived(
    db: PrismaTx,
    tenantId: string,
    riskId: string,
): Promise<void> {
    const r = await db.risk.findFirst({ where: { id: riskId, tenantId } });
    if (!r) return;
    const tef =
        r.threatEventFrequency ??
        (r.contactFrequency != null && r.probabilityOfAction != null
            ? computeTEF(r.contactFrequency, r.probabilityOfAction)
            : null);
    const vuln =
        r.vulnerabilityProbability ??
        (r.threatCapability != null && r.controlStrength != null
            ? computeVulnerability(r.threatCapability, r.controlStrength)
            : null);

    if (tef == null || vuln == null) {
        // Not enough FAIR data — clear derived so analytics fall back to
        // legacy SLE×ARO via resolveALE.
        if (r.lossEventFrequency != null || r.fairAle != null) {
            await db.risk.update({
                where: { id: riskId },
                data: { lossEventFrequency: null, fairAle: null, fairComputedAt: new Date() },
            });
        }
        return;
    }

    const lef = computeLEF(tef, vuln);
    const plm = computePLM({
        productivityLoss: r.productivityLoss,
        responseCost: r.responseCost,
        replacementCost: r.replacementCost,
        flatEstimate: r.primaryLossMagnitude,
    });
    const fairAle = computeFairALE({
        tef,
        vulnerability: vuln,
        plm,
        slef: r.secondaryLossEventFrequency ?? 0,
        slm: r.secondaryLossMagnitude ?? 0,
    });
    await db.risk.update({
        where: { id: riskId },
        data: { lossEventFrequency: lef, fairAle, fairComputedAt: new Date() },
    });
}

/** Update a risk's FAIR inputs + recompute the derived LEF/ALE. */
export async function updateRiskFair(ctx: RequestContext, id: string, input: RiskFairInput) {
    assertCanWrite(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        const existing = await db.risk.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
        if (!existing) throw notFound('Risk not found');
        const { distributions, fairInputsJson, ...points } = input;
        if (distributions !== undefined) {
            // RQ3-2 — range-first path. The triples ARE the inputs;
            // every point column is derived (PERT mean), and the
            // legacy sub-factor columns are cleared so the panel's
            // single-source semantics hold (their information was
            // folded into the seeded ranges client-side).
            const norm = (t: FairTripleInput | null | undefined) => (t ? normalizeTriple(t) : null);
            const tef = norm(distributions?.tef);
            const vuln = norm(distributions?.vulnerability);
            const plm = norm(distributions?.plm);
            const slef = norm(distributions?.slef);
            const slm = norm(distributions?.slm);
            const stored: Record<string, FairTripleInput> = {};
            if (tef) stored.tef = tef;
            if (vuln) stored.vulnerability = vuln;
            if (plm) stored.plm = plm;
            if (slef) stored.slef = slef;
            if (slm) stored.slm = slm;
            const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
            await db.risk.update({
                where: { id },
                data: {
                    fairInputsJson: Object.keys(stored).length > 0
                        ? (stored as unknown as Prisma.InputJsonValue)
                        : Prisma.DbNull,
                    threatEventFrequency: tef ? pertMean(tef) : null,
                    vulnerabilityProbability: vuln ? clamp01(pertMean(vuln)) : null,
                    primaryLossMagnitude: plm ? pertMean(plm) : null,
                    secondaryLossEventFrequency: slef ? clamp01(pertMean(slef)) : null,
                    secondaryLossMagnitude: slm ? pertMean(slm) : null,
                    contactFrequency: null,
                    probabilityOfAction: null,
                    threatCapability: null,
                    controlStrength: null,
                    productivityLoss: null,
                    responseCost: null,
                    replacementCost: null,
                    fairConfidence: input.fairConfidence ?? undefined,
                },
            });
        } else {
            // Legacy point path (API back-compat). A NUMERIC point
            // write makes any stored triples stale — clear them unless
            // the caller is managing fairInputsJson explicitly, so the
            // simulator never prefers ranges the points have moved
            // past. (A confidence-only write touches no estimates and
            // leaves the triples alone.)
            const { fairConfidence: _conf, ...numericPoints } = points;
            const hasPointWrite = Object.values(numericPoints).some((v) => v !== undefined);
            const jsonValue =
                fairInputsJson !== undefined
                    ? fairInputsJson === null
                        ? Prisma.DbNull
                        : (fairInputsJson as Prisma.InputJsonValue)
                    : hasPointWrite
                      ? Prisma.DbNull
                      : undefined;
            await db.risk.update({
                where: { id },
                data: { ...points, fairInputsJson: jsonValue },
            });
        }
        await recomputeFairDerived(db, ctx.tenantId, id);
        await logEvent(db, ctx, {
            action: 'RISK_FAIR_UPDATED',
            entityType: 'Risk',
            entityId: id,
            details: 'Updated FAIR quantification inputs',
            detailsJson: { category: 'status_change', summary: 'FAIR inputs updated' },
        });
        return db.risk.findFirst({ where: { id, tenantId: ctx.tenantId } });
    });
    await bumpEntityCacheVersion(ctx, 'risk');
    return result;
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

/**
 * Bulk soft-delete risks — the table selection action-row's "Delete
 * selected". Mirrors {@link deleteRisk}: ADMIN-gated, tenant-scoped, one
 * audit row per deleted risk. `Risk` is a soft-delete model, so `deleteMany`
 * sets `deletedAt`; the `findMany` auto-filters already-deleted rows, so a
 * re-submit is idempotent. Returns the count actually deleted.
 */
export async function bulkDeleteRisk(
    ctx: RequestContext,
    riskIds: string[],
): Promise<{ deleted: number }> {
    assertCanAdmin(ctx);

    const result = await runInTenantContext(ctx, async (db) => {
        const rows = await db.risk.findMany({
            where: { id: { in: riskIds }, tenantId: ctx.tenantId },
            select: { id: true },
        });
        if (rows.length === 0) return { deleted: 0 };

        await db.risk.deleteMany({
            where: { id: { in: rows.map((r) => r.id) }, tenantId: ctx.tenantId },
        });

        for (const r of rows) {
            await logEvent(db, ctx, {
                action: 'SOFT_DELETE',
                entityType: 'Risk',
                entityId: r.id,
                details: 'Risk soft-deleted (bulk)',
                detailsJson: { category: 'entity_lifecycle', entityName: 'Risk', operation: 'deleted', summary: 'SOFT_DELETE' },
            });
        }

        return { deleted: rows.length };
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

// ─── Attached Evidence ───
//
// Evidence attached directly to a risk via `Evidence.riskId` — same
// pattern as Control/Task. The risk Evidence tab renders this through
// the shared <EvidenceSubTable> ({ links, evidence } shape; `links`
// always empty). Distinct from the read-only INHERITED evidence
// (aggregated from the risk's mapped controls), which the tab shows in
// its own section.

/** Risk attached-evidence payload — `{ links, evidence }` for the shared sub-table. */
export async function getRiskEvidenceTab(ctx: RequestContext, riskId: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const risk = await db.risk.findFirst({
            where: { id: riskId, tenantId: ctx.tenantId },
            select: { id: true },
        });
        if (!risk) throw notFound('Risk not found');
        const evidence = await db.evidence.findMany({
            where: { riskId, tenantId: ctx.tenantId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        return { links: [], evidence };
    });
}

/** Attach a URL as evidence on a risk (file uploads go through /evidence/uploads with a riskId). */
export async function linkRiskEvidence(
    ctx: RequestContext,
    riskId: string,
    data: { url: string; note?: string | null },
) {
    assertCanWrite(ctx);
    const url = data.url.trim();
    const note = data.note ? sanitizePlainText(data.note) : null;
    const result = await runInTenantContext(ctx, async (db) => {
        const risk = await db.risk.findFirst({
            where: { id: riskId, tenantId: ctx.tenantId },
            select: { id: true },
        });
        if (!risk) throw notFound('Risk not found');
        const evidence = await db.evidence.create({
            data: {
                tenantId: ctx.tenantId,
                riskId,
                type: 'LINK',
                title: note || url,
                content: url,
                status: 'DRAFT',
                ownerUserId: ctx.userId,
            },
        });
        await logEvent(db, ctx, {
            action: 'RISK_EVIDENCE_LINKED',
            entityType: 'Risk',
            entityId: riskId,
            details: `Evidence linked: ${url}`,
            detailsJson: { category: 'relationship', operation: 'linked', sourceEntity: 'Risk', sourceId: riskId, targetEntity: 'Evidence', targetId: evidence.id, relation: 'LINK' },
        });
        return evidence;
    });
    await bumpEntityCacheVersion(ctx, 'evidence');
    return result;
}

/** Detach evidence from a risk — clears `Evidence.riskId`; the evidence survives in the library. */
export async function unlinkRiskEvidence(
    ctx: RequestContext,
    riskId: string,
    evidenceId: string,
) {
    assertCanWrite(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const evidence = await db.evidence.findFirst({
            where: { id: evidenceId, riskId, tenantId: ctx.tenantId },
            select: { id: true },
        });
        if (!evidence) throw notFound('Risk evidence not found');
        await db.evidence.update({
            where: { id: evidenceId },
            data: { riskId: null },
        });
        await logEvent(db, ctx, {
            action: 'RISK_EVIDENCE_UNLINKED',
            entityType: 'Risk',
            entityId: riskId,
            details: `Evidence unlinked: ${evidenceId}`,
            detailsJson: { category: 'relationship', operation: 'unlinked', sourceEntity: 'Risk', sourceId: riskId, targetEntity: 'Evidence', targetId: evidenceId },
        });
        return { success: true };
    });
    await bumpEntityCacheVersion(ctx, 'evidence');
    return outcome;
}

