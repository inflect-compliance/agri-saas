/**
 * Shared handler for the satellite-index tile routes
 * (`/api/t/[tenantSlug]/agro/<index>-tiles`).
 *
 * NDVI / NDMI / NDRE / GNDVI / EVI all have the SAME request shape and
 * caching behaviour — only the Earth-Engine tile function + the cache-key
 * prefix differ. Each route file stays a thin `GET` that calls
 * `handleIndexTiles(index, getTileUrl, req, params)`; the route imports its
 * own `get<Index>TileUrl` so the per-route unit tests keep mocking a single
 * named function.
 *
 *   GET ?locationId=<id>&date=<YYYY-MM-DD>
 *     → { configured: boolean, tileUrl: string, date?: string, error?: string }
 *
 * `configured:false` ⇒ this deployment has no GEE credentials (the client
 * shows a muted hint). `tileUrl:''` with `configured:true` ⇒ configured but
 * nothing to show (no field geometry, or a transient generation failure in
 * `error`) — the overlay simply stays off without breaking the map.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { listLocationParcels } from '@/app-layer/usecases/location';
import { isGeeConfigured } from '@/lib/agro/earth-engine';
import type { NdviAoi, NdviWindow } from '@/lib/agro/earth-engine';
import type { VegetationIndex } from '@/lib/agro/vegetation-indices';
import { getRedis } from '@/lib/redis';
import { jsonResponse } from '@/lib/api-response';

const QuerySchema = z.object({
    locationId: z.string().min(1),
    // Optional inspection date; defaults to today. The composite window is
    // the 30 days ENDING on this date.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const CACHE_TTL_SECONDS = 21_600; // 6h — comfortably inside the EE mapid lifetime
const WINDOW_DAYS = 30;

function ymd(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * Run the shared tile-route pipeline for `index`, generating the composite
 * via `getTileUrl` (the index's `get<Index>TileUrl` from `earth-engine.ts`).
 */
export async function handleIndexTiles(
    index: VegetationIndex,
    getTileUrl: (aoi: NdviAoi, win: NdviWindow) => Promise<string>,
    req: NextRequest,
    paramsPromise: Promise<{ tenantSlug: string }>,
) {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);

    // No GEE creds on this deploy → tell the client to stay quiet.
    if (!isGeeConfigured()) {
        return jsonResponse({ configured: false, tileUrl: '' });
    }

    const query = QuerySchema.parse(
        Object.fromEntries(req.nextUrl.searchParams.entries()),
    );

    // Resolve the location's field bounds [west, south, east, north].
    // `bounds` is a Prisma Json column — validate the tuple shape before
    // use so a malformed/absent value just skips the overlay.
    const { bounds } = await listLocationParcels(ctx, query.locationId);
    const box = bounds as unknown as number[] | null;
    if (!box || !Array.isArray(box) || box.length < 4) {
        // Configured, but the location has no mapped field yet.
        return jsonResponse({ configured: true, tileUrl: '' });
    }
    const [west, south, east, north] = box;

    const endDate = query.date ? new Date(`${query.date}T00:00:00Z`) : new Date();
    const end = ymd(endDate);
    const startDate = new Date(endDate.getTime() - WINDOW_DAYS * 86_400_000);
    const start = ymd(startDate);

    const cacheKey = `${index}:tile:${ctx.tenantId}:${query.locationId}:${end}`;
    const redis = getRedis();

    // Cache hit — return the still-valid tile URL.
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return jsonResponse({ configured: true, tileUrl: cached, date: end });
            }
        } catch {
            /* redis hiccup — fall through and generate */
        }
    }

    let tileUrl: string;
    try {
        tileUrl = await getTileUrl({ west, south, east, north }, { start, end });
    } catch {
        // A GEE failure must not break the map — report it softly so the
        // overlay stays off and the rest of the page works.
        return jsonResponse({ configured: true, tileUrl: '', date: end, error: 'generation_failed' });
    }

    if (redis) {
        try {
            await redis.set(cacheKey, tileUrl, 'EX', CACHE_TTL_SECONDS);
        } catch {
            /* redis hiccup — the URL is still returned, just uncached */
        }
    }

    return jsonResponse({ configured: true, tileUrl, date: end });
}
