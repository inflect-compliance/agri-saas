/**
 * Platform-admin curation of the GLOBAL agriculture-events catalogue (#15),
 * plus the memoised existence probe backing the sidebar's Events entry.
 *
 * These writes are the only path that populates production, and they run with
 * NO tenant context — so the things worth pinning are: the curated category set
 * is enforced at the boundary, a partial update can't invert the date span
 * using a stale stored value, and every write drops the nav memo (otherwise a
 * freshly-curated event stays invisible for up to a minute).
 */
export {};

const mockAgriEvent = {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
};

jest.mock('@/lib/prisma', () => ({ prisma: { agriEvent: mockAgriEvent } }));
jest.mock('@/lib/observability', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
    createAgriEvent,
    updateAgriEvent,
    deleteAgriEvent,
    hasUpcomingAgriEvents,
    invalidateAgriEventsCache,
} from '@/app-layer/usecases/agri-events';
import {
    CreateAgriEventSchema,
    UpdateAgriEventSchema,
    AGRI_EVENT_CATEGORIES,
} from '@/app-layer/schemas/agri-event.schemas';

const actor = { requestId: 'test-req' };

beforeEach(() => {
    jest.clearAllMocks();
    invalidateAgriEventsCache();
});

describe('category is a closed set, enforced on write', () => {
    it('accepts every curated category', () => {
        for (const category of AGRI_EVENT_CATEGORIES) {
            const parsed = CreateAgriEventSchema.parse({
                title: 'x',
                category,
                startsAt: '2026-08-01T00:00:00.000Z',
            });
            expect(parsed.category).toBe(category);
        }
    });

    it('rejects an unknown category at the boundary rather than mislabeling it on read', () => {
        expect(() =>
            CreateAgriEventSchema.parse({
                title: 'x',
                category: 'conference',
                startsAt: '2026-08-01T00:00:00.000Z',
            }),
        ).toThrow();
    });

    it('defaults to fair when the caller omits it', () => {
        const parsed = CreateAgriEventSchema.parse({
            title: 'x',
            startsAt: '2026-08-01T00:00:00.000Z',
        });
        expect(parsed.category).toBe('fair');
    });

    it('rejects an unparseable date instead of persisting an Invalid Date', () => {
        expect(() => CreateAgriEventSchema.parse({ title: 'x', startsAt: 'not-a-date' })).toThrow();
    });

    it('rejects a span that ends before it starts', () => {
        expect(() =>
            CreateAgriEventSchema.parse({
                title: 'x',
                startsAt: '2026-08-10T00:00:00.000Z',
                endsAt: '2026-08-01T00:00:00.000Z',
            }),
        ).toThrow();
    });

    it('rejects an empty update payload', () => {
        expect(() => UpdateAgriEventSchema.parse({})).toThrow();
    });
});

describe('createAgriEvent', () => {
    it('persists and invalidates the nav memo so a new event shows immediately', async () => {
        // Prime the memo as empty — the nav would be hiding the entry.
        mockAgriEvent.findFirst.mockResolvedValue(null);
        expect(await hasUpcomingAgriEvents()).toBe(false);

        mockAgriEvent.create.mockResolvedValue({
            id: 'ev-1',
            category: 'fair',
            startsAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        await createAgriEvent(
            { title: 'AGRA', category: 'fair', startsAt: new Date('2026-08-01T00:00:00.000Z') },
            actor,
        );

        // The memo must have been dropped, so the next probe re-queries.
        mockAgriEvent.findFirst.mockResolvedValue({ id: 'ev-1' });
        expect(await hasUpcomingAgriEvents()).toBe(true);
    });
});

describe('updateAgriEvent', () => {
    it('404s on a missing row', async () => {
        mockAgriEvent.findUnique.mockResolvedValue(null);
        await expect(updateAgriEvent('nope', { title: 'x' }, actor)).rejects.toThrow(/not found/i);
        expect(mockAgriEvent.update).not.toHaveBeenCalled();
    });

    it('rejects a partial update that would invert the span against the STORED start', async () => {
        // Only endsAt is supplied; startsAt has to come from the row.
        mockAgriEvent.findUnique.mockResolvedValue({
            id: 'ev-1',
            startsAt: new Date('2026-08-10T00:00:00.000Z'),
            endsAt: new Date('2026-08-12T00:00:00.000Z'),
        });

        await expect(
            updateAgriEvent('ev-1', { endsAt: new Date('2026-08-01T00:00:00.000Z') }, actor),
        ).rejects.toThrow(/endsAt must not precede startsAt/);
        expect(mockAgriEvent.update).not.toHaveBeenCalled();
    });

    it('allows a partial update that stays ordered', async () => {
        mockAgriEvent.findUnique.mockResolvedValue({
            id: 'ev-1',
            startsAt: new Date('2026-08-10T00:00:00.000Z'),
            endsAt: null,
        });
        mockAgriEvent.update.mockResolvedValue({ id: 'ev-1' });

        await updateAgriEvent('ev-1', { endsAt: new Date('2026-08-14T00:00:00.000Z') }, actor);
        expect(mockAgriEvent.update).toHaveBeenCalledTimes(1);
    });
});

describe('deleteAgriEvent', () => {
    it('404s on a missing row', async () => {
        mockAgriEvent.findUnique.mockResolvedValue(null);
        await expect(deleteAgriEvent('nope', actor)).rejects.toThrow(/not found/i);
        expect(mockAgriEvent.delete).not.toHaveBeenCalled();
    });

    it('deletes and drops the memo so the nav can hide an emptied catalogue', async () => {
        mockAgriEvent.findUnique.mockResolvedValue({ id: 'ev-1' });
        mockAgriEvent.findFirst.mockResolvedValue({ id: 'ev-1' });
        expect(await hasUpcomingAgriEvents()).toBe(true);

        mockAgriEvent.delete.mockResolvedValue({ id: 'ev-1' });
        await deleteAgriEvent('ev-1', actor);

        mockAgriEvent.findFirst.mockResolvedValue(null);
        expect(await hasUpcomingAgriEvents()).toBe(false);
    });
});

describe('hasUpcomingAgriEvents', () => {
    it('memoises so the force-dynamic tenant layout does not re-query per navigation', async () => {
        mockAgriEvent.findFirst.mockResolvedValue({ id: 'ev-1' });

        await hasUpcomingAgriEvents();
        await hasUpcomingAgriEvents();
        await hasUpcomingAgriEvents();

        expect(mockAgriEvent.findFirst).toHaveBeenCalledTimes(1);
    });

    it('re-queries once the TTL lapses', async () => {
        mockAgriEvent.findFirst.mockResolvedValue({ id: 'ev-1' });
        const t0 = new Date('2026-08-01T00:00:00.000Z');
        await hasUpcomingAgriEvents(t0);
        await hasUpcomingAgriEvents(new Date(t0.getTime() + 61_000));

        expect(mockAgriEvent.findFirst).toHaveBeenCalledTimes(2);
    });

    it('asks only for existence, over the upcoming predicate', async () => {
        mockAgriEvent.findFirst.mockResolvedValue(null);
        const now = new Date('2026-08-01T00:00:00.000Z');
        await hasUpcomingAgriEvents(now);

        expect(mockAgriEvent.findFirst).toHaveBeenCalledWith({
            where: { OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }] },
            select: { id: true },
        });
    });
});
