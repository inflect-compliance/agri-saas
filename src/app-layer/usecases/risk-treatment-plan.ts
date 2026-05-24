/**
 * Epic G-7 — Risk Treatment Plan usecases.
 *
 *   • createTreatmentPlan — admin/write creates a plan in DRAFT
 *   • addMilestone        — appends (or inserts at explicit sortOrder)
 *   • completeMilestone   — marks one milestone done; never silently
 *                            transitions the plan
 *   • completePlan        — admin closes the plan with a remark; only
 *                            valid when every milestone is complete
 *                            (or the plan has zero milestones — DRAFT/
 *                            ACCEPT-strategy plans frequently have no
 *                            milestones). Updates the linked risk
 *                            status per the strategy mapping below.
 *   • getOverduePlans     — read path used by the dashboard + the
 *                            eventual overdue-monitor job
 *
 * Risk-status mapping at plan completion:
 *   MITIGATE → CLOSED   (mitigation finished — risk is no longer open)
 *   ACCEPT   → ACCEPTED (formal risk acceptance)
 *   TRANSFER → CLOSED   (risk transferred to a third party)
 *   AVOID    → CLOSED   (risk eliminated by abandoning the activity)
 *
 * The brief calls out a `MITIGATED` target state. The existing
 * RiskStatus enum is `OPEN | MITIGATING | ACCEPTED | CLOSED`, so we
 * map the MITIGATE-completion semantically to `CLOSED` (the risk is
 * no longer an active issue). Adding a distinct `MITIGATED` value is
 * a bounded follow-up that would also need dashboard / list-page
 * updates to acknowledge the new bucket.
 *
 * Audit emission — every transition emits a hash-chained AuditLog
 * row. Categories: `entity_lifecycle` for create/add, `status_change`
 * for milestone-complete + plan-complete + risk-status-flip.
 */
import { RequestContext } from '../types';
import { RiskTreatmentPlanRepository } from '../repositories/RiskTreatmentPlanRepository';
import {
    assertCanAdmin,
    assertCanRead,
    assertCanWrite,
} from '../policies/common';
import { logEvent } from '../events/audit';
import { runInTenantContext } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { badRequest, notFound } from '@/lib/errors/types';
import {
    CreateTreatmentPlanSchema,
    AddMilestoneSchema,
    CompleteMilestoneSchema,
    CompletePlanSchema,
    ChangeStrategySchema,
    TransferOwnershipSchema,
    type CreateTreatmentPlanInput,
    type AddMilestoneInput,
    type CompleteMilestoneInput,
    type CompletePlanInput,
    type ChangeStrategyInput,
    type TransferOwnershipInput,
} from '../schemas/risk-treatment-plan.schemas';
import type {
    TreatmentStrategy,
    RiskStatus,
    PrismaClient,
} from '@prisma/client';

// ─── Strategy → risk-status mapping ─────────────────────────────────

/**
 * Audit Coherence S1 (2026-05-22) — `MITIGATE` plan completion now
 * maps to the new `MITIGATED` enum value (split out from `CLOSED`).
 * ISO 27001 Annex A treats "residual risk reduced to acceptable
 * level" as distinct from "risk eliminated"; the lifecycle now
 * reflects that.
 *
 * Other strategies are unchanged: TRANSFER + AVOID both eliminate
 * the risk from the tenant's books, so CLOSED is correct.
 */
function riskStatusForCompletedStrategy(
    strategy: TreatmentStrategy,
): RiskStatus {
    switch (strategy) {
        case 'MITIGATE':
            return 'MITIGATED';
        case 'ACCEPT':
            return 'ACCEPTED';
        case 'TRANSFER':
            return 'CLOSED';
        case 'AVOID':
            return 'CLOSED';
    }
}

/**
 * Residual score after a treatment plan completes.
 *
 * Inputs:
 *   `inheritedScore` is the risk's `score` at completion time (the
 *   "current" value — already reflects any likelihood/impact edits
 *   the owner made along the way).
 *   `strategy` drives the reduction factor.
 *
 * Reductions (rough alignment with ISO 27005 informal practice):
 *   MITIGATE  — divide by 5, floor at 1 (controls reduce the risk
 *               substantially but rarely to zero).
 *   ACCEPT    — unchanged (no controls implemented; residual = inherent).
 *   TRANSFER  — divide by 10, floor at 0 (third-party absorbs most of it).
 *   AVOID     — 0 (the activity creating the risk is gone).
 */
