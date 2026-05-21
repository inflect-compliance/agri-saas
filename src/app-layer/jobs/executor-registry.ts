/**
 * Job Executor Registry — Typed Job Dispatch
 *
 * Provides a central, type-safe registry that maps job names to their
 * executor functions. This decouples job *dispatch* from job *scheduling*,
 * allowing any entrypoint (BullMQ worker, Vercel Cron route, node-cron,
 * CLI scripts) to execute jobs through one unified interface.
 *
 * Architecture:
 *   ┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
 *   │ BullMQ      │────▶│                  │────▶│ automation   │
 *   │ Worker      │     │  ExecutorRegistry │     │ runner       │
 *   ├─────────────┤     │                  │     ├──────────────┤
 *   │ Vercel Cron │────▶│  .execute(name,  │────▶│ evidence     │
 *   │ Route       │     │    payload)       │     │ expiry       │
 *   ├─────────────┤     │                  │     ├──────────────┤
 *   │ node-cron   │────▶│  .getExecutor()  │────▶│ retention    │
 *   │ Scheduler   │     │  .listRegistered()│    │ sweep        │
 *   └─────────────┘     └──────────────────┘     └──────────────┘
 *
 * Usage:
 *   import { executorRegistry } from '@/app-layer/jobs/executor-registry';
 *   const result = await executorRegistry.execute('vendor-renewal-check', {});
 *
 * Adding new jobs:
 *   1. Define payload in types.ts (JobPayloadMap)
 *   2. Create job module (e.g. vendor-renewal-check.ts)
 *   3. Register executor below
 *
 * @module app-layer/jobs/executor-registry
 */
import { logger } from '@/lib/observability/logger';
import { recordJobMetrics } from '@/lib/observability/metrics';
import { env } from '@/env';
import type { JobName, JobPayload, JobRunResult } from './types';

// ─── Executor Contract ──────────────────────────────────────────────

/**
 * Optional context the worker passes to executors that benefit from
 * mid-run observability hooks. Today only `updateProgress` is wired —
 * forwarded by the BullMQ worker as `(p) => job.updateProgress(p)`.
 * The Vercel Cron / node-cron / CLI entrypoints don't supply this
 * (they run outside a BullMQ Job), so executors must treat the
 * callbacks as optional and degrade gracefully when absent.
 *
 * Payload shape is intentionally `unknown` — each executor designs
 * its own progress JSON. The shape MUST NOT carry secrets, raw
 * keys, or anything sensitive: it's surfaced via the public job-
 * status endpoints.
 */
export interface JobExecutorContext {
    /**
     * Report mid-run progress. Called per meaningful boundary
     * (typically per batch / per phase). The callback awaits the
     * underlying transport (BullMQ -> Redis); executors should
     * `await` it so the GET status endpoint sees the latest value
     * immediately.
     */
    updateProgress?: (progress: unknown) => Promise<void>;
}

/**
 * A job executor function.
 *
 * Takes a typed payload and returns a `JobRunResult`.
 * Executors are responsible for:
 *   - Performing the job's business logic
 *   - Using `runJob()` for observability
 *   - Returning a consistent `JobRunResult`
 *   - NOT catching errors (let the registry handle fault isolation)
 *
 * The optional `ctx` argument carries worker-injected hooks (e.g.
 * BullMQ progress reporting). Executors that don't need it can
 * ignore it; entrypoints that don't supply it (cron, CLI) pass
 * nothing.
 */
export type JobExecutor<T extends JobName> = (
    payload: JobPayload<T>,
    ctx?: JobExecutorContext,
) => Promise<JobRunResult>;

// ─── Registry Implementation ────────────────────────────────────────

/**
 * Internal storage for registered executors.
 * Uses `Map` for O(1) lookup and safe iteration.
 */
const executors = new Map<string, JobExecutor<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The executor registry — singleton service.
 *
 * Thread-safe in Node.js (single-threaded). Registry mutations
 * (register) should only happen at module load time.
 */
