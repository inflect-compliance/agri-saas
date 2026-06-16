/**
 * Enterprise-grain — org portfolio grain aggregation usecase tests.
 *
 * Covers `getPortfolioGrainSummary`:
 *   - cross-tenant aggregation: per-tenant aggregates roll up into org
 *     totals (SALE/PURCHASE contracted tonnes, yield, activity cost,
 *     bin capacity/stored/utilisation), with a per-tenant breakdown.
 *   - resilience: a child tenant with no grain contributes zeros and is
 *     not counted in `tenantsWithGrain`.
 *   - the `canViewPortfolio` gate refuses callers without the flag.
 *
 * Mocks the two seams the usecase stands on:
 *   - `getPortfolioData` (the memoised child-tenant list), and
 *   - `withTenantDb` (the RLS-bound per-tenant transaction) — the mock
 *     hands each callback a fake `db` whose aggregate/groupBy results
 *     are keyed by tenant id, so the test exercises the aggregation +
 *     rollup math without a live DB.
 */

const getPortfolioDataMock = jest.fn();

jest.mock('@/app-layer/usecases/portfolio-data', () => ({
    __esModule: true,
    getPortfolioData: (...a: unknown[]) => getPortfolioDataMock(...a),
}));

// Per-tenant canned aggregate results — keyed by tenant id.
interface FakeTenantData {
    contractGroups: Array<{ type: string; _sum: { volumeTonnes: string | null } }>;
    yieldSum: string | null;
    logCost: string | null;
    stockCost: string | null;
    bins: Array<{ id: string; capacityTonnes: string | null }>;
    stored: Array<{ locationId: string; _sum: { quantityOnHand: string | null } }>;
    currency: string | null;
}

const TENANT_DATA: Record<string, FakeTenantData> = {};

function fakeDbFor(tenantId: string) {
    const d = TENANT_DATA[tenantId];
    return {
        contract: {
            groupBy: jest.fn(async () => d.contractGroups),
            findFirst: jest.fn(async () =>
                d.currency ? { priceCurrency: d.currency } : null,
            ),
        },
        yieldRecord: { aggregate: jest.fn(async () => ({ _sum: { grossTonnes: d.yieldSum } })) },
        logEntry: { aggregate: jest.fn(async () => ({ _sum: { costAmount: d.logCost } })) },
        stockTransaction: { aggregate: jest.fn(async () => ({ _sum: { costAmount: d.stockCost } })) },
        location: { findMany: jest.fn(async () => d.bins) },
        inventoryLot: { groupBy: jest.fn(async () => d.stored) },
    };
}

jest.mock('@/lib/db-context', () => ({
    __esModule: true,
    withTenantDb: (tenantId: string, cb: (db: unknown) => unknown) => cb(fakeDbFor(tenantId)),
}));

import { getPortfolioGrainSummary } from '@/app-layer/usecases/portfolio-grain';
import type { OrgContext } from '@/app-layer/types';

function ctxFor(overrides: Partial<OrgContext> = {}): OrgContext {
    return {
        requestId: 'req-test',
        userId: 'user-1',
        organizationId: 'org-1',
        orgSlug: 'acme-org',
        orgRole: 'ORG_ADMIN',
        permissions: {
            canViewPortfolio: true,
            canDrillDown: true,
            canExportReports: true,
            canManageTenants: true,
            canManageMembers: true,
            canConfigureDashboard: true,
        },
        ...overrides,
    };
}

beforeEach(() => {
    getPortfolioDataMock.mockReset();
    for (const k of Object.keys(TENANT_DATA)) delete TENANT_DATA[k];
});