function residualScoreForCompletedStrategy(
    inheritedScore: number,
    strategy: TreatmentStrategy,
): number {
    switch (strategy) {
        case 'MITIGATE':
            return Math.max(1, Math.floor(inheritedScore / 5));
        case 'ACCEPT':
            return inheritedScore;
        case 'TRANSFER':
            return Math.max(0, Math.floor(inheritedScore / 10));
        case 'AVOID':
            return 0;
    }
}

// ─── Read paths ───────────────────────────────────────────────────────

export async function listTreatmentPlans(
    ctx: RequestContext,
    options: {
        take?: number;
        status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'OVERDUE';
        riskId?: string;
    } = {},
) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        RiskTreatmentPlanRepository.list(db, ctx, options),
    );
}

export async function getTreatmentPlan(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const plan = await RiskTreatmentPlanRepository.getById(db, ctx, id);
        if (!plan) throw notFound('Treatment plan not found');
        return plan;
    });
}

// ─── createTreatmentPlan ────────────────────────────────────────────

export interface CreateTreatmentPlanResult {
    treatmentPlanId: string;
}

export async function createTreatmentPlan(
    ctx: RequestContext,
    input: unknown,
): Promise<CreateTreatmentPlanResult> {
    assertCanWrite(ctx);
    const parsed: CreateTreatmentPlanInput =
        CreateTreatmentPlanSchema.parse(input);

    if (parsed.targetDate.getTime() <= Date.now()) {
        throw badRequest(
            'targetDate must be in the future — a treatment plan cannot start already overdue.',
        );
    }

    return runInTenantContext(ctx, async (db) => {
        // Verify the risk belongs to this tenant — composite FK
        // would surface a generic FK error; explicit check gives a
        // better message.
        const risk = await db.risk.findFirst({
            where: { id: parsed.riskId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, title: true },
        });
        if (!risk) throw notFound('Risk not found');

        const plan = await RiskTreatmentPlanRepository.create(db, ctx, {
            riskId: parsed.riskId,
            strategy: parsed.strategy,
            ownerUserId: parsed.ownerUserId,
            targetDate: parsed.targetDate,
        });

        await logEvent(db, ctx, {
            action: 'TREATMENT_PLAN_CREATED',
            entityType: 'RiskTreatmentPlan',
            entityId: plan.id,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'RiskTreatmentPlan',
                operation: 'create',
                summary: `Treatment plan created for risk "${risk.title}" (${parsed.strategy})`,
                after: {
                    riskId: parsed.riskId,
                    strategy: parsed.strategy,
                    ownerUserId: parsed.ownerUserId,
                    targetDateIso: parsed.targetDate.toISOString(),
                },
            },
        });

        return { treatmentPlanId: plan.id };
    });
}

// ─── addMilestone ───────────────────────────────────────────────────

export interface AddMilestoneResult {
    milestoneId: string;
    sortOrder: number;
}

