/**
 * Home-screen greeting read-model — the tiny "here's your farm right now"
 * line that sits atop the tenant dashboard. Read-only; safe on dashboard
 * load. Everything is DERIVED from existing rows (no new schema, no new
 * route — the dashboard server component calls this directly).
 *
 * Three signals:
 *   • spray readiness — how many fields' LATEST weather reading lands a
 *     GOOD spray window (vs. how many fields have any weather at all), plus
 *     a representative (median) wind speed among the counted fields.
 *   • tasks due today — the caller's farm-task queue, filtered to today.
 *
 * A pure-GRC tenant with no locations / no weather / no tasks returns
 * zeros + null gracefully — never throws.
 */
import { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { assertCanRead } from '../policies/common';
import { evaluateSprayWindow } from '@/lib/agro/rules';
import { listMyFarmTasks } from './farm-task';

export interface HomeGreeting {
    /** Tenant locations whose latest weather reading → GOOD spray window. */
    fieldsGoodToSpray: number;
    /** Locations that have ANY weather reading (the denominator). */
    fieldsWithWeather: number;
    /** Rounded median windMaxKmh among the counted fields (null if no weather). */
    representativeWindKmh: number | null;
    /** Count of the caller's farm tasks due today. */
    tasksToday: number;
}

/** Bounds — generous enough for any realistic tenant, hard ceiling for safety. */
const MAX_LOCATIONS = 500;
const MAX_OBSERVATIONS = 1000;

/** Decimal | number | null → number | null (Prisma Decimals carry .toNumber()). */
function toNum(v: unknown): number | null {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
        return (v as { toNumber: () => number }).toNumber();
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Median of a non-empty numeric list. */
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function getHomeGreeting(ctx: RequestContext): Promise<HomeGreeting> {
    assertCanRead(ctx);
    const t = ctx.tenantId;

    return runInTenantContext(ctx, async (db) => {
        // The caller's farm-task queue (already bounded + authorized in the
        // usecase). Count those whose dueAt lands in today's UTC window.
        const tasks = await listMyFarmTasks(ctx);

        const now = new Date();
        const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const endOfToday = new Date(startOfToday.getTime() + 86_400_000);
        const tasksToday = tasks.reduce((acc, task) => {
            if (!task.dueAt) return acc;
            const due = task.dueAt instanceof Date ? task.dueAt : new Date(task.dueAt);
            return due >= startOfToday && due < endOfToday ? acc + 1 : acc;
        }, 0);

        // Tenant locations — one bounded query.
        const locations = await db.location.findMany({
            where: { tenantId: t, deletedAt: null },
            select: { id: true },
            take: MAX_LOCATIONS,
        });
        const ids = locations.map((l) => l.id);

        if (ids.length === 0) {
            return { fieldsGoodToSpray: 0, fieldsWithWeather: 0, representativeWindKmh: null, tasksToday };
        }

        // ONE bounded query for recent observations across all those
        // locations (NOT one per location — N+1). obsDate-desc, so the
        // first row seen per locationId is that location's latest reading.
        const observations = await db.weatherObservation.findMany({
            where: { tenantId: t, locationId: { in: ids } },
            orderBy: { obsDate: 'desc' },
            select: { locationId: true, tempMeanC: true, precipMm: true, windMaxKmh: true },
            take: MAX_OBSERVATIONS,
        });

        // Reduce in memory to the latest obs per location (first-seen wins).
        const latestByLocation = new Map<string, (typeof observations)[number]>();
        for (const obs of observations) {
            if (!latestByLocation.has(obs.locationId)) latestByLocation.set(obs.locationId, obs);
        }

        const fieldsWithWeather = latestByLocation.size;
        let fieldsGoodToSpray = 0;
        const goodWinds: number[] = [];
        for (const obs of latestByLocation.values()) {
            const result = evaluateSprayWindow({
                windMaxKmh: toNum(obs.windMaxKmh),
                precipMm: toNum(obs.precipMm),
                tempMeanC: toNum(obs.tempMeanC),
            });
            if (result.status === 'GOOD') {
                fieldsGoodToSpray++;
                const wind = toNum(obs.windMaxKmh);
                if (wind != null) goodWinds.push(wind);
            }
        }

        const representativeWindKmh = goodWinds.length > 0 ? Math.round(median(goodWinds)) : null;

        return { fieldsGoodToSpray, fieldsWithWeather, representativeWindKmh, tasksToday };
    });
}
