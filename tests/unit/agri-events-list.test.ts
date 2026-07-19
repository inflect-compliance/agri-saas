/**
 * `listUpcomingAgriEvents` — the tenant-facing read of the GLOBAL agriculture
 * events catalogue (#15).
 *
 * This replaces a `typeof … === 'function'` smoke test, which asserted the
 * export existed and nothing about what it did. The three things worth pinning
 * are the ones a reader actually depends on: "upcoming" includes an event that
 * has STARTED but not ended (a multi-day fair you can still travel to), the
 * feed is soonest-first (a deadline three days out must not sort below a fair
 * three months out), and the caller-supplied limit is clamped so a hostile or
 * careless `?limit` can't pull the whole table.
 */
export {};

const mockFindMany = jest.fn();
const mockAssertCanRead = jest.fn();

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, fn: (db: unknown) => unknown) =>
        fn({ agriEvent: { findMany: (...a: unknown[]) => mockFindMany(...a) } }),
}));
jest.mock('@/app-layer/policies/common', () => ({
    assertCanRead: (...a: unknown[]) => mockAssertCanRead(...a),
}));

import { listUpcomingAgriEvents } from '@/app-layer/usecases/agri-events';
import { makeRequestContext } from '../helpers/make-context';

const ctx = makeRequestContext('READER', { userId: 'u-1', tenantId: 't-1', tenantSlug: 'acme' });
const NOW = new Date('2026-08-01T12:00:00.000Z');

function row(over: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'ev-1',
        title: 'Event',
        description: null,
        category: 'fair',
        startsAt: new Date('2026-08-10T00:00:00.000Z'),
        endsAt: null,
        place: null,
        url: null,
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
});

describe('authorization', () => {
    it('asserts read access before touching the catalogue', async () => {
        await listUpcomingAgriEvents(ctx, { now: NOW });
        expect(mockAssertCanRead).toHaveBeenCalledWith(ctx);
    });
});

describe('the "upcoming" predicate', () => {
    it('includes an event still running — started, but endsAt is in the future', async () => {
        await listUpcomingAgriEvents(ctx, { now: NOW });
        const { where } = mockFindMany.mock.calls[0][0];

        // An ongoing multi-day fair matches the first arm regardless of its
        // start, which is the whole point of keying on endsAt.
        expect(where.OR).toContainEqual({ endsAt: { gte: NOW } });
    });

    it('includes a future event that has no end date', async () => {
        await listUpcomingAgriEvents(ctx, { now: NOW });
        const { where } = mockFindMany.mock.calls[0][0];

        expect(where.OR).toContainEqual({ endsAt: null, startsAt: { gte: NOW } });
    });

    it('excludes a fully past event — neither arm can match it', async () => {
        await listUpcomingAgriEvents(ctx, { now: NOW });
        const { where } = mockFindMany.mock.calls[0][0];

        const past = { startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-03') };
        const [ongoing, undated] = where.OR;

        // endsAt (3 Jul) is not >= now (1 Aug) …
        expect(past.endsAt >= NOW).toBe(false);
        expect(ongoing).toEqual({ endsAt: { gte: NOW } });
        // … and the null-endsAt arm requires endsAt === null, which it isn't.
        expect(undated).toEqual({ endsAt: null, startsAt: { gte: NOW } });
    });

    it('defaults "now" to the current clock when the caller omits it', async () => {
        const before = Date.now();
        await listUpcomingAgriEvents(ctx);
        const { where } = mockFindMany.mock.calls[0][0];

        const used: Date = where.OR[0].endsAt.gte;
        expect(used.getTime()).toBeGreaterThanOrEqual(before);
        expect(used.getTime()).toBeLessThanOrEqual(Date.now());
    });
});

describe('ordering', () => {
    it('is soonest-first, so a near deadline outranks a distant fair', async () => {
        await listUpcomingAgriEvents(ctx, { now: NOW });
        expect(mockFindMany.mock.calls[0][0].orderBy).toEqual({ startsAt: 'asc' });
    });
});

describe('the take clamp', () => {
    it('defaults to 50', async () => {
        await listUpcomingAgriEvents(ctx, { now: NOW });
        expect(mockFindMany.mock.calls[0][0].take).toBe(50);
    });

    it('honours a limit inside the range', async () => {
        await listUpcomingAgriEvents(ctx, { limit: 20, now: NOW });
        expect(mockFindMany.mock.calls[0][0].take).toBe(20);
    });

    it('caps an oversized limit at 100 rather than reading the whole table', async () => {
        await listUpcomingAgriEvents(ctx, { limit: 10_000, now: NOW });
        expect(mockFindMany.mock.calls[0][0].take).toBe(100);
    });

    it('floors a zero or negative limit at 1 instead of passing take:0', async () => {
        await listUpcomingAgriEvents(ctx, { limit: 0, now: NOW });
        expect(mockFindMany.mock.calls[0][0].take).toBe(1);

        await listUpcomingAgriEvents(ctx, { limit: -5, now: NOW });
        expect(mockFindMany.mock.calls[1][0].take).toBe(1);
    });
});

describe('the DTO', () => {
    it('serialises dates to ISO strings and preserves nullable fields', async () => {
        mockFindMany.mockResolvedValue([
            row({
                id: 'ev-9',
                title: 'AGRA',
                description: 'Fair',
                category: 'fair',
                startsAt: new Date('2026-08-10T00:00:00.000Z'),
                endsAt: new Date('2026-08-14T00:00:00.000Z'),
                place: 'Plovdiv',
                url: 'https://example.test',
            }),
        ]);

        const [dto] = await listUpcomingAgriEvents(ctx, { now: NOW });

        expect(dto).toEqual({
            id: 'ev-9',
            title: 'AGRA',
            description: 'Fair',
            category: 'fair',
            startsAt: '2026-08-10T00:00:00.000Z',
            endsAt: '2026-08-14T00:00:00.000Z',
            place: 'Plovdiv',
            url: 'https://example.test',
        });
    });

    it('maps a null endsAt through as null, not as an invalid date string', async () => {
        mockFindMany.mockResolvedValue([row({ endsAt: null })]);
        const [dto] = await listUpcomingAgriEvents(ctx, { now: NOW });
        expect(dto.endsAt).toBeNull();
    });
});