export const executorRegistry = {
    /**
     * Register a job executor.
     *
     * @param name — job name (must match a key in JobPayloadMap)
     * @param executor — async function that processes the job
     * @throws if a duplicate registration is attempted
     */
    register<T extends JobName>(name: T, executor: JobExecutor<T>): void {
        if (executors.has(name)) {
            throw new Error(
                `Duplicate executor registration for job "${name}". ` +
                `Each job must have exactly one executor.`,
            );
        }
        executors.set(name, executor);
        logger.debug('executor registered', {
            component: 'executor-registry',
            jobName: name,
        });
    },

    /**
     * Execute a job by name with fault isolation.
     *
     * If the executor throws, the error is caught, logged, and
     * a failure `JobRunResult` is returned. One failing job
     * never crashes the scheduler or other jobs.
     *
     * @param name — job name
     * @param payload — typed payload
     * @param ctx — optional hooks (e.g. BullMQ progress callback)
     *   forwarded by the worker. Cron / CLI entrypoints leave this
     *   unset; executors that need progress must guard the calls.
     * @returns JobRunResult (always — never throws)
     */
    async execute<T extends JobName>(
        name: T,
        payload: JobPayload<T>,
        ctx?: JobExecutorContext,
    ): Promise<JobRunResult> {
        const executor = executors.get(name);
        const startedAt = new Date().toISOString();
        const startMs = performance.now();
        const jobRunId = crypto.randomUUID();

        if (!executor) {
            logger.error('no executor registered for job', {
                component: 'executor-registry',
                jobName: name,
            });
            return {
                jobName: name,
                jobRunId,
                success: false,
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs: 0,
                itemsScanned: 0,
                itemsActioned: 0,
                itemsSkipped: 0,
                errorMessage: `No executor registered for job "${name}"`,
            };
        }

        try {
            const result = await executor(payload, ctx);
            // ── Record job success metric ──
            recordJobMetrics({
                jobName: name,
                success: result.success,
                durationMs: result.durationMs ?? Math.round(performance.now() - startMs),
            });
            return result;
        } catch (error) {
            const durationMs = Math.round(performance.now() - startMs);
            const errorMessage = error instanceof Error
                ? error.message
                : String(error);

            logger.error('job executor threw', {
                component: 'executor-registry',
                jobName: name,
                jobRunId,
                durationMs,
                error: errorMessage,
            });

            // ── Record job failure metric ──
            recordJobMetrics({ jobName: name, success: false, durationMs });

            return {
                jobName: name,
                jobRunId,
                success: false,
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                itemsScanned: 0,
                itemsActioned: 0,
                itemsSkipped: 0,
                errorMessage,
            };
        }
    },

    /**
     * Get the executor for a job name (or undefined).
     * Useful for the BullMQ worker to check registration before dispatch.
     */
    getExecutor<T extends JobName>(name: T): JobExecutor<T> | undefined {
        return executors.get(name) as JobExecutor<T> | undefined;
    },

    /**
     * Check if an executor is registered for a job name.
     */
    has(name: string): boolean {
        return executors.has(name);
    },

    /**
     * List all registered job names.
     */
    listRegistered(): string[] {
        return Array.from(executors.keys());
    },

    /**
     * Total number of registered executors.
     */
    get size(): number {
        return executors.size;
    },

    /**
     * Clear all registrations. **Test-only.**
     * @internal
     */
    _reset(): void {
        executors.clear();
    },
};

// ─── Default Registrations ──────────────────────────────────────────
//
// Each registration uses dynamic import so that heavy modules
// (Prisma, integration SDK, etc.) are only loaded when the job
// actually executes — not at registry import time.
// ─────────────────────────────────────────────────────────────────────

/**
 * Helper: create a normalized JobRunResult from a legacy job's
 * ad-hoc return shape. Jobs that already return JobRunResult
 * should be registered directly.
 */
function makeResult(
    jobName: string,
    startedAt: string,
    startMs: number,
    scanned: number,
    actioned: number,
    skipped: number,
    details?: Record<string, unknown>,
): JobRunResult {
    return {
        jobName,
        jobRunId: crypto.randomUUID(),
        success: true,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startMs),
        itemsScanned: scanned,
        itemsActioned: actioned,
        itemsSkipped: skipped,
        details,
    };
}

// ── health-check ─────────────────────────────────────────────────────

executorRegistry.register('health-check', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    return makeResult('health-check', startedAt, startMs, 0, 0, 0, {
        enqueuedAt: payload.enqueuedAt,
        message: payload.message ?? 'pong',
        processedAt: new Date().toISOString(),
    });
});

// ── automation-runner ────────────────────────────────────────────────

executorRegistry.register('automation-runner', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runScheduledAutomations } = await import('./automation-runner');
    const r = await runScheduledAutomations({
        tenantId: payload.tenantId,
        dryRun: payload.dryRun,
    });
    return makeResult(
        'automation-runner', startedAt, startMs,
        r.totalDue, r.executed, r.skipped,
        { passed: r.passed, failed: r.failed, errors: r.errors, dryRun: r.dryRun },
    );
});

