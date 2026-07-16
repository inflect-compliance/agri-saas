/**
 * Unit tests for the user-interests usecase — normalization + the tenant-scoped
 * read / PUT-replace. `runInTenantContext` is mocked to invoke its callback with
 * a fake db, so no DB is touched; the RLS + (tenantId, userId) filtering is
 * asserted on the query shape.
 */
const mockDb = {
    userInterest: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
    },
};
jest.mock('@/lib/db-context', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
    runInTenantContext: (_ctx: unknown, cb: (db: any) => unknown) => cb(mockDb),
}));

import {
    normalizeInterests,
    getUserInterests,
    setUserInterests,
    MAX_INTERESTS,
} from '@/app-layer/usecases/user-interests';
import { buildRequestContext } from '../helpers/factories';

const ctx = buildRequestContext({ tenantId: 't1', userId: 'u1' }) as never;

beforeEach(() => {
    mockDb.userInterest.findMany.mockReset();
    mockDb.userInterest.deleteMany.mockReset().mockResolvedValue({ count: 0 });
    mockDb.userInterest.createMany.mockReset().mockResolvedValue({ count: 0 });
});

describe('normalizeInterests', () => {
    it('trims, lowercases, drops empties, and dedupes (input order)', () => {
        expect(normalizeInterests(['  Wheat ', 'SUBSIDY', 'wheat', '', '  ', 'Пшеница'])).toEqual([
            'wheat',
            'subsidy',
            'пшеница',
        ]);
    });

    it('caps the count at MAX_INTERESTS', () => {
        const many = Array.from({ length: MAX_INTERESTS + 5 }, (_, i) => `kw${i}`);
        expect(normalizeInterests(many)).toHaveLength(MAX_INTERESTS);
    });

    it('caps each keyword length at 50 chars', () => {
        const [only] = normalizeInterests(['x'.repeat(80)]);
        expect(only).toHaveLength(50);
    });

    it('ignores non-string entries', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hostile input
        expect(normalizeInterests(['ok', 5 as any, null as any, 'ok'])).toEqual(['ok']);
    });
});

describe('getUserInterests', () => {
    it('reads own rows scoped by (tenantId, userId), newest-agnostic sorted', async () => {
        mockDb.userInterest.findMany.mockResolvedValue([{ keyword: 'subsidy' }, { keyword: 'wheat' }]);
        const res = await getUserInterests(ctx);
        expect(res).toEqual(['subsidy', 'wheat']);
        const arg = mockDb.userInterest.findMany.mock.calls[0][0];
        expect(arg.where).toEqual({ tenantId: 't1', userId: 'u1' });
        expect(arg.orderBy).toEqual({ keyword: 'asc' });
    });
});

describe('setUserInterests', () => {
    it('PUT-replaces: deletes own rows then inserts the normalized set', async () => {
        const res = await setUserInterests(ctx, ['Wheat', ' subsidy ', 'wheat', '']);
        // Cleared first, scoped to own rows.
        expect(mockDb.userInterest.deleteMany).toHaveBeenCalledWith({
            where: { tenantId: 't1', userId: 'u1' },
        });
        // Inserted the normalized+deduped set, each stamped with tenant + user.
        expect(mockDb.userInterest.createMany).toHaveBeenCalledWith({
            data: [
                { tenantId: 't1', userId: 'u1', keyword: 'wheat' },
                { tenantId: 't1', userId: 'u1', keyword: 'subsidy' },
            ],
            skipDuplicates: true,
        });
        // Returns the stored set, sorted.
        expect(res).toEqual(['subsidy', 'wheat']);
    });

    it('clears to empty without an insert when given nothing usable', async () => {
        const res = await setUserInterests(ctx, ['', '   ']);
        expect(mockDb.userInterest.deleteMany).toHaveBeenCalledTimes(1);
        expect(mockDb.userInterest.createMany).not.toHaveBeenCalled();
        expect(res).toEqual([]);
    });
});
