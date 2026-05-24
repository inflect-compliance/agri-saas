/**
 * Control Test usecases — test plan lifecycle, test run execution, evidence linking.
 */
import { RequestContext } from '../types';
import { TestPlanRepository } from '../repositories/TestPlanRepository';
import { TestRunRepository } from '../repositories/TestRunRepository';
import { TestEvidenceRepository } from '../repositories/TestEvidenceRepository';
import {
    assertCanReadTests,
    assertCanManageTestPlans,
    assertCanExecuteTests,
    assertCanLinkTestEvidence,
} from '../policies/test.policies';
import {
    emitTestPlanCreated,
    emitTestPlanUpdated,
    emitTestPlanStatusChanged,
    emitTestRunCreated,
    emitTestRunCompleted,
    emitTestRunFailed,
    emitTestEvidenceLinked,
    emitTestEvidenceUnlinked,
} from '../events/test.events';
import { logEvent } from '../events/audit';
import { notFound, badRequest } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { computeNextDueAt } from '../utils/cadence';
import { createTask } from './task';

// Epic D.2 — preserve the three-state contract on update paths.
function sanitizeOptional(v: string | null | undefined): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return sanitizePlainText(v);
}

// ─── Queries ───

export async function listControlTestPlans(ctx: RequestContext, controlId: string) {
    assertCanReadTests(ctx);
    return runInTenantContext(ctx, (db) =>
        TestPlanRepository.listByControl(db, ctx, controlId)
    );
}

export async function getTestPlan(ctx: RequestContext, planId: string) {
    assertCanReadTests(ctx);
    return runInTenantContext(ctx, async (db) => {
        const plan = await TestPlanRepository.getById(db, ctx, planId);
        if (!plan) throw notFound('Test plan not found');
        return plan;
    });
}

export async function getTestRun(ctx: RequestContext, runId: string) {
    assertCanReadTests(ctx);
    return runInTenantContext(ctx, async (db) => {
        const run = await TestRunRepository.getById(db, ctx, runId);
        if (!run) throw notFound('Test run not found');
        return run;
    });
}

export async function listRunEvidence(ctx: RequestContext, runId: string) {
    assertCanReadTests(ctx);
    return runInTenantContext(ctx, (db) =>
        TestEvidenceRepository.listByRun(db, ctx, runId)
    );
}

// ─── Control effectiveness ─────────────────────────────────────────
//
// Audit Coherence S2 (2026-05-22) — auditors reviewing control
// operating effectiveness expect a "pass rate over the last N runs"
// number. Pre-this-PR they could read raw test-run rows from the
// detail page and compute it by eye; this surfaces the metric
// directly.

export interface ControlEffectiveness {
    controlId: string;
    /// Rolling pass rate over the window — `passes / total` rounded
    /// to a percentage 0–100. `null` if no completed runs in window.
    passRate: number | null;
    /// Count of completed runs (PASS + FAIL + INCONCLUSIVE) in window.
    total: number;
    passes: number;
    fails: number;
    inconclusive: number;
    /// The rolling window the metric covers. Defaults to 90 days
    /// (matches the audit-readiness scoring convention).
    windowDays: number;
}

const DEFAULT_EFFECTIVENESS_WINDOW_DAYS = 90;

export async function getControlEffectiveness(
    ctx: RequestContext,
    controlId: string,
    opts: { windowDays?: number } = {},
): Promise<ControlEffectiveness> {
    assertCanReadTests(ctx);
    const windowDays = opts.windowDays ?? DEFAULT_EFFECTIVENESS_WINDOW_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    return runInTenantContext(ctx, async (db) => {
        // Count COMPLETED runs in the window, grouped by `result`.
        const grouped = await db.controlTestRun.groupBy({
            by: ['result'],
            where: {
                tenantId: ctx.tenantId,
                controlId,
                status: 'COMPLETED',
                executedAt: { gte: cutoff },
            },
            _count: { _all: true },
        });
        let passes = 0;
        let fails = 0;
        let inconclusive = 0;
        for (const g of grouped) {
            const n = g._count._all;
            if (g.result === 'PASS') passes = n;
            else if (g.result === 'FAIL') fails = n;
            else if (g.result === 'INCONCLUSIVE') inconclusive = n;
        }
        const total = passes + fails + inconclusive;
        const passRate =
            total > 0 ? Math.round((passes / total) * 100) : null;
        return {
            controlId,
            passRate,
            total,
            passes,
            fails,
            inconclusive,
            windowDays,
        };
    });
}

