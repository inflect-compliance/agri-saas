/**
 * AI field briefing (dashboard read-model) — asserts the fail-safe /
 * degrading contract, not the AI or Earth Engine calls (both mocked).
 *
 * The usecase is fail-safe by construction: no Claude key short-circuits to
 * a hidden card; no GEE creds means the AI still briefs from crop/season
 * context; a cached payload is returned verbatim. These are the branches
 * that must never regress, so they are what we pin here.
 */
import type { RequestContext } from '@/app-layer/types';

jest.mock('@/app-layer/policies/common', () => ({
    assertCanRead: jest.fn(),
}));

const ai = {
    isFieldBriefingConfigured: jest.fn(),
    generateFieldBriefing: jest.fn(),
};
jest.mock('@/app-layer/ai/field-briefing', () => ({
    isFieldBriefingConfigured: (...a: unknown[]) => ai.isFieldBriefingConfigured(...a),
    generateFieldBriefing: (...a: unknown[]) => ai.generateFieldBriefing(...a),
}));

const gee = {
    isGeeConfigured: jest.fn(),
    getIndexMeansForBounds: jest.fn(),
};
jest.mock('@/lib/agro/earth-engine', () => ({
    isGeeConfigured: (...a: unknown[]) => gee.isGeeConfigured(...a),
    getIndexMeansForBounds: (...a: unknown[]) => gee.getIndexMeansForBounds(...a),
}));

let redisClient: { get: jest.Mock; set: jest.Mock } | null = null;
jest.mock('@/lib/redis', () => ({
    getRedis: () => redisClient,
}));

const uc = {
    listLocations: jest.fn(),
    listLocationParcels: jest.fn(),
    listMyFarmTasks: jest.fn(),
    listLogEntries: jest.fn(),
    getSeasonRecap: jest.fn(),
};
jest.mock('@/app-layer/usecases/location', () => ({
    listLocations: (...a: unknown[]) => uc.listLocations(...a),
    listLocationParcels: (...a: unknown[]) => uc.listLocationParcels(...a),
}));
jest.mock('@/app-layer/usecases/farm-task', () => ({
    listMyFarmTasks: (...a: unknown[]) => uc.listMyFarmTasks(...a),
}));
jest.mock('@/app-layer/usecases/journal', () => ({
    listLogEntries: (...a: unknown[]) => uc.listLogEntries(...a),
}));
jest.mock('@/app-layer/usecases/season-recap', () => ({
    getSeasonRecap: (...a: unknown[]) => uc.getSeasonRecap(...a),
}));

import { getFieldBriefing } from '@/app-layer/usecases/satellite-briefing';

const ctx = { tenantId: 't1', userId: 'u', requestId: 'r', permissions: { canRead: true } } as unknown as RequestContext;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

beforeEach(() => {
    jest.clearAllMocks();
    redisClient = null;
    gee.isGeeConfigured.mockReturnValue(false);
    ai.isFieldBriefingConfigured.mockReturnValue(true);
    ai.generateFieldBriefing.mockResolvedValue({ headline: 'ok', items: [] });
    uc.listLocations.mockResolvedValue([]);
    uc.listLocationParcels.mockResolvedValue({ bounds: null, parcels: [] });
    uc.listMyFarmTasks.mockResolvedValue([]);
    uc.listLogEntries.mockResolvedValue([]);
    uc.getSeasonRecap.mockResolvedValue(null);
});

describe('getFieldBriefing', () => {
    it('no Claude key → card hides (briefing null, no AI call)', async () => {
        ai.isFieldBriefingConfigured.mockReturnValue(false);
        gee.isGeeConfigured.mockReturnValue(true);

        const r = await getFieldBriefing(ctx);

        expect(r.aiConfigured).toBe(false);
        expect(r.satelliteConfigured).toBe(true);
        expect(r.satelliteAvailable).toBe(false);
        expect(r.briefing).toBeNull();
        expect(r.fieldCount).toBe(0);
        expect(r.date).toMatch(ISO_DATE);
        expect(ai.generateFieldBriefing).not.toHaveBeenCalled();
    });

    it('AI configured, no fields, no satellite → still briefs from context', async () => {
        const r = await getFieldBriefing(ctx);

        expect(r.aiConfigured).toBe(true);
        expect(r.satelliteConfigured).toBe(false);
        expect(r.satelliteAvailable).toBe(false);
        expect(r.fieldCount).toBe(0);
        expect(r.briefing).toEqual({ headline: 'ok', items: [] });
        expect(gee.getIndexMeansForBounds).not.toHaveBeenCalled();
        // The AI is briefed even with zero satellite reads.
        expect(ai.generateFieldBriefing).toHaveBeenCalledWith(
            expect.objectContaining({ satelliteAvailable: false, fields: [], openTaskCount: 0, recentJournalCount: 0 }),
        );
    });

    it('returns a cached payload verbatim without regenerating', async () => {
        const cached = {
            aiConfigured: true,
            satelliteConfigured: false,
            satelliteAvailable: true,
            generatedAt: '2026-07-04T00:00:00.000Z',
            date: '2026-07-04',
            fieldCount: 3,
            briefing: { headline: 'cached', items: [] },
        };
        redisClient = { get: jest.fn().mockResolvedValue(JSON.stringify(cached)), set: jest.fn() };

        const r = await getFieldBriefing(ctx);

        expect(r).toEqual(cached);
        expect(ai.generateFieldBriefing).not.toHaveBeenCalled();
        expect(uc.listLocations).not.toHaveBeenCalled();
    });
});
