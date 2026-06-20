/**
 * Unit tests — product-safety accessor (feat/ai-evals-safety).
 *
 * The tenant-context DB is mocked so we assert the parse + fail-closed
 * behaviour, not Prisma.
 */
import { makeRequestContext } from '../helpers/make-context';

const db = {
    item: { findFirst: jest.fn() },
};

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, cb: (d: unknown) => unknown) => cb(db),
}));

import { getPesticideSafety } from '@/app-layer/repositories/product-safety';

const ctx = makeRequestContext('ADMIN');

const VALID_SAFETY = {
    activeIngredient: 'glyphosate',
    applicationRate: { value: 2.5, unit: 'L', per: 'ha' },
    reEntryIntervalHours: 12,
    preHarvestIntervalDays: 7,
    registrationNumber: 'EPA-12345',
};

beforeEach(() => {
    db.item.findFirst.mockReset();
});

describe('getPesticideSafety', () => {
    it('parses a valid attributesJson.safety block on a PESTICIDE item', async () => {
        db.item.findFirst.mockResolvedValue({
            category: 'PESTICIDE',
            attributesJson: { safety: VALID_SAFETY, other: 'ignored' },
        });
        const spec = await getPesticideSafety(ctx, 'item-1');
        expect(spec).not.toBeNull();
        expect(spec?.activeIngredient).toBe('glyphosate');
        expect(spec?.applicationRate.value).toBe(2.5);
        expect(spec?.reEntryIntervalHours).toBe(12);
        expect(spec?.preHarvestIntervalDays).toBe(7);
        expect(spec?.registrationNumber).toBe('EPA-12345');
    });

    it('returns null for a non-PESTICIDE item', async () => {
        db.item.findFirst.mockResolvedValue({
            category: 'FERTILIZER',
            attributesJson: { safety: VALID_SAFETY },
        });
        expect(await getPesticideSafety(ctx, 'item-1')).toBeNull();
    });

    it('returns null when the item is not found', async () => {
        db.item.findFirst.mockResolvedValue(null);
        expect(await getPesticideSafety(ctx, 'missing')).toBeNull();
    });

    it('returns null when there is no safety block', async () => {
        db.item.findFirst.mockResolvedValue({ category: 'PESTICIDE', attributesJson: { other: 1 } });
        expect(await getPesticideSafety(ctx, 'item-1')).toBeNull();
    });

    it('returns null when attributesJson is null (legacy item)', async () => {
        db.item.findFirst.mockResolvedValue({ category: 'PESTICIDE', attributesJson: null });
        expect(await getPesticideSafety(ctx, 'item-1')).toBeNull();
    });

    it('returns null for a malformed safety block (missing required field)', async () => {
        db.item.findFirst.mockResolvedValue({
            category: 'PESTICIDE',
            attributesJson: {
                safety: { activeIngredient: 'glyphosate' }, // missing rate/REI/PHI
            },
        });
        expect(await getPesticideSafety(ctx, 'item-1')).toBeNull();
    });

    it('returns null for an empty itemId without querying', async () => {
        expect(await getPesticideSafety(ctx, '')).toBeNull();
        expect(db.item.findFirst).not.toHaveBeenCalled();
    });

    it('restates the tenantId filter on the query (defence-in-depth)', async () => {
        db.item.findFirst.mockResolvedValue(null);
        await getPesticideSafety(ctx, 'item-1');
        const where = db.item.findFirst.mock.calls[0][0].where;
        expect(where.tenantId).toBe(ctx.tenantId);
        expect(where.id).toBe('item-1');
    });
});