// ─── Create / Update Test Plans ───
//
// Audit S2 OVERDUE semantics note (2026-05-22):
//
//   `TestPlanStatus` does NOT carry an `OVERDUE` value, by design.
//   A test plan's overdue-ness is derived live from `nextDueAt < now()`
//   — transient, computed on read (see test-readiness scoring). It is
//   NOT persisted as a status because test-plan due-dates roll forward
//   automatically on every run completion (`computeNextDueAt`); a
//   persisted OVERDUE state would race the next run.
//
//   This is intentional and DIFFERENT from `RiskTreatmentPlan`, which
//   persists `OVERDUE` and has a cron job to transition. Treatment
//   plans don't auto-roll their dates — they have a fixed targetDate
//   the owner needs to meet — so the persisted state is the right
//   shape there.
//
//   The audit flagged this as "inconsistency could confuse operators";
//   the resolution is to document the semantic difference here and at
//   the read sites (see `audits/readiness`-style consumers) rather
//   than over-unify the shapes.

export async function createTestPlan(ctx: RequestContext, controlId: string, input: {
    name: string;
    description?: string | null;
    method?: string;
    frequency?: string;
    ownerUserId?: string | null;
    expectedEvidence?: unknown;
    steps?: Array<{ instruction: string; expectedOutput?: string | null }>;
}) {
    assertCanManageTestPlans(ctx);

    // Epic D.2 — sanitise free-text on the test-plan write path. The
    // plan row itself is not in the encrypted-fields manifest, but
    // `name` + `description` + `steps[].instruction|expectedOutput`
    // surface in UI, audit details, and PDF exports — sanitise at
    // the row level so every downstream consumer is safe.
    const sanitisedInput = {
        ...input,
        name: sanitizePlainText(input.name),
        description: input.description ? sanitizePlainText(input.description) : input.description,
        steps: input.steps?.map((s) => ({
            instruction: sanitizePlainText(s.instruction),
            expectedOutput: s.expectedOutput == null
                ? s.expectedOutput
                : sanitizePlainText(s.expectedOutput),
        })),
    };
    return runInTenantContext(ctx, async (db) => {
        const plan = await TestPlanRepository.create(db, ctx, controlId, sanitisedInput);

        // Compute initial nextDueAt
        const nextDueAt = computeNextDueAt(input.frequency || 'AD_HOC');
        if (nextDueAt) {
            await TestPlanRepository.updateNextDueAt(db, ctx, plan.id, nextDueAt);
        }

        await emitTestPlanCreated(db, ctx, { id: plan.id, name: plan.name, controlId });
        return { ...plan, nextDueAt };
    });
}

export async function updateTestPlan(ctx: RequestContext, planId: string, patch: {
    name?: string;
    description?: string | null;
    method?: string;
    frequency?: string;
    ownerUserId?: string | null;
    expectedEvidence?: unknown;
    status?: string;
}) {
    assertCanManageTestPlans(ctx);

    // Epic D.2 — sanitise the free-text fields in the patch only when
    // they're actually being written (preserves "don't touch"
    // semantics for undefined).
    const sanitisedPatch = {
        ...patch,
        name: sanitizeOptional(patch.name) ?? undefined,
        description: sanitizeOptional(patch.description),
    };
    return runInTenantContext(ctx, async (db) => {
        const existing = await TestPlanRepository.getById(db, ctx, planId);
        if (!existing) throw notFound('Test plan not found');

        // Detect status change for event emission
        const oldStatus = existing.status;
        const newStatus = patch.status;

        const updated = await TestPlanRepository.update(db, ctx, planId, sanitisedPatch);

        // Recompute nextDueAt if frequency changed
        if (patch.frequency && patch.frequency !== existing.frequency) {
            const nextDueAt = computeNextDueAt(patch.frequency);
            await TestPlanRepository.updateNextDueAt(db, ctx, planId, nextDueAt);
        }

        // Emit events
        if (newStatus && newStatus !== oldStatus) {
            await emitTestPlanStatusChanged(db, ctx, planId, oldStatus, newStatus);
        } else {
            await emitTestPlanUpdated(db, ctx, planId, patch);
        }

        return updated;
    });
}

// ─── Test Runs ───

export async function createTestRun(ctx: RequestContext, planId: string) {
    assertCanExecuteTests(ctx);

    return runInTenantContext(ctx, async (db) => {
        const plan = await TestPlanRepository.getById(db, ctx, planId);
        if (!plan) throw notFound('Test plan not found');
        if (plan.status !== 'ACTIVE') throw badRequest('Cannot create a run for a paused test plan');

        const run = await TestRunRepository.create(db, ctx, {
            testPlanId: planId,
            controlId: plan.controlId,
        });

        await emitTestRunCreated(db, ctx, { id: run.id, testPlanId: planId });
        return run;
    });
}