export async function addMilestone(
    ctx: RequestContext,
    treatmentPlanId: string,
    input: unknown,
): Promise<AddMilestoneResult> {
    assertCanWrite(ctx);
    const parsed: AddMilestoneInput = AddMilestoneSchema.parse(input);

    return runInTenantContext(ctx, async (db) => {
        const plan = await db.riskTreatmentPlan.findFirst({
            where: { id: treatmentPlanId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, status: true, riskId: true },
        });
        if (!plan) throw notFound('Treatment plan not found');
        // Milestones can be added in DRAFT and ACTIVE state. Once a
        // plan is COMPLETED or OVERDUE we lock further modifications;
        // a redo means re-creating a fresh plan.
        if (plan.status === 'COMPLETED') {
            throw badRequest(
                'Cannot add a milestone to a COMPLETED plan; create a new plan instead.',
            );
        }

        // sortOrder: explicit ⇒ honour; else append.
        const sortOrder =
            parsed.sortOrder !== undefined
                ? parsed.sortOrder
                : await RiskTreatmentPlanRepository.countMilestones(
                      db,
                      ctx,
                      treatmentPlanId,
                  );

        const m = await RiskTreatmentPlanRepository.addMilestone(db, ctx, {
            treatmentPlanId,
            title: sanitizePlainText(parsed.title),
            description: parsed.description
                ? sanitizePlainText(parsed.description)
                : null,
            dueDate: parsed.dueDate,
            sortOrder,
            evidence: parsed.evidence ?? null,
        });

        await logEvent(db, ctx, {
            action: 'TREATMENT_MILESTONE_ADDED',
            entityType: 'TreatmentMilestone',
            entityId: m.id,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TreatmentMilestone',
                operation: 'create',
                summary: `Milestone "${m.title}" added to plan ${treatmentPlanId}`,
                after: {
                    treatmentPlanId,
                    sortOrder,
                    dueDateIso: parsed.dueDate.toISOString(),
                    hasEvidence: Boolean(parsed.evidence),
                },
            },
        });

        // Auto-transition: DRAFT → ACTIVE on first milestone add.
        // Canonical signal that "the plan is real, work has started".
        // Idempotent — `markActiveFromDraft` is keyed on status='DRAFT',
        // so re-adding milestones to an already-ACTIVE plan is a no-op.
        if (plan.status === 'DRAFT') {
            const flipped =
                await RiskTreatmentPlanRepository.markActiveFromDraft(
                    db,
                    ctx,
                    treatmentPlanId,
                );
            if (flipped > 0) {
                await logEvent(db, ctx, {
                    action: 'TREATMENT_PLAN_ACTIVATED',
                    entityType: 'RiskTreatmentPlan',
                    entityId: treatmentPlanId,
                    detailsJson: {
                        category: 'status_change',
                        entityName: 'RiskTreatmentPlan',
                        fromStatus: 'DRAFT',
                        toStatus: 'ACTIVE',
                        summary: `Plan ${treatmentPlanId} auto-activated on first milestone add`,
                        after: {
                            triggeredByMilestoneId: m.id,
                        },
                    },
                });
            }
        }

        return { milestoneId: m.id, sortOrder };
    });
}

// ─── changeStrategy ─────────────────────────────────────────────────

export interface ChangeStrategyResult {
    treatmentPlanId: string;
    fromStrategy: TreatmentStrategy;
    toStrategy: TreatmentStrategy;
}

/**
 * Change a plan's strategy mid-flight. Allowed in DRAFT, ACTIVE, and
 * OVERDUE — COMPLETED plans are immutable. Auditors get a row that
 * captures the rationale (required) so they can reconstruct why a
 * plan moved from MITIGATE → ACCEPT halfway through.
 */
export async function changeStrategy(
    ctx: RequestContext,
    treatmentPlanId: string,
    input: unknown,
): Promise<ChangeStrategyResult> {
    assertCanWrite(ctx);
    const parsed: ChangeStrategyInput = ChangeStrategySchema.parse(input);

    return runInTenantContext(ctx, async (db) => {
        const plan = await db.riskTreatmentPlan.findFirst({
            where: {
                id: treatmentPlanId,
                tenantId: ctx.tenantId,
                deletedAt: null,
            },
            select: { id: true, strategy: true, status: true },
        });
        if (!plan) throw notFound('Treatment plan not found');
        if (plan.status === 'COMPLETED') {
            throw badRequest(
                'Cannot change strategy on a COMPLETED plan; create a fresh plan instead.',
            );
        }
        if (plan.strategy === parsed.strategy) {
            throw badRequest(
                `Strategy is already ${parsed.strategy}; nothing to change.`,
            );
        }

        const count = await RiskTreatmentPlanRepository.updateStrategy(
            db,
            ctx,
            treatmentPlanId,
            parsed.strategy,
        );
        if (count === 0) {
            throw badRequest(
                'Plan state changed concurrently — refresh and retry.',
            );
        }

        await logEvent(db, ctx, {
            action: 'TREATMENT_PLAN_STRATEGY_CHANGED',
            entityType: 'RiskTreatmentPlan',
            entityId: treatmentPlanId,
            detailsJson: {
                category: 'status_change',
                entityName: 'RiskTreatmentPlan',
                fromStatus: plan.strategy,
                toStatus: parsed.strategy,
                summary: `Strategy changed: ${plan.strategy} → ${parsed.strategy}`,
                reason: sanitizePlainText(parsed.reason),
                after: {
                    fromStrategy: plan.strategy,
                    toStrategy: parsed.strategy,
                },
            },
        });

        return {
            treatmentPlanId,
            fromStrategy: plan.strategy as TreatmentStrategy,
            toStrategy: parsed.strategy,
        };
    });
}

