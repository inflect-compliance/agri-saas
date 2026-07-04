/**
 * Unit — ExchangeRepository.listActiveListings expiry filter.
 *
 * The browse feed must hide an ACTIVE listing once it is past its expiry (until
 * the sweep flips it to EXPIRED). The repo builds
 *   status = ACTIVE  AND  (expiresAt IS NULL OR expiresAt > now)
 * This test captures that `where` and evaluates it against sample rows the way
 * Postgres would, so a regression that drops the expiry clause is caught
 * WITHOUT needing a live DB (the local test DB can't run these migrations).
 */
import { Prisma, ExchangeListingStatus } from '@prisma/client';
import { ExchangeRepository } from '@/app-layer/repositories/exchange';

interface Row { status: string; expiresAt: Date | null }

/** Evaluate the captured `where` against a row (mirrors Prisma null/gt semantics). */
function matches(where: Prisma.ExchangeListingWhereInput, row: Row): boolean {
    if (where.status && row.status !== where.status) return false;
    if (where.OR) {
        const or = where.OR as Array<{ expiresAt?: null | { gt?: Date } }>;
        const ok = or.some((cond) => {
            if (!('expiresAt' in cond)) return false;
            if (cond.expiresAt === null) return row.expiresAt === null;
            if (cond.expiresAt?.gt) return row.expiresAt != null && row.expiresAt > cond.expiresAt.gt;
            return false;
        });
        if (!ok) return false;
    }
    return true;
}

function captureWhere(): Promise<Prisma.ExchangeListingWhereInput> {
    let captured: Prisma.ExchangeListingWhereInput = {};
    const db = {
        exchangeListing: {
            findMany: (args: { where: Prisma.ExchangeListingWhereInput }) => {
                captured = args.where;
                return Promise.resolve([]);
            },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return ExchangeRepository.listActiveListings(db).then(() => captured);
}

describe('listActiveListings — expiry filter', () => {
    const past = new Date('2020-01-01T00:00:00Z');
    const future = new Date('2999-01-01T00:00:00Z');

    it('restricts to ACTIVE + the null-or-future expiry clause', async () => {
        const where = await captureWhere();
        expect(where.status).toBe(ExchangeListingStatus.ACTIVE);
        expect(Array.isArray(where.OR)).toBe(true);
        expect(where.OR).toHaveLength(2);
    });

    it('EXCLUDES an ACTIVE row whose expiresAt is in the past', async () => {
        const where = await captureWhere();
        expect(matches(where, { status: 'ACTIVE', expiresAt: past })).toBe(false);
    });

    it('INCLUDES an ACTIVE row with a null or future expiry', async () => {
        const where = await captureWhere();
        expect(matches(where, { status: 'ACTIVE', expiresAt: null })).toBe(true);
        expect(matches(where, { status: 'ACTIVE', expiresAt: future })).toBe(true);
    });

    it('EXCLUDES a non-ACTIVE row even with a future expiry', async () => {
        const where = await captureWhere();
        expect(matches(where, { status: 'WITHDRAWN', expiresAt: future })).toBe(false);
        expect(matches(where, { status: 'EXPIRED', expiresAt: future })).toBe(false);
    });
});
