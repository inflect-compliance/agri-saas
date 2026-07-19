/**
 * lease-expiry-sweep unit tests.
 *
 * Locks the notification `linkUrl` shape (flag 1) so it can't silently
 * regress back to `/reports`:
 *   1. linkUrl deep-links to /t/{slug}/rent, appending ?locationId=<id> when
 *      the lease's parcel has a location.
 *   2. linkUrl omits the query when the parcel has no locationId.
 *   3. the per-(lease, recipient, endDate) dedupeKey shape holds.
 */
export {};

const DAY = new Date('2026-06-14T09:00:00Z');

const mockLeaseFindMany = jest.fn();
const mockMembershipFindMany = jest.fn();
const mockNotifFindMany = jest.fn();
const mockNotifCreateMany = jest.fn();
const mockPublish = jest.fn();

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn(), child: jest.fn().mockReturnThis() };

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    const client = {
        parcelLease: { findMany: (...a: unknown[]) => mockLeaseFindMany(...a) },
        tenantMembership: { findMany: (...a: unknown[]) => mockMembershipFindMany(...a) },
        notification: {
            findMany: (...a: unknown[]) => mockNotifFindMany(...a),
            createMany: (...a: unknown[]) => mockNotifCreateMany(...a),
        },
    };
    jest.mock('@/lib/prisma', () => ({ __esModule: true, default: client, prisma: client }));
    jest.mock('@/lib/notifications/notification-bus', () => ({
        publishNotificationEvent: (...a: unknown[]) => mockPublish(...a),
    }));
    jest.mock('@/lib/observability/job-runner', () => ({
        runJob: jest.fn(async (_n: string, fn: () => Promise<unknown>) => fn()),
    }));
    jest.mock('@/lib/observability/logger', () => ({ logger: mockLogger }));

    mockMembershipFindMany.mockResolvedValue([{ tenantId: 't1', userId: 'u1', tenant: { slug: 'acme' } }]);
    mockNotifFindMany.mockResolvedValue([]);
    mockNotifCreateMany.mockResolvedValue({ count: 1 });
});

async function run(opts: Record<string, unknown> = {}) {
    const { runLeaseExpirySweep } = await import('@/app-layer/jobs/lease-expiry-sweep');
    return runLeaseExpirySweep({ now: DAY, ...opts });
}

/** The single row handed to notification.createMany. */
function createdRow() {
    return mockNotifCreateMany.mock.calls[0][0].data[0];
}

describe('runLeaseExpirySweep — linkUrl', () => {
    test('deep-links to /t/{slug}/rent?locationId=<id> when the parcel has a location', async () => {
        mockLeaseFindMany.mockResolvedValue([
            {
                id: 'l1',
                tenantId: 't1',
                lessorName: 'Иван',
                endDate: new Date('2026-07-01T00:00:00Z'),
                parcel: { name: 'Нива 1', locationId: 'loc-9' },
            },
        ]);

        await run();

        expect(createdRow().linkUrl).toBe('/t/acme/rent?locationId=loc-9');
        // The live SSE event carries the same linkUrl.
        expect(mockPublish).toHaveBeenCalledWith(
            't1',
            'u1',
            expect.objectContaining({ linkUrl: '/t/acme/rent?locationId=loc-9' }),
        );
    });

    test('omits ?locationId when the parcel has no locationId', async () => {
        mockLeaseFindMany.mockResolvedValue([
            {
                id: 'l2',
                tenantId: 't1',
                lessorName: 'Петър',
                endDate: new Date('2026-07-01T00:00:00Z'),
                parcel: { name: 'Нива 2', locationId: null },
            },
        ]);

        await run();

        expect(createdRow().linkUrl).toBe('/t/acme/rent');
    });

    test('dedupeKey is per (lease, recipient, endDate)', async () => {
        mockLeaseFindMany.mockResolvedValue([
            {
                id: 'l3',
                tenantId: 't1',
                lessorName: 'Иван',
                endDate: new Date('2026-07-01T00:00:00Z'),
                parcel: { name: 'Нива 3', locationId: 'loc-1' },
            },
        ]);

        await run();

        expect(createdRow().dedupeKey).toBe('lease-expiry:t1:l3:u1:2026-07-01');
    });
});