// ── daily-evidence-expiry ────────────────────────────────────────────

executorRegistry.register('daily-evidence-expiry', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runDailyEvidenceExpiryNotifications } = await import('./dailyEvidenceExpiry');
    const r = await runDailyEvidenceExpiryNotifications({
        tenantId: payload.tenantId,
        skipOutbox: payload.skipOutbox,
    });
    const totalCreated = r.sweeps.days30.tasksCreated
        + r.sweeps.days7.tasksCreated + r.sweeps.days1.tasksCreated;
    const totalSkipped = r.sweeps.days30.skippedDuplicate
        + r.sweeps.days7.skippedDuplicate + r.sweeps.days1.skippedDuplicate;
    const totalScanned = r.sweeps.days30.scanned
        + r.sweeps.days7.scanned + r.sweeps.days1.scanned;
    return makeResult(
        'daily-evidence-expiry', startedAt, startMs,
        totalScanned, totalCreated, totalSkipped,
        { sweeps: r.sweeps, outbox: r.outbox },
    );
});

// ── data-lifecycle ───────────────────────────────────────────────────

executorRegistry.register('data-lifecycle', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const {
        purgeSoftDeletedOlderThan,
        purgeExpiredEvidenceOlderThan,
        runRetentionSweep,
    } = await import('./data-lifecycle');

    const purgeResults = await purgeSoftDeletedOlderThan({
        tenantId: payload.tenantId,
        dryRun: payload.dryRun,
    });
    const evidencePurge = await purgeExpiredEvidenceOlderThan({
        tenantId: payload.tenantId,
        dryRun: payload.dryRun,
    });
    const retentionResults = await runRetentionSweep({
        tenantId: payload.tenantId,
        dryRun: payload.dryRun,
    });

    const totalScanned = purgeResults.reduce((s, r) => s + r.scanned, 0)
        + evidencePurge.scanned
        + retentionResults.reduce((s, r) => s + r.scanned, 0);
    const totalActioned = purgeResults.reduce((s, r) => s + r.purged, 0)
        + evidencePurge.purged
        + retentionResults.reduce((s, r) => s + r.expired, 0);

    return makeResult(
        'data-lifecycle', startedAt, startMs,
        totalScanned, totalActioned, 0,
        { purgeResults, evidencePurge, retentionResults },
    );
});

// ── policy-review-reminder ───────────────────────────────────────────

executorRegistry.register('policy-review-reminder', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processOverdueReminders } = await import('./policyReviewReminder');
    const { prisma } = await import('@/lib/prisma');
    const r = await processOverdueReminders(prisma, { tenantId: payload.tenantId });
    return makeResult(
        'policy-review-reminder', startedAt, startMs,
        r.processed, r.processed, 0,
        { policies: r.policies },
    );
});

// ── access-review-reminder (Epic G-4) ───────────────────────────────

executorRegistry.register('access-review-reminder', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processAccessReviewReminders } = await import(
        './access-review-reminder'
    );
    const { prisma } = await import('@/lib/prisma');
    const r = await processAccessReviewReminders(prisma, {
        tenantId: payload.tenantId,
    });
    return makeResult(
        'access-review-reminder',
        startedAt,
        startMs,
        r.scanned,
        r.enqueued,
        0,
        {
            skippedDuplicate: r.skippedDuplicate,
            skippedNoEmail: r.skippedNoEmail,
            skippedComplete: r.skippedComplete,
        },
    );
});

// ── exception-expiry-monitor (Epic G-5) ─────────────────────────────

executorRegistry.register('exception-expiry-monitor', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runExceptionExpiryMonitor } = await import(
        './exception-expiry-monitor'
    );
    const { prisma } = await import('@/lib/prisma');
    const r = await runExceptionExpiryMonitor(prisma, {
        tenantId: payload.tenantId,
    });
    return makeResult(
        'exception-expiry-monitor',
        startedAt,
        startMs,
        r.scanned,
        r.enqueued,
        0,
        {
            skippedDuplicate: r.skippedDuplicate,
            skippedNoEmail: r.skippedNoEmail,
            skippedNoRecipient: r.skippedNoRecipient,
        },
    );
});

// ── task-due-notification ───────────────────────────────────────────

executorRegistry.register('task-due-notification', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processTaskDueNotifications } = await import(
        './task-due-notification'
    );
    const { prisma } = await import('@/lib/prisma');
    const r = await processTaskDueNotifications(prisma, {
        tenantId: payload.tenantId,
        tz: env.NOTIFICATIONS_TZ,
    });
    return makeResult(
        'task-due-notification',
        startedAt,
        startMs,
        r.scanned,
        r.created,
        r.skippedDuplicate,
        { byWindow: r.byWindow },
    );
});

