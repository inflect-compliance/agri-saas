/**
 * Market-price trends read usecase.
 *
 * Serves the GLOBAL MarketPriceSeries/Point cache grouped by (source, region)
 * so the chart can split lines by unit/currency (a BGN listings median and a
 * EUR EC cereal price must never share a Y axis). The response is Redis-cached
 * per (commodity, range) for 6h — the underlying data only refreshes weekly /
 * daily — and degrades to a live DB read on any Redis miss or hiccup.
 *
 * The data is tenant-agnostic (no tenantId), so the caller authenticates as a
 * tenant member but the payload is identical for every tenant.
 *
 * @module app-layer/usecases/trends
 */
import prisma from '@/lib/prisma';
import { getRedis } from '@/lib/redis';
import { logger } from '@/lib/observability/logger';
import {
    RANGE_LOOKBACK_DAYS,
    type TrendCommodity,
    type TrendRange,
    type NewsCategory,
} from '@/app-layer/schemas/trends.schemas';

const CACHE_TTL_SECONDS = 21_600; // 6h — data refreshes weekly/daily
const NEWS_CACHE_TTL_SECONDS = 3_600; // 1h — the news pull runs daily
const MAX_SERIES = 100;
const MAX_POINTS_PER_SERIES = 1000;
const MAX_NEWS = 100;
const COMPONENT = 'trends';

export interface TrendPoint {
    date: string; // yyyy-mm-dd
    price: number;
    /** Distinct-tenant sample size (listings series only). */
    count?: number;
}

export interface TrendSeries {
    source: string;
    region: string;
    stage: string | null;
    unit: string;
    currency: string;
    label: string | null;
    points: TrendPoint[];
}

export interface TrendPricesResponse {
    commodity: TrendCommodity;
    range: TrendRange;
    series: TrendSeries[];
}

function cutoffFor(range: TrendRange): Date | null {
    const days = RANGE_LOOKBACK_DAYS[range];
    if (days == null) return null;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d;
}

async function readFromDb(
    commodity: TrendCommodity,
    range: TrendRange,
): Promise<TrendPricesResponse> {
    const cutoff = cutoffFor(range);
    const series = await prisma.marketPriceSeries.findMany({
        where: { commodity },
        take: MAX_SERIES,
        orderBy: [{ source: 'asc' }, { region: 'asc' }, { stage: 'asc' }],
        include: {
            points: {
                where: cutoff ? { date: { gte: cutoff } } : undefined,
                orderBy: { date: 'asc' },
                take: MAX_POINTS_PER_SERIES,
                select: { date: true, price: true, meta: true },
            },
        },
    });

    const mapped: TrendSeries[] = series
        .map((s) => ({
            source: s.source,
            region: s.region,
            stage: s.stage,
            unit: s.unit,
            currency: s.currency,
            label: s.label,
            points: s.points.map((p) => {
                const count =
                    p.meta && typeof p.meta === 'object' && !Array.isArray(p.meta)
                        ? (p.meta as Record<string, unknown>).count
                        : undefined;
                return {
                    date: p.date.toISOString().slice(0, 10),
                    price: Number(p.price),
                    ...(typeof count === 'number' ? { count } : {}),
                };
            }),
        }))
        .filter((s) => s.points.length > 0);

    return { commodity, range, series: mapped };
}

/** Read the price trends for one commodity + range, Redis-cached (6h). */
export async function getPriceTrends(
    commodity: TrendCommodity,
    range: TrendRange,
): Promise<TrendPricesResponse> {
    const cacheKey = `trends:prices:v1:${commodity}:${range}`;
    const redis = getRedis();

    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached) as TrendPricesResponse;
        } catch {
            /* redis hiccup — fall through to a live DB read */
        }
    }

    const payload = await readFromDb(commodity, range);

    if (redis) {
        try {
            await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
        } catch (err) {
            // Non-fatal — the response is already computed, just uncached.
            logger.warn('trends: redis set failed', {
                component: COMPONENT,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return payload;
}

// ── News ──────────────────────────────────────────────────────────────

export interface NewsItem {
    id: string;
    /** Origin feed slug. */
    source: string;
    /** 'market' | 'policy' | 'general'. */
    category: string;
    title: string;
    summary: string | null;
    url: string;
    imageUrl: string | null;
    /** ISO-8601 publish time. */
    publishedAt: string;
}

export interface TrendNewsResponse {
    /** The requested filter ('all' when unfiltered). */
    category: NewsCategory | 'all';
    items: NewsItem[];
}

async function readNewsFromDb(
    category: NewsCategory | 'all',
    limit: number,
): Promise<TrendNewsResponse> {
    const rows = await prisma.marketNewsItem.findMany({
        where: category === 'all' ? undefined : { category },
        take: Math.min(limit, MAX_NEWS),
        orderBy: { publishedAt: 'desc' },
        select: {
            id: true,
            source: true,
            category: true,
            title: true,
            summary: true,
            url: true,
            imageUrl: true,
            publishedAt: true,
        },
    });

    const items: NewsItem[] = rows.map((r) => ({
        id: r.id,
        source: r.source,
        category: r.category,
        title: r.title,
        summary: r.summary,
        url: r.url,
        imageUrl: r.imageUrl,
        publishedAt: r.publishedAt.toISOString(),
    }));

    return { category, items };
}

/**
 * Read the aggregated agri-news feed, optionally filtered by category, newest
 * first. Redis-cached per (category, limit) for 1h — the pull runs daily — and
 * degrades to a live DB read on any Redis miss/hiccup. Tenant-agnostic payload
 * (the MarketNewsItem cache carries no tenantId).
 */
export async function getMarketNews(
    category: NewsCategory | 'all',
    limit: number,
): Promise<TrendNewsResponse> {
    const cacheKey = `trends:news:v1:${category}:${limit}`;
    const redis = getRedis();

    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached) as TrendNewsResponse;
        } catch {
            /* redis hiccup — fall through to a live DB read */
        }
    }

    const payload = await readNewsFromDb(category, limit);

    if (redis) {
        try {
            await redis.set(cacheKey, JSON.stringify(payload), 'EX', NEWS_CACHE_TTL_SECONDS);
        } catch (err) {
            logger.warn('trends: news redis set failed', {
                component: COMPONENT,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return payload;
}
