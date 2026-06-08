/**
 * Policy Review Reminder Job Stub
 *
 * This module provides functions to find overdue policies and process review reminders.
 * It is designed to be called from a cron job or scheduler.
 *
 * TENANT ISOLATION: When `tenantId` is provided, all queries are scoped
 * to that single tenant. The system-wide scan (no tenantId) is only used
 * by the scheduled global cron and is clearly separated.
 *
 * ## How to hook into cron:
 *
 * ### Option 1: Vercel Cron (recommended for serverless)
 * Create a route at `src/app/api/cron/policy-review/route.ts`:
 * - Verify the Authorization header matches your CRON_SECRET env var
 * - Call `processOverdueReminders(getDbClient())`
 * - Add to vercel.json: `{ "crons": [{ "path": "/api/cron/policy-review", "schedule": "0 8 * * *" }] }`
 *
 * ### Option 2: node-cron (for self-hosted)
 * - Import this module and `getDbClient` from `@/lib/db-context`
 * - Schedule with: `cron.schedule('0 8 * * *', () => processOverdueReminders(getDbClient()))`
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/observability/logger';
import { emitAutomationEvent } from '../automation';
import type { RequestContext } from '../types';

export interface OverduePolicy {
    id: string;
    tenantId: string;
    title: string;
    slug: string;
    nextReviewAt: Date;
    daysOverdue: number;
    ownerUserId: string | null;
}

export interface PolicyReminderOptions {
    /** When provided, scope ALL queries to this tenant only. */
    tenantId?: string;
}

/**
 * Determine if a policy is overdue based on its nextReviewAt date.
 * Pure function, suitable for unit testing.
 */
export function isPolicyOverdue(nextReviewAt: Date | null | undefined, now: Date = new Date()): boolean {
    if (!nextReviewAt) return false;
    return nextReviewAt < now;
}

/**
 * Calculate days overdue. Returns 0 if not overdue.
 */
export function daysOverdue(nextReviewAt: Date | null | undefined, now: Date = new Date()): number {
    if (!nextReviewAt || nextReviewAt >= now) return 0;
    const diff = now.getTime() - nextReviewAt.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Find policies that are overdue for review.
 *
 * @param db        PrismaClient instance (dependency injection for testability)
 * @param options   If tenantId is provided, only scan that tenant's policies.
 *                  If omitted, scans all tenants (system-wide mode).
 */
export async function findOverduePolicies(
    db: PrismaClient,
    options: PolicyReminderOptions = {},
): Promise<OverduePolicy[]> {
    const now = new Date();
    const { tenantId } = options;
    const scope = tenantId ? 'tenant-scoped' : 'system-wide';

    logger.info('policy review scan starting', {
        component: 'policy-review-reminder',
        scope,
        ...(tenantId ? { tenantId } : {}),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
        nextReviewAt: { lt: now },
        status: { not: 'ARCHIVED' },
    };
    if (tenantId) where.tenantId = tenantId;

    const policies = await db.policy.findMany({
        where,
        select: {
            id: true,
            tenantId: true,
            title: true,
            slug: true,
            nextReviewAt: true,
            ownerUserId: true,
        },
    });

    const results = policies
        .filter(p => p.nextReviewAt !== null)
        .map(p => ({
            ...p,
            nextReviewAt: p.nextReviewAt!,
            daysOverdue: daysOverdue(p.nextReviewAt, now),
        }));

    logger.info('policy review scan completed', {
        component: 'policy-review-reminder',
        scope,
        ...(tenantId ? { tenantId } : {}),
        total: results.length,
    });

    return results;
}

/**
 * Process overdue policy reminders.
 *
 * @param db        PrismaClient instance (dependency injection)
 * @param options   If tenantId is provided, only process that tenant's policies.
 */
export async function processOverdueReminders(
    db: PrismaClient,
    options: PolicyReminderOptions = {},
): Promise<{
    processed: number;
    policies: Array<{ id: string; tenantId: string; title: string; daysOverdue: number }>;
}> {
    const overdue = await findOverduePolicies(db, options);

    for (const policy of overdue) {
        await db.auditLog.create({
            data: {
                tenantId: policy.tenantId,
                userId: null,
                action: 'POLICY_REVIEW_OVERDUE',
                entity: 'Policy',
                entityId: policy.id,
                details: `Policy "${policy.title}" is ${policy.daysOverdue} day(s) overdue for review.`,
            },
        });
        // Domain-emit (cycle-2 follow-up) — surface policy-governance deadlines
        // to automation. Best-effort; the system job carries no user actor.
        await emitAutomationEvent(
            { tenantId: policy.tenantId, userId: null } as unknown as RequestContext,
            {
                event: 'POLICY_REVIEW_DUE',
                entityType: 'Policy',
                entityId: policy.id,
                actorUserId: null,
                data: {
                    title: policy.title,
                    nextReviewAt: policy.nextReviewAt.toISOString(),
                    daysOverdue: policy.daysOverdue,
                },
            },
        ).catch(() => {});
    }

    return {
        processed: overdue.length,
        policies: overdue.map(p => ({
            id: p.id,
            tenantId: p.tenantId,
            title: p.title,
            daysOverdue: p.daysOverdue,
        })),
    };
}
