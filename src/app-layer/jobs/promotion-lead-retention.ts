/**
 * Promotion-lead retention sweep.
 *
 * A `PromotionLead` is contact PII: a farmer's name (via `inquirerUserId`) and
 * the free text they wrote, captured expressly to be forwarded to a third-party
 * supplier. #352 gave the table `deletedAt` as the mechanism but scheduled
 * nothing, which meant the privacy notice could not state a deletion period —
 * promising one the system did not keep would have been the exact class of
 * defect that work removed. This is the sweep that makes the promise true.
 *
 * ## Two stages, one job
 *
 *   1. **Expire** — a lead older than {@link PROMOTION_LEAD_RETENTION_DAYS} is
 *      soft-deleted (`deletedAt` set). Soft, not hard, because
 *      `@@unique([promotionId, inquirerTenantId])` is what stops a tenant
 *      spamming one promotion; hard-deleting would silently re-open that.
 *   2. **Purge** — a lead soft-deleted more than
 *      {@link PROMOTION_LEAD_PURGE_GRACE_DAYS} ago is removed for good. The
 *      grace matches `DEFAULT_SOFT_DELETE_GRACE_DAYS` so the platform has one
 *      answer to "how long after deletion is it really gone".
 *
 * Deliberately its own job rather than an entry in `SOFT_DELETE_MODELS`:
 * joining that allowlist changes delete semantics for the model app-wide and
 * is governed by an exact-count guard, which is a large blast radius for one
 * PII class whose window is a policy decision. Keeping it here means the window
 * and the copy that states it live next to each other.
 *
 * ## Keys and RLS
 *
 * Runs on the base client, i.e. as a non-`app_user` role, so it passes the
 * `superuser_bypass` policy — necessary, because leads span every tenant and no
 * single tenant context could see them all. It never reads `requestMessage`, so
 * it never needs a tenant DEK: expiry and purge are decided from `createdAt` /
 * `deletedAt` alone. That is why a global sweep is possible at all for a column
 * encrypted per-tenant.
 *
 * @module app-layer/jobs/promotion-lead-retention
 */
import { prisma as defaultPrisma } from '@/lib/prisma';
import { runJob } from '@/lib/observability/job-runner';
import { logger } from '@/lib/observability/logger';

/**
 * How long a lead is kept before it is soft-deleted.
 *
 * 730 days (24 months). A supplier enquiry has a commercial life measured in
 * seasons — a farmer who asked about fertiliser last spring may reasonably be
 * contacted about this one — but beyond two seasons the record is no longer
 * serving the purpose it was collected for.
 *
 * **This constant is the single source of truth.** The public privacy notice
 * renders the window from it, so the page and the behaviour cannot drift apart.
 * Changing it changes what users are told.
 */
export const PROMOTION_LEAD_RETENTION_DAYS = 730;

/** Grace between soft delete and permanent removal. Matches the platform default. */
export const PROMOTION_LEAD_PURGE_GRACE_DAYS = 90;

const DAY_MS = 86_400_000;

export interface PromotionLeadRetentionOptions {
    now?: Date;
    dryRun?: boolean;
    /** Injectable client for tests. */
    db?: typeof defaultPrisma;
    retentionDays?: number;
    graceDays?: number;
}

export interface PromotionLeadRetentionResult {
    /** Leads past the window that were (or would be) soft-deleted. */
    expired: number;
    /** Leads past the grace that were (or would be) removed for good. */
    purged: number;
    dryRun: boolean;
}

export async function runPromotionLeadRetentionSweep(
    options: PromotionLeadRetentionOptions = {},
): Promise<PromotionLeadRetentionResult> {
    return runJob('promotion-lead-retention', async () => {
        const db = options.db ?? defaultPrisma;
        const now = options.now ?? new Date();
        const dryRun = options.dryRun ?? false;
        const retentionDays = options.retentionDays ?? PROMOTION_LEAD_RETENTION_DAYS;
        const graceDays = options.graceDays ?? PROMOTION_LEAD_PURGE_GRACE_DAYS;

        const expireBefore = new Date(now.getTime() - retentionDays * DAY_MS);
        const purgeBefore = new Date(now.getTime() - graceDays * DAY_MS);

        // Stage 1 — expire. Only rows still live; re-running is a no-op.
        const expiryWhere = { deletedAt: null, createdAt: { lt: expireBefore } };
        // Stage 2 — purge. `lt` on a non-null deletedAt.
        const purgeWhere = { deletedAt: { not: null, lt: purgeBefore } };

        if (dryRun) {
            const [expired, purged] = await Promise.all([
                db.promotionLead.count({ where: expiryWhere }),
                db.promotionLead.count({ where: purgeWhere }),
            ]);
            logger.info('promotion-lead retention dry run', {
                component: 'job',
                expired,
                purged,
                retentionDays,
                graceDays,
            });
            return { expired, purged, dryRun: true };
        }

        // Purge BEFORE expiring: otherwise rows soft-deleted a moment ago by
        // stage 1 would be re-examined by stage 2 in the same pass, and a
        // mis-set grace of 0 would hard-delete them immediately instead of
        // giving the window the grace period exists to provide.
        const purgedResult = await db.promotionLead.deleteMany({ where: purgeWhere });
        const expiredResult = await db.promotionLead.updateMany({
            where: expiryWhere,
            data: { deletedAt: now },
        });

        logger.info('promotion-lead retention sweep complete', {
            component: 'job',
            expired: expiredResult.count,
            purged: purgedResult.count,
            retentionDays,
            graceDays,
        });

        return {
            expired: expiredResult.count,
            purged: purgedResult.count,
            dryRun: false,
        };
    });
}
