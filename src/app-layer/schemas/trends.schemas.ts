/**
 * Zod schemas for the market-price trends read API.
 *
 * @module app-layer/schemas/trends.schemas
 */
import { z } from 'zod';

import { NEWS_CATEGORIES } from '@/lib/news/categorize';

/** Commodities the trends chart supports (matches the MarketPriceSeries slugs). */
export const TrendCommodity = z.enum(['wheat', 'maize', 'barley', 'sunflower']);
export type TrendCommodity = z.infer<typeof TrendCommodity>;

/** News category buckets (single source of truth: src/lib/news/categorize.ts). */
export const NewsCategory = z.enum(NEWS_CATEGORIES);
export type NewsCategory = z.infer<typeof NewsCategory>;

/**
 * Query params for GET /api/t/[tenantSlug]/trends/news. `category` accepts a
 * bucket or the sentinel 'all' (default) which means no filter; `limit` is
 * bounded so a client can never ask for an unbounded scan.
 */
export const TrendNewsQuerySchema = z.object({
    category: z.union([NewsCategory, z.literal('all')]).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TrendNewsQuery = z.infer<typeof TrendNewsQuerySchema>;

/** Time window the chart requests. */
export const TrendRange = z.enum(['1m', '3m', '1y', 'all']);
export type TrendRange = z.infer<typeof TrendRange>;

/** Query params for GET /api/t/[tenantSlug]/trends/prices. */
export const TrendPricesQuerySchema = z.object({
    commodity: TrendCommodity,
    range: TrendRange.default('1y'),
});
export type TrendPricesQuery = z.infer<typeof TrendPricesQuerySchema>;

/** Number of days each range window looks back (`all` → null = unbounded). */
export const RANGE_LOOKBACK_DAYS: Record<TrendRange, number | null> = {
    '1m': 31,
    '3m': 93,
    '1y': 366,
    all: null,
};
