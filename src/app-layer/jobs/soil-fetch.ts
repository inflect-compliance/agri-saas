/**
 * soil-fetch — populate modelled soil for a batch of parcels (#37).
 *
 * Enqueued on parcel import / create / geometry edit. Runs on a DEDICATED
 * BullMQ queue whose Worker carries a `limiter: { max: 5, duration: 60000 }`
 * so we honour the SoilGrids beta REST fair-use budget (~5 req/min) at the
 * QUEUE level — the ~100 m `SoilSample` cache absorbs the rest, so most
 * parcels resolve without a provider call at all.
 *
 * Per parcel we call `fetchAndStoreParcelSoil`, which is idempotent and
 * skips parcels with no geometry. A provider outage throws → the job retries
 * with backoff and the parcel stays "soil pending"; parcel creation is never
 * blocked (the trigger only enqueues).
 *
 * @module jobs/soil-fetch
 */
import prisma from '@/lib/prisma';
import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole, parsePermissionsJson } from '@/lib/permissions';
import { computePermissions } from '@/lib/tenant-context';
import { fetchAndStoreParcelSoil } from '@/app-layer/usecases/soil';
import { logger } from '@/lib/observability/logger';
import type { SoilFetchPayload } from './types';

export interface SoilFetchResult {
    /** Parcels considered. */
    scanned: number;
    /** Parcels whose soil was populated (fetched or reused from cache). */
    populated: number;
    /** Parcels skipped (no geometry / no centroid). */
    skipped: number;
}

/** Build the job's RequestContext from the initiator's ACTIVE membership. */
async function buildJobContext(payload: SoilFetchPayload): Promise<RequestContext> {
    const membership = await prisma.tenantMembership.findFirst({
        where: { userId: payload.initiatedByUserId, tenantId: payload.tenantId, status: 'ACTIVE' },
        include: { customRole: true },
    });
    if (!membership) {
        throw new Error(
            `soil-fetch: user ${payload.initiatedByUserId} is not an active member of tenant ${payload.tenantId}`,
        );
    }
    const effectiveRole = membership.customRole?.baseRole ?? membership.role;
    const appPermissions = membership.customRole
        ? parsePermissionsJson(membership.customRole.permissionsJson, membership.customRole.baseRole)
        : getPermissionsForRole(membership.role);
    return {
        requestId: payload.requestId ?? `soil-fetch-${payload.tenantId}`,
        userId: payload.initiatedByUserId,
        tenantId: payload.tenantId,
        role: effectiveRole,
        permissions: computePermissions(effectiveRole),
        appPermissions,
    };
}

/** Populate soil for every parcel in the payload. */
export async function runSoilFetch(payload: SoilFetchPayload): Promise<SoilFetchResult> {
    const ctx = await buildJobContext(payload);
    const parcelIds = payload.parcelIds ?? [];

    let populated = 0;
    let skipped = 0;
    for (const parcelId of parcelIds) {
        // Sequential on purpose: the provider is rate-limited, and one
        // parcel's provider error should retry that job without racing the
        // others. The queue limiter caps throughput regardless.
        const outcome = await fetchAndStoreParcelSoil(ctx, parcelId);
        if (outcome.status === 'skipped') skipped += 1;
        else populated += 1;
    }

    logger.info('soil-fetch batch complete', {
        component: 'soil',
        tenantId: payload.tenantId,
        scanned: parcelIds.length,
        populated,
        skipped,
    });

    return { scanned: parcelIds.length, populated, skipped };
}
