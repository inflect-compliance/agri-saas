/**
 * Vendor Renewals & Reminders Job Stubs
 *
 * These functions would be called by a cron job / worker.
 * For now they emit events; no email provider required.
 *
 * TENANT ISOLATION: When `tenantId` is provided, all queries are scoped
 * to that single tenant. The global/system scan (no tenantId) is only
 * used by the scheduled system-wide cron and is clearly separated.
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/observability/logger';

export interface DueVendor {
    id: string;
    tenantId: string;
    name: string;
    ownerUserId: string | null;
    type: 'REVIEW_DUE' | 'REVIEW_OVERDUE' | 'RENEWAL_DUE' | 'RENEWAL_OVERDUE';
    dueDate: Date;
}

export interface VendorRenewalOptions {
    /** When provided, scope ALL queries to this tenant only. */
    tenantId?: string;
}

/**
 * Find vendors with upcoming or overdue reviews/renewals and emit events.
 *
 * @param options.tenantId  If provided, only scan vendors belonging to this tenant.
 *                          If omitted, scans all tenants (system-wide mode).
 */
export async function findDueVendorsAndEmitEvents(
    options: VendorRenewalOptions = {},
): Promise<DueVendor[]> {
    const { tenantId } = options;
    const scope = tenantId ? 'tenant-scoped' : 'system-wide';

    logger.info('vendor renewal scan starting', {
        component: 'vendor-renewals',
        scope,
        ...(tenantId ? { tenantId } : {}),
    });

    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400000);

    const results: DueVendor[] = [];

    // Build a base `where` clause that includes tenantId when scoped
    const tenantFilter = tenantId ? { tenantId } : {};

    // Overdue reviews
    const overdueReviews = await prisma.vendor.findMany({
        where: { ...tenantFilter, nextReviewAt: { lt: now }, status: { not: 'OFFBOARDED' } },
        select: { id: true, tenantId: true, name: true, ownerUserId: true, nextReviewAt: true },
    });
    for (const v of overdueReviews) {
        results.push({ id: v.id, tenantId: v.tenantId, name: v.name, ownerUserId: v.ownerUserId, type: 'REVIEW_OVERDUE', dueDate: v.nextReviewAt! });
    }

    // Reviews due in 30 days
    const dueReviews = await prisma.vendor.findMany({
        where: { ...tenantFilter, nextReviewAt: { gte: now, lte: in30 }, status: { not: 'OFFBOARDED' } },
        select: { id: true, tenantId: true, name: true, ownerUserId: true, nextReviewAt: true },
    });
    for (const v of dueReviews) {
        results.push({ id: v.id, tenantId: v.tenantId, name: v.name, ownerUserId: v.ownerUserId, type: 'REVIEW_DUE', dueDate: v.nextReviewAt! });
    }

    // Overdue renewals
    const overdueRenewals = await prisma.vendor.findMany({
        where: { ...tenantFilter, contractRenewalAt: { lt: now }, status: { not: 'OFFBOARDED' } },
        select: { id: true, tenantId: true, name: true, ownerUserId: true, contractRenewalAt: true },
    });
    for (const v of overdueRenewals) {
        results.push({ id: v.id, tenantId: v.tenantId, name: v.name, ownerUserId: v.ownerUserId, type: 'RENEWAL_OVERDUE', dueDate: v.contractRenewalAt! });
    }

    // Renewals due in 30 days
    const dueRenewals = await prisma.vendor.findMany({
        where: { ...tenantFilter, contractRenewalAt: { gte: now, lte: in30 }, status: { not: 'OFFBOARDED' } },
        select: { id: true, tenantId: true, name: true, ownerUserId: true, contractRenewalAt: true },
    });
    for (const v of dueRenewals) {
        results.push({ id: v.id, tenantId: v.tenantId, name: v.name, ownerUserId: v.ownerUserId, type: 'RENEWAL_DUE', dueDate: v.contractRenewalAt! });
    }

    // Log events
    for (const item of results) {
        const action = item.type === 'REVIEW_OVERDUE' ? 'VENDOR_REVIEW_OVERDUE'
            : item.type === 'REVIEW_DUE' ? 'VENDOR_REVIEW_DUE'
                : item.type === 'RENEWAL_OVERDUE' ? 'VENDOR_RENEWAL_OVERDUE'
                    : 'VENDOR_RENEWAL_DUE';

        logger.info('vendor due event', { component: 'job', action, vendorName: item.name, dueDate: item.dueDate?.toISOString() });
    }

    logger.info('vendor renewal scan completed', {
        component: 'vendor-renewals',
        scope,
        ...(tenantId ? { tenantId } : {}),
        total: results.length,
    });

    return results;
}

/**
 * Pure helper: classify a date as overdue / due-soon / ok.
 */
export function classifyDueDate(date: Date | string | null, daysThreshold = 30): 'overdue' | 'due-soon' | 'ok' | 'none' {
    if (!date) return 'none';
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    if (d < now) return 'overdue';
    const diff = (d.getTime() - now.getTime()) / 86400000;
    if (diff <= daysThreshold) return 'due-soon';
    return 'ok';
}
