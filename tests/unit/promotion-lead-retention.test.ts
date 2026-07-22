/**
 * Promotion-lead retention sweep.
 *
 * The privacy notice now states a deletion period, so this is the test that
 * keeps that statement true. Before this job existed the table had `deletedAt`
 * and nothing scheduled, which is why the notice could not name a window at
 * all — promising one the system did not keep would have been the exact defect
 * the promotions work removed.
 *
 * The DB is injected, so these assert the sweep's decisions (which rows, in
 * which order, and that a re-run is a no-op) without needing Postgres.
 */
import {
    runPromotionLeadRetentionSweep,
    PROMOTION_LEAD_RETENTION_DAYS,
    PROMOTION_LEAD_PURGE_GRACE_DAYS,
} from '@/app-layer/jobs/promotion-lead-retention';

type Call = { op: string; args: unknown };

function fakeDb(counts = { deleted: 3, updated: 5 }) {
    const calls: Call[] = [];
    return {
        calls,
        db: {
            promotionLead: {
                deleteMany: (args: unknown) => {
                    calls.push({ op: 'deleteMany', args });
                    return Promise.resolve({ count: counts.deleted });
                },
                updateMany: (args: unknown) => {
                    calls.push({ op: 'updateMany', args });
                    return Promise.resolve({ count: counts.updated });
                },
                count: (args: unknown) => {
                    calls.push({ op: 'count', args });
                    return Promise.resolve(7);
                },
            },
        } as never,
    };
}

describe('promotion-lead retention sweep', () => {
    const now = new Date('2026-07-21T03:30:00Z');

    it('expires leads older than the window and purges those past the grace', async () => {
        const { db, calls } = fakeDb();
        const result = await runPromotionLeadRetentionSweep({ now, db });

        expect(result).toEqual({ expired: 5, purged: 3, dryRun: false });

        const purge = calls.find((c) => c.op === 'deleteMany')!.args as {
            where: { deletedAt: { lt: Date } };
        };
        const expire = calls.find((c) => c.op === 'updateMany')!.args as {
            where: { deletedAt: null; createdAt: { lt: Date } };
            data: { deletedAt: Date };
        };

        // Expiry is measured from creation, purge from the soft delete.
        const expectedExpiry = new Date(
            now.getTime() - PROMOTION_LEAD_RETENTION_DAYS * 86_400_000,
        );
        const expectedPurge = new Date(
            now.getTime() - PROMOTION_LEAD_PURGE_GRACE_DAYS * 86_400_000,
        );
        expect(expire.where.createdAt.lt).toEqual(expectedExpiry);
        expect(purge.where.deletedAt.lt).toEqual(expectedPurge);
        expect(expire.data.deletedAt).toEqual(now);
    });

    it('only touches live rows when expiring — a re-run is a no-op', async () => {
        const { db, calls } = fakeDb();
        await runPromotionLeadRetentionSweep({ now, db });
        const expire = calls.find((c) => c.op === 'updateMany')!.args as {
            where: { deletedAt: null };
        };
        // Without this, every pass would re-stamp deletedAt and the grace
        // period would never elapse — the rows would never actually be purged.
        expect(expire.where.deletedAt).toBeNull();
    });

    it('purges BEFORE expiring, so a row cannot be created and destroyed in one pass', async () => {
        const { db, calls } = fakeDb();
        await runPromotionLeadRetentionSweep({ now, db });
        const ops = calls.filter((c) => c.op !== 'count').map((c) => c.op);
        expect(ops).toEqual(['deleteMany', 'updateMany']);
    });

    it('dry run counts without writing', async () => {
        const { db, calls } = fakeDb();
        const result = await runPromotionLeadRetentionSweep({ now, db, dryRun: true });
        expect(result.dryRun).toBe(true);
        expect(calls.every((c) => c.op === 'count')).toBe(true);
    });

    it('soft-deletes rather than hard-deletes at the expiry stage', async () => {
        // `@@unique([promotionId, inquirerTenantId])` is what stops a tenant
        // spamming one promotion. Hard-deleting on expiry would silently
        // re-open that, so expiry must be an UPDATE.
        const { db, calls } = fakeDb();
        await runPromotionLeadRetentionSweep({ now, db });
        const expire = calls.find((c) => c.op === 'updateMany');
        expect(expire).toBeDefined();
    });

    it('is registered as a scheduled job with an executor', () => {
        // A sweep nobody runs is the state this replaced.
        const fs = require('node:fs') as typeof import('node:fs');
        const path = require('node:path') as typeof import('node:path');
        const root = path.resolve(__dirname, '../..');
        const schedules = fs.readFileSync(
            path.join(root, 'src/app-layer/jobs/schedules.ts'),
            'utf8',
        );
        const registry = fs.readFileSync(
            path.join(root, 'src/app-layer/jobs/executor-registry.ts'),
            'utf8',
        );
        expect(schedules).toMatch(/name: 'promotion-lead-retention'/);
        expect(registry).toMatch(/register\('promotion-lead-retention'/);
    });

    it('the privacy notice renders the window from the SAME constants', () => {
        // Prose restating "24 months" would drift the first time the constant
        // moved. The page must import it.
        const fs = require('node:fs') as typeof import('node:fs');
        const path = require('node:path') as typeof import('node:path');
        const page = fs.readFileSync(
            path.resolve(__dirname, '../../src/app/privacy/page.tsx'),
            'utf8',
        );
        expect(page).toMatch(/PROMOTION_LEAD_RETENTION_DAYS/);
        expect(page).toMatch(/PROMOTION_LEAD_PURGE_GRACE_DAYS/);
    });
});