// ─── completeMilestone ──────────────────────────────────────────────

export interface CompleteMilestoneResult {
    milestoneId: string;
    completedAt: Date;
}

export async function completeMilestone(
    ctx: RequestContext,
    milestoneId: string,
    input: unknown,
): Promise<CompleteMilestoneResult> {
    assertCanWrite(ctx);
    const parsed: CompleteMilestoneInput =
        CompleteMilestoneSchema.parse(input);

    return runInTenantContext(ctx, async (db) => {
        const m = await RiskTreatmentPlanRepository.getMilestone(
            db,
            ctx,
            milestoneId,
        );
        if (!m) throw notFound('Milestone not found');
        if (!m.treatmentPlan || m.treatmentPlan.deletedAt) {
            throw notFound('Treatment plan not found');
        }
        if (m.completedAt) {
            throw badRequest(
                'Milestone is already complete; re-completing is not supported.',
            );
        }
        if (m.treatmentPlan.status === 'COMPLETED') {
            throw badRequest(
                'Cannot complete a milestone on a COMPLETED plan.',
            );
        }

        const now = new Date();
        const count = await RiskTreatmentPlanRepository.markMilestoneCompleted(
            db,
            ctx,
            milestoneId,
            now,
            parsed.evidence,
        );
        if (count === 0) {
            throw badRequest(
                'Milestone state changed concurrently — refresh and retry.',
            );
        }

        await logEvent(db, ctx, {
            action: 'TREATMENT_MILESTONE_COMPLETED',
            entityType: 'TreatmentMilestone',
            entityId: milestoneId,
            detailsJson: {
                category: 'status_change',
                entityName: 'TreatmentMilestone',
                fromStatus: 'open',
                toStatus: 'completed',
                summary: `Milestone ${milestoneId} completed`,
                after: {
                    treatmentPlanId: m.treatmentPlan.id,
                    hasEvidence: Boolean(parsed.evidence ?? m.evidence),
                },
            },
        });

        return { milestoneId, completedAt: now };
    });
}

// ─── completePlan ───────────────────────────────────────────────────

export interface CompletePlanResult {
    treatmentPlanId: string;
    riskId: string;
    /// New risk status after the strategy → status mapping.
    newRiskStatus: RiskStatus;
}

/**
 * Closes a treatment plan with a required closing remark. Refuses to
 * close if any milestone is still incomplete — the brief is explicit:
 * "completePlan must not silently succeed if the plan is not actually
 * ready to complete." A plan with zero milestones (e.g. ACCEPT-
 * strategy plans) is closeable.
 *
 * On successful close, transitions the linked Risk to the strategy-
 * mapped status (see the riskStatusForCompletedStrategy helper above).
 * Both writes happen inside the same RLS-bound tenant context so a
 * partial state never leaks.
 */
