/**
 * Job Schedules — BullMQ Repeatable Job Definitions
 *
 * Defines the cron patterns and repeatable options for every scheduled job.
 * These are registered once by `scripts/scheduler.ts` and then BullMQ
 * automatically enqueues jobs at the specified cadence.
 *
 * Schedule semantics (preserved from legacy cron docs/comments):
 *   - automation-runner:       every 15 min (control check scheduling)
 *   - daily-evidence-expiry:   daily at 06:00 UTC (sweep + outbox)
 *   - data-lifecycle:          daily at 03:00 UTC (purge + retention)
 *   - policy-review-reminder:  daily at 08:00 UTC (overdue review audit)
 *   - task-due-notification:   daily at 08:00 local (NOTIFICATIONS_TZ) (in-app task deadline reminders)
 *   - retention-sweep:         daily at 04:00 UTC (evidence archival)
 *   - notification-dispatch:   daily at 07:00 UTC (single-pass: monitors + digest dispatch)
 *
 * IMPORTANT: deadline-monitor, evidence-expiry-monitor, and vendor-renewal-check
 * are NOT scheduled independently. They run as part of notification-dispatch
 * to prevent duplicate database scans. They remain registered in the executor
 * registry for ad-hoc/CLI/API use.
 *
 * Times are UTC unless the entry sets a `tz`. BullMQ uses standard
 * cron syntax and evaluates the `pattern` in `tz` when supplied.
 *
 * @module app-layer/jobs/schedules
 */
import type { JobName } from './types';
import { env } from '@/env';

export interface ScheduleDefinition {
    /** Job name — must match a key in JobPayloadMap */
    name: JobName;
    /** Cron pattern — evaluated in `tz` if set, otherwise UTC */
    pattern: string;
    /**
     * IANA timezone the cron `pattern` is evaluated in (DST-aware).
     * Omit for UTC. Passed straight into the BullMQ repeat options.
     */
    tz?: string;
    /** Human-readable description */
    description: string;
    /** Default payload for the repeatable job */
    defaultPayload: Record<string, unknown>;
    /** BullMQ repeat options */
    options?: {
        /** Timezone (default: UTC) */
        tz?: string;
        /** Max runs (undefined = forever) */
        limit?: number;
    };
}

/**
 * All scheduled jobs in the system.
 * Used by `scripts/scheduler.ts` to register repeatable jobs.
 */
export const SCHEDULED_JOBS: ScheduleDefinition[] = [
    {
        name: 'automation-runner',
        pattern: '*/15 * * * *',  // every 15 minutes
        description: 'Execute scheduled automation/integration checks for controls',
        defaultPayload: {},
    },
    {
        name: 'daily-evidence-expiry',
        pattern: '0 6 * * *',     // daily at 06:00 UTC
        description: 'Sweep expiring evidence at 30/7/1 day thresholds + flush outbox',
        defaultPayload: {},
    },
    {
        name: 'data-lifecycle',
        pattern: '0 3 * * *',     // daily at 03:00 UTC
        description: 'Purge soft-deleted records, expired evidence, and run retention sweep',
        defaultPayload: { dryRun: false },
    },
    {
        name: 'policy-review-reminder',
        pattern: '0 8 * * *',     // daily at 08:00 UTC
        description: 'Find overdue policies and emit audit events / notifications',
        defaultPayload: {},
    },
    {
        name: 'task-due-notification',
        // Daily at 08:00 in the configured local zone (NOTIFICATIONS_TZ,
        // default Europe/London) — the start of the working day, and
        // the same zone the windows are classified in so a task due
        // near local midnight is bucketed by the local calendar day.
        // Creates one in-app TASK_DUE notification per task at each of
        // three reminder windows: one week before, one day before, and
        // on the day the task's `dueAt` falls. Idempotent by local-tz
        // day — re-running is safe (dedupeKey unique index absorbs
        // repeats).
        pattern: '0 8 * * *',
        tz: env.NOTIFICATIONS_TZ,
        description:
            'Create in-app TASK_DUE notifications for tasks one week before, one day before, and on their due date.',
        defaultPayload: {},
    },
    {
        name: 'access-review-reminder',
        // Daily at 04:00 UTC — chosen so reminders land at the start
        // of the European workday and a few hours before
        // policy-review-reminder so the dedupe outbox isn't competing
        // for the per-tenant rate-limit token bucket. Idempotent
        // by-day, so re-running this is safe.
        pattern: '0 4 * * *',
        description:
            'Nudge access-review reviewers when their campaign deadline is approaching and decisions are still pending.',
        defaultPayload: {},
    },
    {
        name: 'exception-expiry-monitor',
        // Daily at 04:30 UTC — chosen to land between the 04:00
        // access-review reminder (G-4) and the 05:00 compliance-
        // snapshot, with idle DB capacity. Calendar-day-based
        // trigger means time-of-day drift doesn't move the window.
        pattern: '30 4 * * *',
        description:
            'Flag control exceptions approaching their `expiresAt` deadline at 30 / 14 / 7 day windows + emit reminder notifications.',
        defaultPayload: {},
    },
    {
        name: 'retention-sweep',
        pattern: '0 4 * * *',     // daily at 04:00 UTC
        description: 'Archive evidence with elapsed retention periods',
        defaultPayload: {},
    },
    {
        name: 'notification-dispatch',
        pattern: '0 7 * * *',     // daily at 07:00 UTC (single-pass: runs monitors internally)
        description: 'Single-pass pipeline: run all monitors → group by owner → dispatch digest notifications. Replaces separate monitor+dispatch schedule to prevent duplicate DB scans.',
        defaultPayload: {},
    },
    {
        name: 'compliance-snapshot',
        pattern: '0 5 * * *',     // daily at 05:00 UTC (before dashboard traffic)
        description: 'Generate daily ComplianceSnapshot for trend reporting. Idempotent — safe to re-run.',
        defaultPayload: {},
    },
    {
        name: 'compliance-digest',
        pattern: '0 8 * * 1',     // weekly Monday at 08:00 UTC
        description: 'Send weekly compliance digest email to tenant admins. Reuses snapshot data — no live aggregation.',
        defaultPayload: {},
    },
    {
        name: 'control-test-scheduler',
        pattern: '*/5 * * * *',   // every 5 minutes
        description:
            'Epic G-2 — scan ControlTestPlan rows with automationType IN (SCRIPT, INTEGRATION) and nextRunAt <= now, enqueue per-plan control-test-runner jobs.',
        defaultPayload: {},
    },
];

