/**
 * GDD on plantings — accumulate Growing Degree Days for a single
 * planting from its sow date to today, over the WeatherObservation rows
 * pulled for the planting's location.
 *
 * Consumes the PURE `accumulateGdd` accumulator in `src/lib/agro/gdd.ts`
 * (average method, base-temp floor). The usecase's only job is to load
 * the right window of weather and feed it in.
 *
 * Base temperature: `GDD_BASE_TEMP_C = 10` °C — the conventional default
 * for many warm-season crops. CropVariety carries no per-variety base
 * temperature column today; a per-variety base temp is a documented
 * follow-up (add a `gddBaseC` column to CropVariety + thread it here).
 *
 * @module usecases/agro-gdd
 */
import type { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { notFound } from '@/lib/errors/types';
import { accumulateGdd, type DailyTemp, type GddDay } from '@/lib/agro/gdd';
import { cachedListRead } from '@/lib/cache/list-cache';

/**
 * Default GDD base temperature (°C). Module constant — see the file
 * header for the per-variety follow-up note.
 */
export const GDD_BASE_TEMP_C = 10;

/** Bound on observation rows loaded per planting (sow→today window). */
const GDD_MAX_DAYS = 400;

export interface PlantingGddResult {
    plantingId: string;
    /** Sow date the accumulation starts from (ISO date), or null. */
    sowDate: string | null;
    /** Base temperature used (°C). */
    baseTempC: number;
    /** Total accumulated GDD over the window (0 when no weather/sow date). */
    totalGdd: number;
    /** Per-day GDD + running cumulative — for plotting the curve. */
    days: GddDay[];
    /**
     * GDD-to-maturity target for the variety, when known. CropVariety
     * has no GDD column today, so this is always null — reserved for the
     * per-variety follow-up.
     */
    targetGdd: number | null;
}

function num(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Accumulate GDD for one planting from sow date → today.
 *
 * Returns an empty accumulation (`totalGdd: 0, days: []`) — never throws
 * — when the planting has no sow date or no location, so a UI cell can
 * render "—" rather than an error. Throws `notFound` only when the
 * planting id itself doesn't resolve in the tenant.
 */
export async function getPlantingGdd(
    ctx: RequestContext,
    plantingId: string,
    now: Date = new Date(),
): Promise<PlantingGddResult> {
    assertCanRead(ctx);

    return runInTenantContext(ctx, async (db) => {
        const planting = await db.planting.findFirst({
            where: { id: plantingId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, sowDate: true, locationId: true },
        });
        if (!planting) throw notFound('Planting not found');

        const empty: PlantingGddResult = {
            plantingId: planting.id,
            sowDate: planting.sowDate ? planting.sowDate.toISOString().slice(0, 10) : null,
            baseTempC: GDD_BASE_TEMP_C,
            totalGdd: 0,
            days: [],
            targetGdd: null,
        };

        // No sow date or no location ⇒ no accumulation window. Returned
        // OUTSIDE the cache wrapper (cheap, no weather read) — only the
        // weather-dependent accumulation below is cached.
        if (!planting.sowDate || !planting.locationId) return empty;
        const sowDate = planting.sowDate;
        const locationId = planting.locationId;

        // Cache the weather-read + GDD accumulation. The window grows
        // daily (lte: now) so the `day` bucket (today, UTC) is part of
        // the key — the 6h cache still rolls over each calendar day, and
        // a same-day weather-pull invalidates via the
        // `'weather-observation'` version bump. The planting lookup and
        // the empty-window early-return above stay OUTSIDE the cache so a
        // `notFound` / no-window result is never cached.
        const { totalGdd, days } = await cachedListRead({
            ctx,
            entity: 'weather-observation',
            operation: 'gdd',
            params: {
                plantingId: planting.id,
                locationId,
                sowDate: sowDate.toISOString().slice(0, 10),
                day: now.toISOString().slice(0, 10),
            },
            ttlSeconds: 21600,
            loader: () =>
                runInTenantContext(ctx, async (innerDb) => {
                    const obs = await innerDb.weatherObservation.findMany({
                        where: {
                            tenantId: ctx.tenantId,
                            locationId,
                            obsDate: { gte: sowDate, lte: now },
                        },
                        orderBy: { obsDate: 'asc' },
                        take: GDD_MAX_DAYS,
                        select: { obsDate: true, tempMaxC: true, tempMinC: true },
                    });

                    const series: DailyTemp[] = [];
                    for (const o of obs) {
                        const tMax = num(o.tempMaxC);
                        const tMin = num(o.tempMinC);
                        // A day missing either bound contributes nothing — skip it
                        // rather than feed a NaN into the accumulator.
                        if (tMax == null || tMin == null) continue;
                        series.push({ date: o.obsDate.toISOString().slice(0, 10), tempMaxC: tMax, tempMinC: tMin });
                    }

                    const acc = accumulateGdd(series, { baseTempC: GDD_BASE_TEMP_C });
                    return { totalGdd: acc.totalGdd, days: acc.days };
                }),
        });

        return {
            ...empty,
            totalGdd,
            days,
        };
    });
}
