/**
 * weather-pull — daily cross-tenant weather pull + agro-signal eval.
 *
 * Fan-out shape mirrors `risk-appetite-jobs.ts`:
 *
 *   1. Resolve the tenant list — one tenant (payload.tenantId) or every
 *      tenant that owns at least one Location (`distinct ['tenantId']`).
 *   2. Per tenant, build a synthetic admin RequestContext (first ACTIVE
 *      OWNER/ADMIN membership) and run under `runInTenantContext`:
 *        a. list the tenant's non-deleted Locations (bounded),
 *        b. derive lat/lon per location — parcel-bbox centroid (geo.ts
 *           via ParcelRepository.boundsForLocation), else Location
 *           `boundsJson` ([w,s,e,n]) centroid, else SKIP (no coords),
 *        c. `fetchDailyWeather(lat, lon)` (Open-Meteo, free, no key),
 *        d. UPSERT one WeatherObservation per (locationId, obsDate),
 *           filling tempMeanC = (max+min)/2 when the API mean is absent.
 *   3. After persisting a location's weather, evaluate its agro signals
 *      (`evaluateLocationSignals`) — spray-window + disease-risk.
 *
 * The external `fetch` + the per-location upsert/eval are a WRITE/IO
 * loop, not a Prisma-read loop, so the N+1 guardrail doesn't apply; the
 * read inside each iteration lives in `boundsForLocation` /
 * `evaluateLocationSignals`, not as a literal `db.*.find*` in this loop.
 *
 * @module jobs/weather-pull
 */
import prisma from '@/lib/prisma';
import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole } from '@/lib/permissions';
import { runInTenantContext } from '@/lib/db-context';
import { ParcelRepository } from '@/app-layer/repositories/ParcelRepository';
import { fetchDailyWeather, type DailyWeather } from '@/lib/weather/open-meteo-client';
import { evaluateLocationSignals } from '@/app-layer/usecases/agro-signals';
import { bumpEntityCacheVersion } from '@/lib/cache/list-cache';
import { logger } from '@/lib/observability/logger';
import type { WeatherPullPayload } from './types';

/** Max tenants scanned per run (mirrors risk-appetite-jobs). */
const MAX_TENANTS = 5000;
/** Max locations processed per tenant per run. */
const MAX_LOCATIONS = 500;

export interface WeatherPullResult {
    tenants: number;
    scanned: number;
    created: number;
    signals: number;
}