export async function completeTestRun(ctx: RequestContext, runId: string, input: {
    result: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
    notes?: string | null;
    findingSummary?: string | null;
}) {
    assertCanExecuteTests(ctx);

    // Epic D.2 — `notes` and `findingSummary` are encrypted on
    // `ControlTestRun` and also surface verbatim in the auto-created
    // CONTROL_GAP task's description below. Sanitise once at the top
    // so the row at rest, the task body, and any audit/event payload
    // all carry the cleaned value.
    const sanitisedInput = {
        ...input,
        notes: sanitizeOptional(input.notes),
        findingSummary: sanitizeOptional(input.findingSummary),
    };
    return runInTenantContext(ctx, async (db) => {
        const run = await TestRunRepository.getById(db, ctx, runId);
        if (!run) throw notFound('Test run not found');
        if (run.status === 'COMPLETED') throw badRequest('Test run is already completed');

        // 1. Complete the run
        const completedRun = await TestRunRepository.complete(db, ctx, runId, sanitisedInput);

        // 2. Update the plan's nextDueAt based on frequency
        const plan = run.testPlan;
        if (plan) {
            const nextDueAt = computeNextDueAt(plan.frequency, new Date());
            await TestPlanRepository.updateNextDueAt(db, ctx, plan.id, nextDueAt);
        }

        // 3. Emit completion event
        await emitTestRunCompleted(db, ctx, {
            id: runId,
            result: input.result,
            testPlanId: run.testPlanId,
        });

        // 4. If FAIL, create a CONTROL_GAP task and emit failure event
        if (input.result === 'FAIL') {
            await emitTestRunFailed(db, ctx, { id: runId, findingSummary: sanitisedInput.findingSummary });

            try {
                await createTask(ctx, {
                    title: `Test failed: ${plan?.name || 'Unknown plan'}`,
                    type: 'CONTROL_GAP',
                    description: sanitisedInput.findingSummary || sanitisedInput.notes || 'A control test run failed and requires remediation.',
                    severity: 'HIGH',
                    priority: 'P1',
                    source: 'INTEGRATION',
                    controlId: run.controlId,
                    assigneeUserId: plan?.ownerUserId || null,
                    metadataJson: {
                        testRunId: runId,
                        testPlanId: run.testPlanId,
                        testPlanName: plan?.name,
                    },
                });
            } catch (taskErr) {
                // Log but don't fail the test completion if task creation fails
                await logEvent(db, ctx, {
                    action: 'TEST_RUN_TASK_CREATION_FAILED',
                    entityType: 'ControlTestRun',
                    entityId: runId,
                    details: `Failed to create follow-up task: ${taskErr instanceof Error ? taskErr.message : String(taskErr)}`,
                    detailsJson: {
                        category: 'custom',
                        event: 'task_creation_failed',
                        error: taskErr instanceof Error ? taskErr.message : String(taskErr),
                    },
                });
            }
        }

        return completedRun;
    });
}

// ─── Retest Flow ───