describe('getPortfolioGrainSummary', () => {
    it('aggregates grain across child tenants into org totals + per-tenant rows', async () => {
        getPortfolioDataMock.mockResolvedValue({
            tenants: [
                { id: 'farm-a', name: 'Alpha Farm', slug: 'alpha' },
                { id: 'farm-b', name: 'Bravo Farm', slug: 'bravo' },
            ],
        });
        TENANT_DATA['farm-a'] = {
            contractGroups: [
                { type: 'SALE', _sum: { volumeTonnes: '500' } },
                { type: 'PURCHASE', _sum: { volumeTonnes: '120' } },
            ],
            yieldSum: '420.5',
            logCost: '1000',
            stockCost: '250',
            bins: [{ id: 'bin-1', capacityTonnes: '1000' }],
            stored: [{ locationId: 'bin-1', _sum: { quantityOnHand: '600' } }],
            currency: 'EUR',
        };
        TENANT_DATA['farm-b'] = {
            contractGroups: [{ type: 'SALE', _sum: { volumeTonnes: '300' } }],
            yieldSum: '180',
            logCost: '400',
            stockCost: null,
            bins: [{ id: 'bin-2', capacityTonnes: '500' }],
            stored: [{ locationId: 'bin-2', _sum: { quantityOnHand: '200' } }],
            currency: null,
        };

        const res = await getPortfolioGrainSummary(ctxFor());

        // Org totals.
        expect(res.totals.contractedSaleTonnes).toBe(800); // 500 + 300
        expect(res.totals.contractedPurchaseTonnes).toBe(120);
        expect(res.totals.totalYieldTonnes).toBe(600.5); // 420.5 + 180
        expect(res.totals.totalActivityCost).toBe(1650); // 1000+250 + 400
        expect(res.totals.binCount).toBe(2);
        expect(res.totals.binCapacityTonnes).toBe(1500);
        expect(res.totals.binStoredTonnes).toBe(800); // 600 + 200
        // 800 / 1500 × 100 = 53.3
        expect(res.totals.binUtilisationPct).toBeCloseTo(53.3, 1);
        expect(res.totals.currency).toBe('EUR'); // first non-null
        expect(res.totals.tenantsWithGrain).toBe(2);
        expect(res.totals.tenantsTotal).toBe(2);

        // Per-tenant breakdown, name-sorted.
        expect(res.perTenant.map((r) => r.tenantName)).toEqual(['Alpha Farm', 'Bravo Farm']);
        const alpha = res.perTenant.find((r) => r.tenantId === 'farm-a')!;
        expect(alpha.contractedSaleTonnes).toBe(500);
        expect(alpha.totalActivityCost).toBe(1250);
        expect(alpha.binStoredTonnes).toBe(600);
    });

    it('a tenant with no grain contributes zeros and is excluded from tenantsWithGrain', async () => {
        getPortfolioDataMock.mockResolvedValue({
            tenants: [
                { id: 'farm-a', name: 'Alpha Farm', slug: 'alpha' },
                { id: 'empty', name: 'Empty Farm', slug: 'empty' },
            ],
        });
        TENANT_DATA['farm-a'] = {
            contractGroups: [{ type: 'SALE', _sum: { volumeTonnes: '100' } }],
            yieldSum: '50',
            logCost: '10',
            stockCost: null,
            bins: [],
            stored: [],
            currency: 'GBP',
        };
        TENANT_DATA['empty'] = {
            contractGroups: [],
            yieldSum: null,
            logCost: null,
            stockCost: null,
            bins: [],
            stored: [],
            currency: null,
        };

        const res = await getPortfolioGrainSummary(ctxFor());

        expect(res.totals.tenantsTotal).toBe(2);
        expect(res.totals.tenantsWithGrain).toBe(1);
        expect(res.totals.binUtilisationPct).toBeNull(); // no capacity anywhere
        const empty = res.perTenant.find((r) => r.tenantId === 'empty')!;
        expect(empty.contractedSaleTonnes).toBe(0);
        expect(empty.totalYieldTonnes).toBe(0);
        expect(empty.totalActivityCost).toBe(0);
        expect(empty.binCount).toBe(0);
    });

    it('refuses a caller without canViewPortfolio', async () => {
        const ctx = ctxFor({
            permissions: {
                canViewPortfolio: false,
                canDrillDown: false,
                canExportReports: false,
                canManageTenants: false,
                canManageMembers: false,
                canConfigureDashboard: false,
            },
        });
        await expect(getPortfolioGrainSummary(ctx)).rejects.toThrow();
        expect(getPortfolioDataMock).not.toHaveBeenCalled();
    });
});