export async function completePlan(
    ctx: RequestContext,
    treatmentPlanId: string,
    input: unknown,
): Promise<CompletePlanResult> {
    assertCanAdmin(ctx);
    const parsed: CompletePlanInput = CompletePlanSchema.parse(input);

    return runInTenantContext(ctx, async (db) => {
        const plan = await db.riskTreatmentPlan.findFirst({
            where: {
                id: treatmentPlanId,
                tenantId: ctx.tenantId,
                deletedAt: null,
            },
            select: {
                id: true,
                riskId: true,
                strategy: true,
                status: true,
                milestones: {
                    select: { id: true, completedAt: true },
                },
            },
        });
        if (!plan) throw notFound('Treatment plan not found');
        if (plan.status === 'COMPLETED') {
            throw badRequest('Plan is already complete.');
        }
        const incomplete = plan.milestones.filter((m) => !m.completedAt);
        if (incomplete.length > 0) {
            throw badRequest(
                `Cannot complete a plan with ${incomplete.length} incomplete milestone(s). ` +
                    `Either complete them first or remove them from the plan.`,
            );
        }

        const now = new Date();
        const count = await RiskTreatmentPlanRepository.markCompleted(
            db,
            ctx,
            treatmentPlanId,
            now,
            sanitizePlainText(parsed.closingRemark),
        );
        if (count === 0) {
            throw badRequest(
                'Plan state changed concurrently — refresh and retry.',
            );
        }

        // Transition the linked risk per the strategy → status table.
        const newRiskStatus = riskStatusForCompletedStrategy(
            plan.strategy as TreatmentStrategy,
        );
        const riskBefore = await db.risk.findUniqueOrThrow({
            where: { id: plan.riskId },
            select: { status: true, score: true, residualScore: true },
        });
        // Audit S1 — residual score reflects the post-controls risk
        // posture. Re-computed at every plan completion (subsequent
        // plans on the same risk overwrite the prior residual; the
        // audit trail records each change).
        const newResidualScore = residualScoreForCompletedStrategy(
            riskBefore.score,
            plan.strategy as TreatmentStrategy,
        );
        if (
            riskBefore.status !== newRiskStatus ||
            riskBefore.residualScore !== newResidualScore
        ) {
            await db.risk.update({
                where: { id: plan.riskId },
                data: {
                    status: newRiskStatus,
                    residualScore: newResidualScore,
                    residualScoreSetAt: now,
                },
            });
            await logEvent(db, ctx, {
                action: 'RISK_STATUS_CHANGED_BY_TREATMENT_PLAN',
                entityType: 'Risk',
                entityId: plan.riskId,
                detailsJson: {
                    category: 'status_change',
                    entityName: 'Risk',
                    fromStatus: riskBefore.status,
                    toStatus: newRiskStatus,
                    summary: `Risk status changed by completed treatment plan ${treatmentPlanId}`,
                    after: {
                        treatmentPlanId,
                        strategy: plan.strategy,
                        residualScore: newResidualScore,
                        residualScoreBefore: riskBefore.residualScore,
                        inheritedScore: riskBefore.score,
                    },
                },
            });
        }

        await logEvent(db, ctx, {
            action: 'TREATMENT_PLAN_COMPLETED',
            entityType: 'RiskTreatmentPlan',
            entityId: treatmentPlanId,
            detailsJson: {
                category: 'status_change',
                entityName: 'RiskTreatmentPlan',
                fromStatus: plan.status,
                toStatus: 'COMPLETED',
                summary: `Treatment plan ${treatmentPlanId} completed (${plan.strategy})`,
                after: {
                    riskId: plan.riskId,
                    strategy: plan.strategy,
                    milestoneCount: plan.milestones.length,
                    riskStatusAfter: newRiskStatus,
                },
            },
        });

        return {
            treatmentPlanId,
            riskId: plan.riskId,
            newRiskStatus,
        };
    });
}

// ─── transferOwnership ──────────────────────────────────────────────

export interface TransferOwnershipResult {
    treatmentPlanId: string;
    previousOwnerUserId: string;
    newOwnerUserId: string;
}

/**
 * Reassign a treatment plan's `ownerUserId` and emit a dedicated
 * audit event.
 *
 * Audit Coherence S1 (2026-05-22): prior to this usecase, ownership
 * changes would have only surfaced under a generic
 * `TREATMENT_PLAN_UPDATED` event (which didn't exist); the audit
 * row would have carried no semantic about who the prior owner was
 * or why the transfer happened. Auditors review ownership transfers
 * because they're a governance-sensitive action — a sabbatical /
 * departure / restructure that nobody documented surfaces as a gap.
 *
 * Authorization: `assertCanWrite` (same as `changeStrategy`). The
 * action is not admin-only — plan owners legitimately hand off to
 * peers during reorganisations — but it must still be writable
 * authority, not read-only.
 *
 * Idempotency: rejecting the same `newOwnerUserId` as the current
 * owner is a no-op error rather than a silent success; auditors
 * shouldn't see a stream of self-transfers.
 */