export async function retestFromRun(ctx: RequestContext, runId: string) {
    assertCanExecuteTests(ctx);

    return runInTenantContext(ctx, async (db) => {
        const run = await db.controlTestRun.findFirst({
            where: { id: runId, tenantId: ctx.tenantId },
            include: { testPlan: { select: { id: true, name: true, status: true, controlId: true } } },
        });
        if (!run) throw notFound('Test run not found');
        if (run.status !== 'COMPLETED') throw badRequest('Can only retest from a completed run');

        const plan = run.testPlan;
        if (!plan) throw notFound('Test plan not found');

        const newRun = await db.controlTestRun.create({
            data: {
                tenantId: ctx.tenantId,
                controlId: plan.controlId,
                testPlanId: plan.id,
                status: 'PLANNED',
                createdByUserId: ctx.userId,
                requestId: ctx.requestId,
            },
        });

        await emitTestRunCreated(db, ctx, { id: newRun.id, testPlanId: plan.id });

        await logEvent(db, ctx, {
            action: 'TEST_RETEST_CREATED',
            entityType: 'ControlTestRun',
            entityId: newRun.id,
            details: `Retest created from run ${runId}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ControlTestRun',
                operation: 'created',
                after: { originalRunId: runId, testPlanId: plan.id },
                summary: `Retest created from run ${runId}`,
            },
        });

        return newRun;
    });
}

// ─── Evidence Linking ───

export async function linkEvidenceToRun(ctx: RequestContext, runId: string, input: {
    kind: 'FILE' | 'EVIDENCE' | 'LINK' | 'INTEGRATION_RESULT';
    fileId?: string | null;
    evidenceId?: string | null;
    url?: string | null;
    integrationResultId?: string | null;
    note?: string | null;
}) {
    assertCanLinkTestEvidence(ctx);

    return runInTenantContext(ctx, async (db) => {
        const run = await TestRunRepository.getById(db, ctx, runId);
        if (!run) throw notFound('Test run not found');

        const link = await TestEvidenceRepository.link(db, ctx, {
            testRunId: runId,
            ...input,
        });

        await emitTestEvidenceLinked(db, ctx, { id: link.id, testRunId: runId, kind: input.kind });
        return link;
    });
}

export async function unlinkEvidenceFromRun(ctx: RequestContext, linkId: string) {
    assertCanLinkTestEvidence(ctx);

    return runInTenantContext(ctx, async (db) => {
        // Verify the link exists and belongs to this tenant
        const existing = await db.controlTestEvidenceLink.findFirst({
            where: { id: linkId, tenantId: ctx.tenantId },
        });
        if (!existing) throw notFound('Evidence link not found');

        await TestEvidenceRepository.unlink(db, ctx, linkId);
        await emitTestEvidenceUnlinked(db, ctx, linkId, existing.testRunId);
    });
}

// ─── Automation Bridge ───

/**
 * Create a completed test run from an automation/integration result.
 * Used when method=AUTOMATED and an integration check completes.
 */
export async function createAutomatedTestRun(
    ctx: RequestContext,
    planId: string,
    input: {
        result: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
        notes?: string | null;
        integrationResultId?: string | null;
        evidenceLinks?: Array<{
            kind: 'FILE' | 'LINK' | 'INTEGRATION_RESULT';
            fileId?: string | null;
            url?: string | null;
            integrationResultId?: string | null;
            note?: string | null;
        }>;
    },
) {
    assertCanExecuteTests(ctx);

    return runInTenantContext(ctx, async (db) => {
        const plan = await TestPlanRepository.getById(db, ctx, planId);
        if (!plan) throw notFound('Test plan not found');

        // Create run (starts as PLANNED)
        const run = await TestRunRepository.create(db, ctx, {
            controlId: plan.controlId,
            testPlanId: plan.id,
        });

        // Complete the run with result
        const completedRun = await TestRunRepository.complete(db, ctx, run.id, {
            result: input.result,
            notes: input.notes || `Automated run from integration`,
            findingSummary: input.result === 'FAIL' ? (input.notes || 'Automated check failed') : undefined,
        });

        // Advance cadence
        const nextDue = computeNextDueAt(plan.frequency, new Date());
        if (nextDue) {
            await TestPlanRepository.updateNextDueAt(db, ctx, plan.id, nextDue);
        }

        // Link evidence if provided
        if (input.evidenceLinks && input.evidenceLinks.length > 0) {
            for (const ev of input.evidenceLinks) {
                await TestEvidenceRepository.link(db, ctx, {
                    testRunId: run.id,
                    kind: ev.kind,
                    fileId: ev.fileId ?? null,
                    url: ev.url ?? null,
                    integrationResultId: ev.integrationResultId ?? input.integrationResultId ?? null,
                    note: ev.note ?? null,
                });
            }
        }

        // Create remediation task on FAIL (same pattern as completeTestRun)
        if (input.result === 'FAIL') {
            await emitTestRunFailed(db, ctx, { id: run.id, findingSummary: input.notes });

            try {
                await createTask(ctx, {
                    title: `Automated test failed: ${plan.name || 'Unknown plan'}`,
                    type: 'CONTROL_GAP',
                    description: input.notes || 'An automated control test run failed and requires remediation.',
                    severity: 'HIGH',
                    priority: 'P1',
                    source: 'INTEGRATION',
                    controlId: plan.controlId,
                    assigneeUserId: plan.ownerUserId || null,
                    metadataJson: {
                        testRunId: run.id,
                        testPlanId: plan.id,
                        testPlanName: plan.name,
                        automated: true,
                        integrationResultId: input.integrationResultId,
                    },
                });
            } catch (taskErr) {
                await logEvent(db, ctx, {
                    action: 'TEST_RUN_TASK_CREATION_FAILED',
                    entityType: 'ControlTestRun',
                    entityId: run.id,
                    details: `Failed to create follow-up task: ${taskErr instanceof Error ? taskErr.message : String(taskErr)}`,
                    detailsJson: {
                        category: 'custom',
                        event: 'task_creation_failed',
                        error: taskErr instanceof Error ? taskErr.message : String(taskErr),
                        automated: true,
                    },
                });
            }
        }

        await emitTestRunCompleted(db, ctx, {
            id: run.id,
            testPlanId: plan.id,
            result: input.result,
        });

        await logEvent(db, ctx, {
            action: 'AUTOMATED_TEST_RUN_CREATED',
            entityType: 'ControlTestRun',
            entityId: run.id,
            details: `Automated test run: ${input.result}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ControlTestRun',
                operation: 'created',
                after: {
                    testPlanId: plan.id,
                    result: input.result,
                    integrationResultId: input.integrationResultId,
                    evidenceCount: input.evidenceLinks?.length || 0,
                    automated: true,
                },
                summary: `Automated test run: ${input.result}`,
            },
        });

        return completedRun;
    });
}