// ── retention-sweep ──────────────────────────────────────────────────

executorRegistry.register('retention-sweep', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runEvidenceRetentionSweep } = await import('./retention');
    const r = await runEvidenceRetentionSweep({
        tenantId: payload.tenantId,
        dryRun: payload.dryRun,
    });
    return makeResult(
        'retention-sweep', startedAt, startMs,
        r.scanned, r.archived, 0,
        { expired: r.expired, dryRun: r.dryRun },
    );
});

// ── vendor-renewal-check ─────────────────────────────────────────────

executorRegistry.register('vendor-renewal-check', async (payload) => {
    const { runVendorRenewalCheck } = await import('./vendor-renewal-check');
    const { result } = await runVendorRenewalCheck({ tenantId: payload.tenantId });
    return result;
});

// ── deadline-monitor ─────────────────────────────────────────────────

executorRegistry.register('deadline-monitor', async (payload) => {
    const { runDeadlineMonitor } = await import('./deadline-monitor');
    const { result } = await runDeadlineMonitor({
        tenantId: payload.tenantId,
        windows: payload.windows,
    });
    return result;
});

// ── evidence-expiry-monitor ──────────────────────────────────────────

executorRegistry.register('evidence-expiry-monitor', async (payload) => {
    const { runEvidenceExpiryMonitor } = await import('./evidence-expiry-monitor');
    const { result } = await runEvidenceExpiryMonitor({
        tenantId: payload.tenantId,
        windows: payload.windows,
    });
    return result;
});

// ── notification-dispatch ────────────────────────────────────────────

executorRegistry.register('notification-dispatch', async (payload) => {
    const { runNotificationDispatch } = await import('./notification-dispatch');
    const { result } = await runNotificationDispatch({
        tenantId: payload.tenantId,
        categories: payload.categories,
        windows: payload.windows,
    });
    return result;
});

// ── sync-pull ────────────────────────────────────────────────────────

executorRegistry.register('sync-pull', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runSyncPull } = await import('./sync-pull');
    await runSyncPull(payload);
    return makeResult('sync-pull', startedAt, startMs, 1, 1, 0, {
        provider: payload.mappingKey.provider,
        remoteEntityType: payload.mappingKey.remoteEntityType,
    });
});

// ── compliance-snapshot ──────────────────────────────────────────────

executorRegistry.register('compliance-snapshot', async (payload) => {
    const { runSnapshotJob } = await import('./snapshot');
    const { result } = await runSnapshotJob({
        tenantId: payload.tenantId,
        date: payload.date ? new Date(payload.date) : undefined,
    });
    return result;
});

// ── compliance-digest ────────────────────────────────────────────────

executorRegistry.register('compliance-digest', async (payload) => {
    const { runComplianceDigest } = await import('./compliance-digest');
    const { result } = await runComplianceDigest({
        tenantId: payload.tenantId,
        recipientOverrides: payload.recipientOverrides,
        trendDays: payload.trendDays,
    });
    return result;
});

// ── key-rotation (Epic B.3) ──────────────────────────────────────────

executorRegistry.register('key-rotation', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runKeyRotation } = await import('./key-rotation');
    const r = await runKeyRotation({
        tenantId: payload.tenantId,
        initiatedByUserId: payload.initiatedByUserId,
        requestId: payload.requestId,
    });
    return makeResult(
        'key-rotation',
        startedAt,
        startMs,
        r.totalScanned,
        r.totalRewritten,
        0,
        {
            tenantId: r.tenantId,
            dekRewrapped: r.dekRewrapped,
            dekRewrapError: r.dekRewrapError,
            perField: r.perField,
            totalErrors: r.totalErrors,
            jobRunId: r.jobRunId,
        },
    );
});

// ── tenant-dek-rotation (Epic F.2 follow-up) ────────────────────────

executorRegistry.register('tenant-dek-rotation', async (payload, ctx) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runTenantDekRotation } = await import('./tenant-dek-rotation');
    const r = await runTenantDekRotation({
        tenantId: payload.tenantId,
        initiatedByUserId: payload.initiatedByUserId,
        requestId: payload.requestId,
        batchSize: payload.batchSize,
        // GAP-22: forward the worker's progress callback so the GET
        // /admin/tenant-dek-rotation status endpoint sees live
        // counters mid-rotation, not just empty progress until the
        // job completes.
        onProgress: ctx?.updateProgress,
    });
    return makeResult(
        'tenant-dek-rotation',
        startedAt,
        startMs,
        r.totalScanned,
        r.totalRewritten,
        r.totalSkipped,
        {
            tenantId: r.tenantId,
            previousEncryptedDekCleared: r.previousEncryptedDekCleared,
            perField: r.perField,
            totalErrors: r.totalErrors,
            jobRunId: r.jobRunId,
        },
    );
});

