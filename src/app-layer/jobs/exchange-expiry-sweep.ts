/**
 * Exchange listing EXPIRED sweep.
 *
 * `ExchangeListingStatus.EXPIRED` and the `[status, expiresAt]` index were
 * built for this, but nothing ever set it — an ACTIVE listing past its
 * `expiresAt` is hidden from browse (the read filter excludes it) yet lingers
 * ACTIVE forever in the seller's my-listings. This daily sweep flips those
 * rows to EXPIRED so the seller's status is truthful and the terminal state is
 * reconstructible from the audit log.
 *
 * Modelled on `exception-expiry-monitor.ts` (Phase-1 pattern): find ACTIVE
 * rows whose expiry has elapsed, flip each atomically (prior-state predicate
 * so a concurrent withdraw/fulfil is never clobbered), and emit one
 * `status_change` audit row per transition, scoped to the seller tenant.
 * Bounded batch per run.
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/observability/logger';
import { appendAuditEntry } from '@/lib/audit';

/** Rows flipped per run — bounded so one sweep can't hold a long transaction. */
const DEFAULT_BATCH = 500;

export interface ExchangeExpirySweepOptions {
    /** Override the "now" anchor — test-only seam. */
    now?: Date;
    /** Cap on rows flipped this run. */
    batchSize?: number;
}

export interface ExchangeExpirySweepResult {
    /** ACTIVE-past-expiry rows scanned. */
    scanned: number;
    /** Rows actually transitioned ACTIVE → EXPIRED this run. */
    transitionedToExpired: number;
}

export async function runExchangeExpirySweep(
    db: PrismaClient,
    options: ExchangeExpirySweepOptions = {},
): Promise<ExchangeExpirySweepResult> {
    const now = options.now ?? new Date();
    const batchSize = options.batchSize ?? DEFAULT_BATCH;

    // ACTIVE listings whose expiry has elapsed. The `[status, expiresAt]`
    // index backs this exact shape. Bounded + ordered oldest-first so a large
    // backlog drains deterministically over consecutive runs.
    const candidates = await db.exchangeListing.findMany({
        where: { status: 'ACTIVE', expiresAt: { not: null, lte: now } },
        select: { id: true, sellerTenantId: true, commodity: true, side: true, expiresAt: true },
        orderBy: { expiresAt: 'asc' },
        take: batchSize,
    });

    let transitioned = 0;
    for (const row of candidates) {
        // Atomic flip keyed on the prior-state predicate — a concurrent
        // withdraw/fulfil (or a renew that pushes expiresAt out) makes the
        // predicate miss and the row is left alone.
        const update = await db.exchangeListing.updateMany({
            where: { id: row.id, status: 'ACTIVE', expiresAt: { not: null, lte: now } },
            data: { status: 'EXPIRED' },
        });
        if (update.count === 0) continue;

        // One durable audit row per transition, scoped to the seller tenant so
        // the lifecycle is reconstructible from the log without reading the row.
        await appendAuditEntry({
            tenantId: row.sellerTenantId,
            userId: null,
            actorType: 'SYSTEM',
            entity: 'ExchangeListing',
            entityId: row.id,
            action: 'UPDATE',
            detailsJson: {
                category: 'status_change',
                entityName: 'ExchangeListing',
                fromStatus: 'ACTIVE',
                toStatus: 'EXPIRED',
                summary: `${row.side} listing "${row.commodity}" expired at its deadline`,
                after: {
                    side: row.side,
                    commodity: row.commodity,
                    expiresAtIso: row.expiresAt?.toISOString() ?? null,
                    transitionedBy: 'exchange-expiry-sweep',
                },
            },
        });
        transitioned++;
    }

    logger.info('exchange-expiry sweep complete', {
        component: 'exchange-expiry-sweep',
        scanned: candidates.length,
        transitionedToExpired: transitioned,
    });

    return { scanned: candidates.length, transitionedToExpired: transitioned };
}
