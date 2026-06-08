/**
 * Vendor Renewal / Review Deadline Monitor
 *
 * Scheduled job that scans all tenants for vendors with upcoming or
 * overdue review/renewal dates. Returns both the legacy event output
 * and normalized `DueItem[]` for the unified monitoring architecture.
 *
 * Wraps the existing `findDueVendorsAndEmitEvents` service function
 * with the `runJob()` observability harness and returns a typed
 * `JobRunResult` for the scheduler.
 *
 * Schedule: daily at 07:00 UTC (see schedules.ts)
 *
 * @module app-layer/jobs/vendor-renewal-check
 */
import { runJob } from '@/lib/observability/job-runner';
import { logger } from '@/lib/observability/logger';
import type { DueItem, DueItemUrgency, JobRunResult } from './types';
import type { DueVendor } from '../services/vendor-renewals';
import { resolveDueItemOwner } from '../domain/due-item-ownership';
import { emitAutomationEvent } from '../automation';
import type { RequestContext } from '../types';

export interface VendorRenewalCheckOptions {
    tenantId?: string;
}

/**
 * Map a DueVendor from the legacy service into a normalized DueItem.
 */
function toDueItem(v: DueVendor, now: Date): DueItem {
    const diffMs = v.dueDate.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffMs / 86_400_000);

    let urgency: DueItemUrgency;
    if (v.type === 'REVIEW_OVERDUE' || v.type === 'RENEWAL_OVERDUE') {
        urgency = 'OVERDUE';
    } else if (daysRemaining <= 7) {
        urgency = 'URGENT';
    } else {
        urgency = 'UPCOMING';
    }

    const reasonMap: Record<DueVendor['type'], string> = {
        REVIEW_OVERDUE: `Vendor review overdue by ${Math.abs(daysRemaining)} day(s)`,
        REVIEW_DUE: `Vendor review due in ${daysRemaining} day(s)`,
        RENEWAL_OVERDUE: `Contract renewal overdue by ${Math.abs(daysRemaining)} day(s)`,
        RENEWAL_DUE: `Contract renewal due in ${daysRemaining} day(s)`,
    };

    return {
        entityType: 'VENDOR',
        entityId: v.id,
        tenantId: v.tenantId,
        name: v.name,
        reason: reasonMap[v.type],
        urgency,
        dueDate: v.dueDate.toISOString(),
        daysRemaining,
        ownerUserId: resolveDueItemOwner('VENDOR', v as unknown as Record<string, unknown>),
    };
}

/**
 * Run the vendor renewal/review deadline check.
 *
 * Delegates to the existing `findDueVendorsAndEmitEvents()` in
 * `services/vendor-renewals.ts` and wraps the result into
 * `JobRunResult` + normalized `DueItem[]`.
 */
export async function runVendorRenewalCheck(
    options: VendorRenewalCheckOptions = {},
): Promise<{ result: JobRunResult; items: DueItem[] }> {
    const jobRunId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const startMs = performance.now();

    return runJob('vendor-renewal-check', async () => {
        const now = new Date();
        const { findDueVendorsAndEmitEvents } = await import(
            '../services/vendor-renewals'
        );
        const dueVendors = await findDueVendorsAndEmitEvents({
            tenantId: options.tenantId,
        });

        // Convert to normalized DueItems
        const items = dueVendors.map(v => toDueItem(v, now));

        // Sort by urgency
        items.sort((a, b) => {
            const urgencyOrder = { OVERDUE: 0, URGENT: 1, UPCOMING: 2 };
            return urgencyOrder[a.urgency] - urgencyOrder[b.urgency]
                || a.daysRemaining - b.daysRemaining;
        });

        // Classify results
        const overdue = items.filter(i => i.urgency === 'OVERDUE').length;
        const urgent = items.filter(i => i.urgency === 'URGENT').length;
        const upcoming = items.filter(i => i.urgency === 'UPCOMING').length;

        logger.info('vendor renewal check completed', {
            component: 'job',
            jobName: 'vendor-renewal-check',
            scope: options.tenantId ? 'tenant-scoped' : 'system-wide',
            ...(options.tenantId ? { tenantId: options.tenantId } : {}),
            total: items.length,
            overdue,
            urgent,
            upcoming,
        });

        // Domain-emit (cycle-2 follow-up) — surface overdue vendor review/renewal
        // deadlines to automation. Best-effort; the system job has no user actor.
        const DAY_MS = 86_400_000;
        for (const v of dueVendors) {
            if (v.type !== 'REVIEW_OVERDUE' && v.type !== 'RENEWAL_OVERDUE') continue;
            await emitAutomationEvent(
                { tenantId: v.tenantId, userId: null } as unknown as RequestContext,
                {
                    event: 'VENDOR_ASSESSMENT_OVERDUE',
                    entityType: 'Vendor',
                    entityId: v.id,
                    actorUserId: null,
                    data: {
                        vendorName: v.name,
                        kind: v.type,
                        daysOverdue: Math.max(0, Math.floor((now.getTime() - v.dueDate.getTime()) / DAY_MS)),
                    },
                },
            ).catch(() => {});
        }

        const durationMs = Math.round(performance.now() - startMs);

        const result: JobRunResult = {
            jobName: 'vendor-renewal-check',
            jobRunId,
            success: true,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs,
            itemsScanned: items.length,
            itemsActioned: overdue + urgent,
            itemsSkipped: upcoming,
            details: {
                overdue,
                urgent,
                upcoming,
                overdueReviews: dueVendors.filter(v => v.type === 'REVIEW_OVERDUE').length,
                overdueRenewals: dueVendors.filter(v => v.type === 'RENEWAL_OVERDUE').length,
                upcomingReviews: dueVendors.filter(v => v.type === 'REVIEW_DUE').length,
                upcomingRenewals: dueVendors.filter(v => v.type === 'RENEWAL_DUE').length,
            },
        };

        return { result, items };
    }, { tenantId: options.tenantId });
}
