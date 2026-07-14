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
} from '@/app-layer/schemas/trends.schemas';

const CACHE_TTL_SECONDS = 21_600; // 6h — data refreshes weekly/daily
const MAX_SERIES = 100;
const MAX_POINTS_PER_SERIES = 1000;
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
