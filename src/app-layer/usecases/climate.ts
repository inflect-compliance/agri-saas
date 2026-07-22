/**
 * Climate read usecase — surfaces the collected Open-Meteo `WeatherObservation`
 * data (temps / precip / wind / humidity + the hourly spray window) for the
 * /climate page.
 *
 * READ-ONLY. The `weather-pull` job (daily 06:00 UTC) + the `WeatherObservation`
 * rows are the source of truth; this only reads them, bounded + tenant-scoped,
 * exactly like `smart-defaults`' `loadSprayWindow`. The daily verdict + hourly
 * windows reuse the shared spray rules so /climate and the location-detail
 * banner tell the same story.
 *
 * @module usecases/climate
 */
import { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { assertCanRead } from '../policies/common';
import {
    evaluateSprayWindow,
    computeSprayWindows,
    DEFAULT_SPRAY_THRESHOLDS,
    type SprayWindowStatus,
    type SprayReason,
    type SprayHour,
    type SprayWindow,
} from '@/lib/agro/rules';

/** One selectable location for the /climate location picker. */
export interface WeatherLocationOption {
    id: string;
    name: string;
}

/** One calendar day of weather, Decimals coerced to numbers (null-preserving). */
export interface DailyWeather {
    /** YYYY-MM-DD (the obsDate calendar day). */
    date: string;
    tempMaxC: number | null;
    tempMinC: number | null;
    tempMeanC: number | null;
    precipMm: number | null;
    windMaxKmh: number | null;
    humidityMean: number | null;
}

/** Today's spray suitability — the daily verdict + the real time windows left. */
export interface ClimateSprayWindow {
    status: SprayWindowStatus;
    /** Structured reasons for i18n at the UI layer. */
    reasonCodes: SprayReason[];
    /** ISO of the obsDate the verdict is for. */
    obsDate: string;
    /** Suitable time ranges today (location-local, passed hours clipped). */
    windows: SprayWindow[];
}

/** The full climate view for one location. */
export interface LocationClimate {
    locationId: string;
    locationName: string;
    /** Location-local "today" (else the latest row) — the headline conditions. null when no weather yet. */
    current: DailyWeather | null;
    /** Chronological (ascending) recent + near-future daily series for the chart. */
    daily: DailyWeather[];
    /** Today's spray-window suitability. null when no weather yet. */
    sprayWindow: ClimateSprayWindow | null;
    /** The observation source (e.g. 'open-meteo'). */
    source: string;
    /** True when the series carries at least one day after `current` (a forecast tail). */
    hasForecast: boolean;
}

// Prisma Decimal | number | null → number | null (preserves "no value").
function toNumberOrNull(v: unknown): number | null {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (
        typeof v === 'object' &&
        'toNumber' in (v as object) &&
        typeof (v as { toNumber: unknown }).toNumber === 'function'
    ) {
        return (v as { toNumber: () => number }).toNumber();
    }
    return Number(v);
}

// obsDate (@db.Date, UTC midnight) → its YYYY-MM-DD calendar-day key.
function dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

// hourlyJson (Json?) → SprayHour[] — defensively typed; a legacy/absent series
// yields no hours (⇒ no windows), never a throw. Mirrors smart-defaults.
function parseHourly(raw: unknown): SprayHour[] {
    if (!Array.isArray(raw)) return [];
    const out: SprayHour[] = [];
    for (const item of raw) {
        if (item && typeof item === 'object') {
            const h = item as Record<string, unknown>;
            if (typeof h.hour === 'number') {
                out.push({
                    hour: h.hour,
                    windKmh: typeof h.windKmh === 'number' ? h.windKmh : null,
                    precipMm: typeof h.precipMm === 'number' ? h.precipMm : null,
                    tempC: typeof h.tempC === 'number' ? h.tempC : null,
                });
            }
        }
    }
    return out;
}

interface WeatherRow {
    obsDate: Date;
    tempMaxC: unknown;
    tempMinC: unknown;
    tempMeanC: unknown;
    precipMm: unknown;
    windMaxKmh: unknown;
    humidityMean: unknown;
    hourlyJson: unknown;
    utcOffsetSeconds: number | null;
    source: string;
}

function toDailyWeather(r: WeatherRow): DailyWeather {
    return {
        date: dayKey(r.obsDate),
        tempMaxC: toNumberOrNull(r.tempMaxC),
        tempMinC: toNumberOrNull(r.tempMinC),
        tempMeanC: toNumberOrNull(r.tempMeanC),
        precipMm: toNumberOrNull(r.precipMm),
        windMaxKmh: toNumberOrNull(r.windMaxKmh),
        humidityMean: toNumberOrNull(r.humidityMean),
    };
}

/**
 * The tenant's locations, for the /climate picker. Bounded + tenant-scoped;
 * ordered by name. (Weather is per-location, so the page needs a selector.)
 */
export async function listWeatherLocations(ctx: RequestContext): Promise<WeatherLocationOption[]> {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        db.location.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
            take: 200,
        }),
    );
}