// ── automation-event-dispatch ────────────────────────────────────────
//
// One job invocation per domain event. Loads matching rules, evaluates
// filters, claims an AutomationExecution row per match, advances to
// SUCCEEDED/FAILED. See `automation-event-dispatch.ts` for the full
// flow + scope boundaries.

executorRegistry.register('automation-event-dispatch', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runAutomationEventDispatch } = await import(
        './automation-event-dispatch'
    );
    const r = await runAutomationEventDispatch(payload);
    return makeResult(
        'automation-event-dispatch',
        startedAt,
        startMs,
        r.rulesConsidered,
        r.executionsCreated,
        r.executionsSkippedDuplicate + r.executionsSkippedFilter,
        {
            tenantId: r.tenantId,
            event: r.event,
            rulesMatched: r.rulesMatched,
            executionsFailed: r.executionsFailed,
            jobRunId: r.jobRunId,
        }
    );
});

// ── control-test-scheduler + control-test-runner (Epic G-2) ──────────
//
// Scheduler claims due ControlTestPlan rows and enqueues per-plan
// runner jobs (deduplicated by `ctr:{planId}:{scheduledForIso}`).
// The runner materializes each into a ControlTestRun + auto-evidence
// + (on automated FAIL) a Finding linked to the control via the
// FindingEvidence → Evidence → controlId chain.

executorRegistry.register('control-test-scheduler', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runControlTestScheduler } = await import('./control-test-scheduler');
    const r = await runControlTestScheduler({
        tenantId: payload.tenantId,
        now: payload.nowIso ? new Date(payload.nowIso) : undefined,
        dryRun: payload.dryRun,
    });
    return makeResult(
        'control-test-scheduler',
        startedAt,
        startMs,
        r.totalDue,
        r.enqueued,
        r.skippedClaimRace +
            r.skippedInvalidSchedule +
            r.bootstrapped,
        {
            bootstrapped: r.bootstrapped,
            enqueued: r.enqueued,
            skippedClaimRace: r.skippedClaimRace,
            skippedInvalidSchedule: r.skippedInvalidSchedule,
            enqueueFailures: r.enqueueFailures,
            dryRun: r.dryRun,
            jobRunId: r.jobRunId,
        },
    );
});

executorRegistry.register('control-test-runner', async (payload) => {
    // tenantId scoping happens one frame down in `runControlTestRunner`:
    // it loads the plan via
    //   prisma.controlTestPlan.findFirst({ where: { id, tenantId: payload.tenantId } })
    // and every subsequent write goes through `runInTenantContext`
    // bound to that same tenantId. Referencing `payload.tenantId`
    // here documents the contract for the scope-audit ratchet.
    const { controlTestRunnerExecutor } = await import('./control-test-runner');
    return controlTestRunnerExecutor(payload);
});

// ── evidence-import (Epic 43.3) ──────────────────────────────────────
//
// One job invocation per uploaded ZIP. The HTTP layer stages the
// archive under `temp/<tenantId>/...` and enqueues this job; the
// worker streams the archive, runs the safety guards, and creates
// individual evidence rows via `uploadEvidenceFile`. See
// `evidence-import.ts` for the full safety bound + cleanup flow.

executorRegistry.register('evidence-import', async (payload, ctx) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runEvidenceImport } = await import('./evidence-import');
    const r = await runEvidenceImport(payload, async (progress) => {
        // Forward live counters to the BullMQ progress channel so the
        // GET /evidence/imports/:jobId status endpoint can show
        // mid-flight progress instead of waiting for completion.
        if (ctx?.updateProgress) {
            await ctx.updateProgress(progress);
        }
    });
    return makeResult(
        'evidence-import',
        startedAt,
        startMs,
        r.totalEntries,
        r.extracted,
        r.skipped + r.errored,
        {
            tenantId: r.tenantId,
            extracted: r.extracted,
            skipped: r.skipped,
            errored: r.errored,
            evidenceIds: r.evidenceIds,
            skipReasons: r.skipReasons,
            firstError: r.firstError,
            jobRunId: r.jobRunId,
        },
    );
});

