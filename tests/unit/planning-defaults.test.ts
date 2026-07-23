/* eslint-disable @typescript-eslint/no-explicit-any -- standard test-mock pattern. */

/**
 * Unit tests for `seedDefaultSeason` — the fresh-tenant planning bootstrap
 * that closes the crop-plan cold-start (a plan requires a season; seasons
 * were never seeded).
 *
 * Idempotent on the `default-season` natural key: creates one sensible
 * default season if the tenant has none, otherwise returns the existing id
 * and writes nothing.
 */
import { seedDefaultSeason, DEFAULT_SEASON_KEY } from '@/app-layer/usecases/planning-defaults';

function mockDb() {
    return {
        season: {
            findFirst: jest.fn(),
            create: jest.fn(),
        },
    } as any;
}

describe('seedDefaultSeason', () => {
    it('creates the current-year main season when the tenant has none', async () => {
        const db = mockDb();
        db.season.findFirst.mockResolvedValue(null);
        db.season.create.mockResolvedValue({ id: 'season-new' });

        const id = await seedDefaultSeason(db, 'tenant-1');

        expect(id).toBe('season-new');
        expect(db.season.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { tenantId: 'tenant-1', key: DEFAULT_SEASON_KEY } }),
        );
        const data = db.season.create.mock.calls[0][0].data;
        expect(data.tenantId).toBe('tenant-1');
        expect(data.key).toBe(DEFAULT_SEASON_KEY);
        expect(data.status).toBe('ACTIVE');
        // Name carries the season's calendar year; window is a real range.
        expect(data.name).toMatch(/Main Season$/);
        expect(data.startDate).toBeInstanceOf(Date);
        expect(data.endDate).toBeInstanceOf(Date);
        expect(data.endDate.getTime()).toBeGreaterThan(data.startDate.getTime());
        expect(data.startDate.getUTCFullYear()).toBe(data.year);
    });

    it('is idempotent — returns the existing season and writes nothing', async () => {
        const db = mockDb();
        db.season.findFirst.mockResolvedValue({ id: 'season-existing' });

        const id = await seedDefaultSeason(db, 'tenant-1');

        expect(id).toBe('season-existing');
        expect(db.season.create).not.toHaveBeenCalled();
    });
});