/**
 * The climate view for one location: current conditions, the recent+forecast
 * daily series, and today's spray window. Returns null when the location is
 * missing/foreign; returns an empty-weather shape (current/sprayWindow null,
 * daily []) when the location exists but has no observations yet.
 *
 * `opts.now` is injectable for deterministic tests.
 */
export async function getLocationClimate(
    ctx: RequestContext,
    locationId: string,
    opts: { now?: Date } = {},
): Promise<LocationClimate | null> {
    assertCanRead(ctx);
    const now = opts.now ?? new Date();

    return runInTenantContext(ctx, async (db) => {
        const loc = await db.location.findFirst({
            where: { id: locationId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true },
        });
        if (!loc) return null;

        const rows = (await db.weatherObservation.findMany({
            where: { tenantId: ctx.tenantId, locationId },
            orderBy: { obsDate: 'asc' },
            select: {
                obsDate: true,
                tempMaxC: true,
                tempMinC: true,
                tempMeanC: true,
                precipMm: true,
                windMaxKmh: true,
                humidityMean: true,
                hourlyJson: true,
                utcOffsetSeconds: true,
                source: true,
            },
            // The job stores past_days=7 + forecast_days=2; 30 is generous
            // headroom so a chart shows a couple of weeks if present.
            take: 30,
        })) as unknown as WeatherRow[];

        const base = {
            locationId: loc.id,
            locationName: loc.name,
            source: rows[0]?.source ?? 'open-meteo',
        };

        if (rows.length === 0) {
            return { ...base, current: null, daily: [], sprayWindow: null, hasForecast: false };
        }

        const daily = rows.map(toDailyWeather);

        // Location-local "now" — server UTC shifted by the stored offset, then
        // UTC getters read the location-local clock (mirrors smart-defaults).
        const offsetSec = rows.find((r) => r.utcOffsetSeconds != null)?.utcOffsetSeconds ?? 0;
        const localNow = new Date(now.getTime() + offsetSec * 1000);
        const localHour = localNow.getUTCHours();
        const localDate = dayKey(localNow);

        // "Today" = the row on the location-local calendar date; else the latest
        // row (so the headline still shows). Rows are ascending → last is latest.
        const todayRow = rows.find((r) => dayKey(r.obsDate) === localDate) ?? rows[rows.length - 1];
        const isToday = dayKey(todayRow.obsDate) === localDate;

        const { status, reasonCodes } = evaluateSprayWindow({
            windMaxKmh: toNumberOrNull(todayRow.windMaxKmh),
            precipMm: toNumberOrNull(todayRow.precipMm),
            tempMeanC: toNumberOrNull(todayRow.tempMeanC),
        });

        // Only clip to "now" when the row is genuinely today's — a fallback
        // (no data for today) keeps its morning hours.
        const windows = computeSprayWindows(
            parseHourly(todayRow.hourlyJson),
            DEFAULT_SPRAY_THRESHOLDS,
            isToday ? { fromHour: localHour } : {},
        );

        const hasForecast = rows.some((r) => dayKey(r.obsDate) > dayKey(todayRow.obsDate));

        return {
            ...base,
            current: toDailyWeather(todayRow),
            daily,
            sprayWindow: {
                status,
                reasonCodes,
                obsDate: todayRow.obsDate.toISOString(),
                windows,
            },
            hasForecast,
        };
    });
}
