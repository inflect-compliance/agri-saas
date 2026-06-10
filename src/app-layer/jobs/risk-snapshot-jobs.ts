/**
 * RQ-9 — daily risk-snapshot cron (cross-tenant fan-out).
 *
 * For every tenant with ≥1 active risk: capture per-risk + portfolio
 * snapshots (idempotent per UTC day), then prune beyond the retention
 * window.
 *
 * @module jobs/risk-snapshot-jobs
 */
import prisma from '@/lib/prisma';
import { takeSnapshot, cleanupSnapshots } from '@/app-layer/usecases/risk-snapshot';
import { logger } from '@/lib/observability/logger';
import type { RiskSnapshotPayload } from './types';

const RETENTION_DAYS = 730;

export async function runRiskSnapshot(_payload: RiskSnapshotPayload) {
    const tenants = await prisma.risk.findMany({
        where: { deletedAt: null },
        select: { tenantId: true },
        distinct: ['tenantId'],
        take: 5000,
    });
    let scanned = 0, riskSnapshots = 0, pruned = 0;
    for (const { tenantId } of tenants) {
        try {
            const r = await takeSnapshot(prisma, tenantId);
            riskSnapshots += r.riskSnapshots;
            pruned += await cleanupSnapshots(prisma, tenantId, RETENTION_DAYS);
            scanned++;
        } catch (err) {
            logger.warn('risk-snapshot: tenant snapshot failed', {
                component: 'risk-snapshot', tenantId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { tenants: tenants.length, scanned, riskSnapshots, pruned };
}