export async function transferTreatmentPlanOwnership(
    ctx: RequestContext,
    treatmentPlanId: string,
    input: unknown,
): Promise<TransferOwnershipResult> {
    assertCanWrite(ctx);
    const parsed: TransferOwnershipInput =
        TransferOwnershipSchema.parse(input);

    return runInTenantContext(ctx, async (db) => {
        const plan = await db.riskTreatmentPlan.findFirst({
            where: {
                id: treatmentPlanId,
                tenantId: ctx.tenantId,
                deletedAt: null,
            },
            select: {
                id: true,
                ownerUserId: true,
                status: true,
                riskId: true,
            },
        });
        if (!plan) throw notFound('Treatment plan not found');
        if (plan.status === 'COMPLETED') {
            throw badRequest(
                'Cannot transfer ownership of a completed plan — the plan is closed.',
            );
        }
        if (plan.ownerUserId === parsed.newOwnerUserId) {
            throw badRequest(
                'newOwnerUserId is already the current owner — nothing to transfer.',
            );
        }

        await db.riskTreatmentPlan.update({
            where: { id: treatmentPlanId },
            data: { ownerUserId: parsed.newOwnerUserId },
        });

        await logEvent(db, ctx, {
            action: 'TREATMENT_PLAN_OWNERSHIP_TRANSFERRED',
            entityType: 'RiskTreatmentPlan',
            entityId: treatmentPlanId,
            detailsJson: {
                category: 'access',
                entityName: 'RiskTreatmentPlan',
                summary:
                    `Treatment plan ${treatmentPlanId} ownership transferred ` +
                    `from ${plan.ownerUserId} to ${parsed.newOwnerUserId}`,
                before: { ownerUserId: plan.ownerUserId },
                after: {
                    ownerUserId: parsed.newOwnerUserId,
                    riskId: plan.riskId,
                    reason: sanitizePlainText(parsed.reason),
                },
            },
        });

        return {
            treatmentPlanId,
            previousOwnerUserId: plan.ownerUserId,
            newOwnerUserId: parsed.newOwnerUserId,
        };
    });
}

// ─── getOverduePlans ────────────────────────────────────────────────

export interface OverduePlan {
    id: string;
    tenantId: string;
    riskId: string;
    riskTitle: string | null;
    strategy: TreatmentStrategy;
    ownerUserId: string;
    targetDate: Date;
    status: 'DRAFT' | 'ACTIVE' | 'OVERDUE';
}

/**
 * Tenant-scoped — returns the caller's own non-completed plans
 * whose `targetDate` has elapsed. Used by the dashboard. The
 * monitor job (next prompt) uses the system-wide variant on the
 * repository directly.
 */
export async function getOverduePlans(
    ctx: RequestContext,
): Promise<OverduePlan[]> {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const rows = await RiskTreatmentPlanRepository.findOverdue(db, {
            now: new Date(),
            tenantId: ctx.tenantId,
        });
        return rows.map((r) => ({
            id: r.id,
            tenantId: r.tenantId,
            riskId: r.riskId,
            riskTitle: r.risk?.title ?? null,
            strategy: r.strategy,
            ownerUserId: r.ownerUserId,
            targetDate: r.targetDate,
            status: r.status as 'DRAFT' | 'ACTIVE' | 'OVERDUE',
        }));
    });
}

// ─── Internal helper export — used by the monitor job in prompt 4 ──

/**
 * System-wide overdue scan. The job runs unattended (no
 * RequestContext) so this helper takes a raw PrismaClient. It is
 * NOT permission-gated — the cron entrypoint is the authorization
 * boundary.
 */
export async function findOverduePlansSystemWide(
    db: PrismaClient,
    now: Date = new Date(),
) {
    return RiskTreatmentPlanRepository.findOverdue(db, { now });
}
