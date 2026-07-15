/**
 * Integration test: market-news-pull upsert idempotence + prune, real DB.
 *
 * The RSS fetch is injected (deps.fetchFeedImpl) so no network is touched; the
 * DB client is the test-DB client (deps.db). Core invariants: re-running with
 * identical items produces an IDENTICAL row count (guidHash unique makes every
 * write idempotent), and items older than 60 days are pruned.
 */
import { runMarketNewsPull } from '@/app-layer/jobs/market-news-pull';
import type { RawNewsItem } from '@/lib/news/rss-client';
import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import type { PrismaClient } from '@prisma/client';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

// One fixed feed list, independent of the curated defaults / env.
jest.mock('@/lib/news/feeds', () => ({
    resolveNewsFeeds: () => [
        { slug: 'agri-bg', url: 'https://agri.bg/rss', defaultCategory: 'general' },
    ],
}));

function item(over: Partial<RawNewsItem> = {}): RawNewsItem {
    return {
        title: 'Цената на пшеницата се покачва',
        url: 'https://agri.bg/news/1',
        summary: 'Пазарен обзор',
        publishedAt: new Date('2026-07-14T00:00:00Z'),
        guid: 'agri-1',
        imageUrl: null,
        ...over,
    };
}

const NOW = () => new Date('2026-07-15T12:00:00Z');

describeFn('market-news-pull (integration — real DB)', () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
    });

    beforeEach(async () => {
        await prisma.marketNewsItem.deleteMany({});
    });

    afterAll(async () => {
        await prisma.marketNewsItem.deleteMany({});
    });

    it('persists items, categorises them, and is idempotent across re-runs', async () => {
        const fetchFeedImpl = jest.fn().mockResolvedValue([
            item({ guid: 'a', url: 'https://agri.bg/1', title: 'Цената на пшеницата' }),
            item({ guid: 'b', url: 'https://agri.bg/2', title: 'Субсидии по ДФЗ' }),
        ]);

        const first = await runMarketNewsPull({}, { db: prisma, fetchFeedImpl, now: NOW });
        expect(first.upserted).toBe(2);
        expect(await prisma.marketNewsItem.count()).toBe(2);

        // Keyword categorisation landed.
        const market = await prisma.marketNewsItem.findFirst({ where: { category: 'market' } });
        const policy = await prisma.marketNewsItem.findFirst({ where: { category: 'policy' } });
        expect(market?.title).toContain('пшеница');
        expect(policy?.title).toContain('ДФЗ');

        // Re-run with identical items — no new rows (guidHash unique).
        await runMarketNewsPull({}, { db: prisma, fetchFeedImpl, now: NOW });
        expect(await prisma.marketNewsItem.count()).toBe(2);
    });

    it('prunes items older than 60 days', async () => {
        const fetchFeedImpl = jest.fn().mockResolvedValue([
            item({ guid: 'fresh', url: 'https://agri.bg/fresh', publishedAt: new Date('2026-07-14T00:00:00Z') }),
            item({ guid: 'stale', url: 'https://agri.bg/stale', publishedAt: new Date('2026-01-01T00:00:00Z') }),
        ]);

        const r = await runMarketNewsPull({}, { db: prisma, fetchFeedImpl, now: NOW });
        expect(r.pruned).toBe(1);
        // Only the fresh item survives.
        const rows = await prisma.marketNewsItem.findMany();
        expect(rows).toHaveLength(1);
        expect(rows[0].guidHash).toBeTruthy();
        expect(rows[0].publishedAt.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    });
});