/** Build a write-capable admin tenant context (first ACTIVE OWNER/ADMIN). */
async function buildCtx(tenantId: string, slug: string | null): Promise<RequestContext | null> {
    const admin = await prisma.tenantMembership.findFirst({
        where: { tenantId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
        select: { userId: true, role: true },
        orderBy: { createdAt: 'asc' },
    });
    if (!admin) return null;
    const appPermissions = getPermissionsForRole(admin.role);
    return {
        requestId: `weather-pull-${tenantId}`,
        userId: admin.userId,
        tenantId,
        tenantSlug: slug ?? undefined,
        role: admin.role,
        permissions: {
            canRead: true,
            canWrite: true,
            canAdmin: appPermissions.admin.manage,
            canAudit: false,
            canExport: false,
        },
        appPermissions,
    };
}

/** Parcel-bbox centroid, else boundsJson centroid, else null. */
async function deriveLatLon(
    db: Parameters<Parameters<typeof runInTenantContext>[1]>[0],
    ctx: RequestContext,
    location: { id: string; boundsJson: unknown },
): Promise<{ lat: number; lon: number } | null> {
    // 1. Parcel bbox via geo.ts.
    const bbox = await ParcelRepository.boundsForLocation(db, ctx, location.id);
    if (bbox) {
        const [w, s, e, n] = bbox;
        return { lat: (s + n) / 2, lon: (w + e) / 2 };
    }
    // 2. Location.boundsJson = [west, south, east, north].
    const b = location.boundsJson;
    if (Array.isArray(b) && b.length === 4 && b.every((x) => typeof x === 'number')) {
        const [w, s, e, n] = b as number[];
        return { lat: (s + n) / 2, lon: (w + e) / 2 };
    }
    // 3. No coordinates — skip.
    return null;
}

/** Mean temp from the API, or the (max+min)/2 fallback when absent. */
function meanTemp(day: DailyWeather): number | null {
    if (day.tempMeanC != null) return day.tempMeanC;
    if (day.tempMaxC != null && day.tempMinC != null) {
        return Math.round(((day.tempMaxC + day.tempMinC) / 2) * 100) / 100;
    }
    return null;
}

/** UTC calendar-day Date (midnight) from an ISO date string. */
function obsDateOf(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export async function runWeatherPull(
    payload: WeatherPullPayload = {},
): Promise<WeatherPullResult> {
    // ── Resolve tenant list ──
    let tenantIds: string[];
    if (payload.tenantId) {
        tenantIds = [payload.tenantId];
    } else {
        const rows = await prisma.location.findMany({
            where: { deletedAt: null },
            distinct: ['tenantId'],
            select: { tenantId: true },
            take: MAX_TENANTS,
        });
        tenantIds = rows.map((r) => r.tenantId);
    }

    let scanned = 0;
    let created = 0;
    let signals = 0;

    // Bounded cross-tenant fan-out (the risk-appetite-jobs pattern): the
    // per-TENANT reads inside this loop — tenant slug lookup + that
    // tenant's location list — are NOT per-row N+1. The loop is over the
    // distinct tenant set (capped at MAX_TENANTS) and each tenant's
    // location list is capped at MAX_LOCATIONS, run inside its own RLS tx.
    for (const tenantId of tenantIds) { // guardrail-allow: n+1
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { slug: true },
        });
        const ctx = await buildCtx(tenantId, tenant?.slug ?? null);
        if (!ctx) continue;

        try {
            // Per-tenant: list locations + upsert weather (one tx).
            const locations = await runInTenantContext(ctx, async (db) => {
                const locs = await db.location.findMany({
                    where: { tenantId, deletedAt: null },
                    select: { id: true, name: true, boundsJson: true },
                    take: MAX_LOCATIONS,
                });

                const processed: string[] = [];
                for (const loc of locs) {
                    const coords = await deriveLatLon(db, ctx, loc);
                    if (!coords) continue; // no coordinates → skip
                    scanned++;

                    let days: DailyWeather[];
                    try {
                        days = await fetchDailyWeather(coords.lat, coords.lon);
                    } catch (err) {
                        logger.warn('weather-pull: fetch failed for location', {
                            component: 'weather-pull',
                            tenantId,
                            locationId: loc.id,
                            error: err instanceof Error ? err.message : String(err),
                        });
                        continue;
                    }

                    for (const day of days) {
                        const obsDate = obsDateOf(day.date);
                        const data = {
                            source: 'open-meteo',
                            tempMaxC: day.tempMaxC,
                            tempMinC: day.tempMinC,
                            tempMeanC: meanTemp(day),
                            precipMm: day.precipMm,
                            windMaxKmh: day.windMaxKmh,
                            humidityMean: day.humidityMean,
                            rawJson: day as unknown as object,
                        };
                        await db.weatherObservation.upsert({
                            where: {
                                tenantId_locationId_obsDate: { tenantId, locationId: loc.id, obsDate },
                            },
                            create: { tenantId, locationId: loc.id, obsDate, ...data },
                            update: data,
                        });
                        created++;
                    }
                    processed.push(loc.id);
                }
                return processed;
            });

            // Invalidate this tenant's weather-derived read cache (e.g.
            // per-planting GDD) now that its WeatherObservation rows have
            // been upserted. The job runs per-tenant, so bump once per
            // tenant with the per-tenant ctx — `bumpEntityCacheVersion`
            // only reads `ctx.tenantId`. Fires AFTER the upsert tx commits
            // and NEVER throws.
            await bumpEntityCacheVersion(ctx, 'weather-observation');

            // Per-location signal evaluation — AFTER weather is persisted.
            // `evaluateLocationSignals` manages its own tx(s); calling it
            // here (outside the upsert tx) avoids nesting transactions and
            // lets the disease path call createRisk (own tx).
            for (const locationId of locations) {
                try {
                    const r = await evaluateLocationSignals(ctx, locationId);
                    signals += r.created;
                } catch (err) {
                    logger.warn('weather-pull: signal eval failed', {
                        component: 'weather-pull',
                        tenantId,
                        locationId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        } catch (err) {
            logger.warn('weather-pull: tenant scan failed', {
                component: 'weather-pull',
                tenantId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return { tenants: tenantIds.length, scanned, created, signals };
}
