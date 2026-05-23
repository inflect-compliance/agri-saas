export {};
/**
 * Vendor Renewal Check — Tenant Isolation Tests
 *
 * Verifies that:
 * 1. Tenant-scoped jobs only query vendors for that tenant
 * 2. Tenant A data never leaks into Tenant B results
 * 3. System-wide mode (no tenantId) scans all tenants intentionally
 * 4. tenantId propagates from job → service → DB queries
 */

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

// ── Mock setup ───────────────────────────────────────────────────────

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis(),
};

const mockVendorFindMany = jest.fn().mockResolvedValue([]);

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    jest.mock('@/lib/observability/logger', () => ({ logger: mockLogger }));
    jest.mock('@/lib/observability/job-runner', () => ({
        runJob: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }));
    jest.mock('@/lib/prisma', () => ({
        __esModule: true,
        default: {
            vendor: { findMany: (...args: unknown[]) => mockVendorFindMany(...args) },
        },
    }));
});

// ═════════════════════════════════════════════════════════════════════
// 1. Service Layer — findDueVendorsAndEmitEvents
// ═════════════════════════════════════════════════════════════════════

describe('findDueVendorsAndEmitEvents — tenant isolation', () => {
    test('tenant-scoped call adds tenantId to ALL query where clauses', async () => {
        const { findDueVendorsAndEmitEvents } = await import(
            '../../src/app-layer/services/vendor-renewals'
        );
        await findDueVendorsAndEmitEvents({ tenantId: TENANT_A });

        // 4 queries: overdue reviews, due reviews, overdue renewals, due renewals
        expect(mockVendorFindMany).toHaveBeenCalledTimes(4);

        for (let i = 0; i < 4; i++) {
            const call = mockVendorFindMany.mock.calls[i][0];
            expect(call.where).toHaveProperty('tenantId', TENANT_A);
        }
    });

    test('system-wide call (no tenantId) does NOT add tenantId to queries', async () => {
        const { findDueVendorsAndEmitEvents } = await import(
            '../../src/app-layer/services/vendor-renewals'
        );
        await findDueVendorsAndEmitEvents(); // no options

        expect(mockVendorFindMany).toHaveBeenCalledTimes(4);

        for (let i = 0; i < 4; i++) {
            const call = mockVendorFindMany.mock.calls[i][0];
            expect(call.where).not.toHaveProperty('tenantId');
        }
    });

    test('tenant A results do not include tenant B vendors', async () => {
        // Return mixed-tenant data from the mock (simulating unfiltered DB)

        // The DB mock returns only what the query filter would return
        // When properly filtered, only tenant A's vendor should come back
        mockVendorFindMany.mockImplementation((args: { where: Record<string, unknown> }) => {
            const tenantAReviewVendor = {
                id: 'v-a1', tenantId: TENANT_A, name: 'Vendor A',
                ownerUserId: null,
                nextReviewAt: new Date('2020-01-01'),
                contractRenewalAt: new Date('2020-01-01'),
            };
            const tenantBReviewVendor = {
                id: 'v-b1', tenantId: TENANT_B, name: 'Vendor B',
                ownerUserId: null,
                nextReviewAt: new Date('2020-01-01'),
                contractRenewalAt: new Date('2020-01-01'),
            };
            const all = [tenantAReviewVendor, tenantBReviewVendor];
            if (args.where.tenantId) {
                return Promise.resolve(
                    all.filter(v => v.tenantId === args.where.tenantId)
                );
            }
            return Promise.resolve(all);
        });

        const { findDueVendorsAndEmitEvents } = await import(
            '../../src/app-layer/services/vendor-renewals'
        );
        const results = await findDueVendorsAndEmitEvents({ tenantId: TENANT_A });

        // Every result must belong to tenant A
        for (const r of results) {
            expect(r.tenantId).toBe(TENANT_A);
        }
        // Tenant B vendor must NOT appear
        expect(results.find(r => r.tenantId === TENANT_B)).toBeUndefined();
    });

    test('logging indicates tenant-scoped mode when tenantId provided', async () => {
        const { findDueVendorsAndEmitEvents } = await import(
            '../../src/app-layer/services/vendor-renewals'
        );
        await findDueVendorsAndEmitEvents({ tenantId: TENANT_A });

        const startLog = mockLogger.info.mock.calls.find(
            (c: string[]) => c[0] === 'vendor renewal scan starting'
        );
        expect(startLog).toBeDefined();
        expect(startLog[1]).toMatchObject({
            scope: 'tenant-scoped',
            tenantId: TENANT_A,
        });
    });

    test('logging indicates system-wide mode when no tenantId', async () => {
        const { findDueVendorsAndEmitEvents } = await import(
            '../../src/app-layer/services/vendor-renewals'
        );
        await findDueVendorsAndEmitEvents();

        const startLog = mockLogger.info.mock.calls.find(
            (c: string[]) => c[0] === 'vendor renewal scan starting'
        );
        expect(startLog).toBeDefined();
        expect(startLog[1]).toMatchObject({ scope: 'system-wide' });
        expect(startLog[1]).not.toHaveProperty('tenantId');
    });
});

