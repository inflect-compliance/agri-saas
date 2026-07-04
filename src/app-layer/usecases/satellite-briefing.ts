/**
 * AI field briefing — the read-model behind the dashboard's "Field
 * briefing" card (which replaced the static season-recap card).
 *
 * It assembles a snapshot of the farm's fields — crop + area from the
 * parcel graph, plus TODAY's field-area mean NDVI/NDMI from Google Earth
 * Engine when creds are configured — together with the season figures,
 * open-task count, and recent-journal signal, and asks Claude Haiku for a
 * short "what's important to do today" briefing.
 *
 * FAIL-SAFE + DEGRADING by construction:
 *   - No Claude key  → `aiConfigured: false`, `briefing: null` (card hides).
 *   - No GEE creds / no field geometry / an EE hiccup → the field simply
 *     carries no satellite reading; the AI still briefs from crop + season +
 *     activity context. `satelliteAvailable` reflects whether any real
 *     reading was obtained this run, so the card can label the data basis.
 *
 * Cost control: a successful briefing is cached per tenant per day (6h TTL)
 * in Redis, so the dashboard's frequent SWR polls cost at most one EE +
 * Haiku pass per tenant per day. Non-success (no key / generation failure)
 * is never cached, so it retries on the next load.
 */
import { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { listLocations, listLocationParcels } from './location';
import { listMyFarmTasks } from './farm-task';
import { listLogEntries } from './journal';
import { getSeasonRecap } from './season-recap';
import {
    generateFieldBriefing,
    isFieldBriefingConfigured,
    type FieldBriefing,
    type BriefingFieldInput,
} from '../ai/field-briefing';
import { isGeeConfigured, getIndexMeansForBounds } from '@/lib/agro/earth-engine';
import type { NdviAoi } from '@/lib/agro/earth-engine';
import { getRedis } from '@/lib/redis';
import { logger } from '@/lib/observability/logger';

/** The dashboard card payload. */
export interface FieldBriefingPayload {
    /** Whether a Claude key is configured on this deployment. */
    aiConfigured: boolean;
    /** Whether GEE satellite creds are configured on this deployment. */
    satelliteConfigured: boolean;
    /** Whether at least one field carried a real satellite reading this run. */
    satelliteAvailable: boolean;
    /** ISO timestamp the briefing was produced (or attempted). */
    generatedAt: string;
    /** The date the briefing is for, `YYYY-MM-DD`. */
    date: string;
    /** Number of mapped fields considered. */
    fieldCount: number;
    /** The AI briefing, or null when unavailable (card hides). */
    briefing: FieldBriefing | null;
}

/** How many fields to include in the briefing context. */
const MAX_FIELDS = 8;
/** Cap the per-run Earth Engine reduces (each is one round-trip). */
const MAX_SATELLITE_FIELDS = 6;
/** Composite window: the 30 days ending today (matches the tile routes). */
const WINDOW_DAYS = 30;
const CACHE_TTL_SECONDS = 21_600; // 6h

function ymd(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Validate a Prisma Json bounds value as a `[w, s, e, n]` AOI. */
function toAoi(bounds: unknown): NdviAoi | null {
    if (!Array.isArray(bounds) || bounds.length < 4) return null;
    const [west, south, east, north] = bounds;
    if ([west, south, east, north].some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
        return null;
    }
    return { west: west as number, south: south as number, east: east as number, north: north as number };
}

export async function getFieldBriefing(ctx: RequestContext): Promise<FieldBriefingPayload> {
    assertCanRead(ctx);

    const now = new Date();
    const date = ymd(now);
    const aiConfigured = isFieldBriefingConfigured();
    const satelliteConfigured = isGeeConfigured();

    // Not configured for AI → nothing to generate; the card hides.
    if (!aiConfigured) {
        return {
            aiConfigured: false,
            satelliteConfigured,
            satelliteAvailable: false,
            generatedAt: now.toISOString(),
            date,
            fieldCount: 0,
            briefing: null,
        };
    }

    // Cache hit — one EE + Haiku pass per tenant per day.
    const cacheKey = `field-briefing:v1:${ctx.tenantId}:${date}`;
    const redis = getRedis();
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached) as FieldBriefingPayload;
        } catch {
            /* redis hiccup — regenerate */
        }
    }

    // ── Gather field context (crop + area + optional satellite means) ──
    const end = ymd(now);
    const start = ymd(new Date(now.getTime() - WINDOW_DAYS * 86_400_000));

    const locations = await listLocations(ctx);
    const fieldLocations = locations
        .filter((l) => l.kind === 'FIELD' && l.status === 'ACTIVE')
        .slice(0, MAX_FIELDS);

    let satelliteReads = 0;
    let satelliteAvailable = false;

    const fields: BriefingFieldInput[] = await Promise.all(
        fieldLocations.map(async (loc): Promise<BriefingFieldInput> => {
            const { bounds, parcels } = await listLocationParcels(ctx, loc.id);
            const crops = [
                ...new Set(
                    parcels
                        .map((p) => (p.cropType ?? '').trim())
                        .filter((c) => c.length > 0),
                ),
            ];
            const areaHa = parcels.reduce<number | null>((sum, p) => {
                if (p.areaHa == null) return sum;
                return (sum ?? 0) + p.areaHa;
            }, null);

            let ndvi: number | null = null;
            let ndmi: number | null = null;
            const aoi = toAoi(bounds);
            if (satelliteConfigured && aoi && satelliteReads < MAX_SATELLITE_FIELDS) {
                satelliteReads += 1;
                try {
                    const means = await getIndexMeansForBounds(aoi, { start, end });
                    ndvi = means.ndvi;
                    ndmi = means.ndmi;
                    if (ndvi != null || ndmi != null) satelliteAvailable = true;
                } catch (error) {
                    // An EE failure for one field must not sink the briefing.
                    logger.warn('field-briefing satellite read failed', {
                        component: 'ag',
                        locationId: loc.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            return {
                name: loc.name,
                crops,
                areaHa: areaHa != null ? Math.round(areaHa * 100) / 100 : null,
                ndvi,
                ndmi,
            };
        }),
    );

    // Season figures + activity signals (each fail-safe / bounded).
    const season = await getSeasonRecap(ctx).catch(() => null);
    const [tasks, journal] = await Promise.all([
        listMyFarmTasks(ctx).catch(() => []),
        listLogEntries(ctx).catch(() => []),
    ]);

    const briefing = await generateFieldBriefing({
        today: date,
        satelliteAvailable,
        fields,
        season: season
            ? {
                  name: season.seasonName,
                  year: season.year,
                  totalAreaHa: season.totalAreaHa,
                  totalYieldTonnes: season.totalYieldTonnes,
                  avgYieldTPerHa: season.avgYieldTPerHa,
                  activityCount: season.activityCount,
              }
            : null,
        openTaskCount: tasks.length,
        recentJournalCount: journal.length,
    });

    const payload: FieldBriefingPayload = {
        aiConfigured: true,
        satelliteConfigured,
        satelliteAvailable,
        generatedAt: now.toISOString(),
        date,
        fieldCount: fields.length,
        briefing,
    };

    // Only cache a successful briefing — a null result (generation failure)
    // should retry on the next load, not stick for 6h.
    if (briefing && redis) {
        try {
            await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
        } catch {
            /* redis hiccup — the payload is still returned, just uncached */
        }
    }

    return payload;
}