// ═════════════════════════════════════════════════════════════════════
// 2. Job Layer — runVendorRenewalCheck
// ═════════════════════════════════════════════════════════════════════

describe('runVendorRenewalCheck — tenantId propagation', () => {
    test('tenant-scoped job passes tenantId to service', async () => {
        const { runVendorRenewalCheck } = await import(
            '../../src/app-layer/jobs/vendor-renewal-check'
        );
        await runVendorRenewalCheck({ tenantId: TENANT_A });

        // All 4 queries must have tenantId in where clause
        expect(mockVendorFindMany).toHaveBeenCalledTimes(4);
        for (let i = 0; i < 4; i++) {
            const call = mockVendorFindMany.mock.calls[i][0];
            expect(call.where.tenantId).toBe(TENANT_A);
        }
    });

    test('job without tenantId runs system-wide (no tenantId in queries)', async () => {
        const { runVendorRenewalCheck } = await import(
            '../../src/app-layer/jobs/vendor-renewal-check'
        );
        await runVendorRenewalCheck({});

        expect(mockVendorFindMany).toHaveBeenCalledTimes(4);
        for (let i = 0; i < 4; i++) {
            const call = mockVendorFindMany.mock.calls[i][0];
            expect(call.where).not.toHaveProperty('tenantId');
        }
    });

    test('job returns only tenant-scoped DueItems', async () => {
        const tenantAVendor = {
            id: 'v-a1',
            tenantId: TENANT_A,
            name: 'Vendor A',
            ownerUserId: null,
            nextReviewAt: new Date('2020-01-01'),
            contractRenewalAt: new Date('2020-01-01'),
        };
        mockVendorFindMany.mockImplementation((args: { where: Record<string, unknown> }) => {
            if (args.where.tenantId === TENANT_A) {
                return Promise.resolve([tenantAVendor]);
            }
            return Promise.resolve([]);
        });

        const { runVendorRenewalCheck } = await import(
            '../../src/app-layer/jobs/vendor-renewal-check'
        );
        const { items } = await runVendorRenewalCheck({ tenantId: TENANT_A });

        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
            expect(item.tenantId).toBe(TENANT_A);
        }
    });

    test('job result includes correct scope in logging', async () => {
        const { runVendorRenewalCheck } = await import(
            '../../src/app-layer/jobs/vendor-renewal-check'
        );
        await runVendorRenewalCheck({ tenantId: TENANT_A });

        const completionLog = mockLogger.info.mock.calls.find(
            (c: string[]) => c[0] === 'vendor renewal check completed'
        );
        expect(completionLog).toBeDefined();
        expect(completionLog[1]).toMatchObject({
            scope: 'tenant-scoped',
            tenantId: TENANT_A,
        });
    });
});

// ═════════════════════════════════════════════════════════════════════
// 3. Cross-tenant isolation proof
// ═════════════════════════════════════════════════════════════════════

describe('Cross-tenant isolation', () => {
    test('running for tenant A never queries with tenant B ID', async () => {
        const { runVendorRenewalCheck } = await import(
            '../../src/app-layer/jobs/vendor-renewal-check'
        );
        await runVendorRenewalCheck({ tenantId: TENANT_A });

        for (const call of mockVendorFindMany.mock.calls) {
            const where = call[0].where;
            // Must be tenant A or no tenant filter — never tenant B
            if (where.tenantId) {
                expect(where.tenantId).toBe(TENANT_A);
                expect(where.tenantId).not.toBe(TENANT_B);
            }
        }
    });
});
