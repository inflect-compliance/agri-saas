import { Prisma } from '@prisma/client';
import { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { assertCanRead } from '../policies/common';

/**
 * Season recap — the "Year on the farm" read-model.
 *
 * A THIN, READ-ONLY aggregation across the ag domain that powers both the
 * dashboard recap card (`GET .../reports/season-recap`) and the
 * "Year on the farm" PDF. Authorises via `assertCanRead` at the boundary;
 * every query runs inside `runInTenantContext` (RLS-bound) AND carries an
 * explicit `tenantId` filter (defence in depth). All reads are bounded
 * (`take:`) and there is NO N+1 — each model is read at most once, with the
 * per-location rollup done in memory.
 *
 * ## Scope resolution
 *   - `seasonId` given      → that season (404-tolerant: if it doesn't
 *                             exist for the tenant we degrade to all-time).
 *   - else                  → the most recent Season (year desc, then
 *                             startDate desc).
 *   - else (no seasons)     → ALL-TIME (`seasonId = null`,
 *                             `seasonName = null`, `year = null`).
 *
 * When a season IS in scope, `YieldRecord` rows are filtered by the
 * `seasonId` FK and `LogEntry` rows by `occurredAt` within
 * `[season.startDate, season.endDate]` — `LogEntry` has no `seasonId`
 * column, so its date window is the only honest season boundary.
 *
 * ## Field-name reconciliation (vs. the original spec)
 *   - `Location` has NO `areaHa` column. Hectarage lives on `Parcel.areaHa`
 *     (a Location has many Parcels). `totalAreaHa` therefore SUMs
 *     `Parcel.areaHa` for the in-scope locations (the locations that
 *     produced yield in scope), falling back to ALL tenant parcels when
 *     there is no season scoping.
 *   - `LogEntry` has no direct `locationId` / `seasonId` — activity scope
 *     is the `occurredAt` window only.
 */

/** A bounded cap on every list read — generous for a single farm-year. */
const RECAP_TAKE = 5000;
/** Top-N fields surfaced in the recap. */
const TOP_FIELDS = 3;

/** Prisma Decimal | null → plain number | null. */
function dec(v: Prisma.Decimal | null | undefined): number | null {
    if (v == null) return null;
    return typeof v === 'number' ? v : Number(v.toString());
}

function round4(n: number): number {
    return Math.round(n * 1e4) / 1e4;
}

export interface RecapTopField {
    locationId: string;
    name: string;
    yieldTonnes: number;
    areaHa: number | null;
    tPerHa: number | null;
}

export interface SeasonRecap {
    seasonId: string | null;
    seasonName: string | null; // null when all-time
    year: number | null;
    totalAreaHa: number; // SUM of in-scope Parcel.areaHa (all tenant parcels when unscoped)
    totalYieldTonnes: number; // SUM YieldRecord.grossTonnes in scope
    avgYieldTPerHa: number | null; // totalYieldTonnes / totalAreaHa (null if area 0)
    costPerHa: number | null; // SUM(LogEntry.costAmount in scope) / totalAreaHa; null if NO costAmount rows
    topFields: RecapTopField[]; // top 3 locations by yieldTonnes desc
    activityCount: number; // count of in-scope LogEntry
}

export async function getSeasonRecap(
    ctx: RequestContext,
    seasonId?: string,
): Promise<SeasonRecap> {
    assertCanRead(ctx);

    return runInTenantContext(ctx, async (db) => {
        // ─── Resolve scope ───────────────────────────────────────────
        let season: { id: string; name: string; year: number | null; startDate: Date; endDate: Date } | null = null;

        if (seasonId) {
            season = await db.season.findFirst({
                where: { id: seasonId, tenantId: ctx.tenantId, deletedAt: null },
                select: { id: true, name: true, year: true, startDate: true, endDate: true },
            });
        } else {
            const recent = await db.season.findMany({
                where: { tenantId: ctx.tenantId, deletedAt: null },
                orderBy: [{ year: 'desc' }, { startDate: 'desc' }],
                select: { id: true, name: true, year: true, startDate: true, endDate: true },
                take: 1,
            });
            season = recent[0] ?? null;
        }

        const scoped = season != null;

        // ─── Yield records in scope ──────────────────────────────────
        const yieldRows = await db.yieldRecord.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                ...(scoped ? { seasonId: season!.id } : {}),
            },
            select: { locationId: true, grossTonnes: true },
            take: RECAP_TAKE,
        });

        let totalYieldTonnes = 0;
        // Per-location yield rollup (in-memory; no N+1).
        const yieldByLocation = new Map<string, number>();
        for (const row of yieldRows) {
            const t = dec(row.grossTonnes) ?? 0;
            totalYieldTonnes += t;
            if (row.locationId) {
                yieldByLocation.set(row.locationId, (yieldByLocation.get(row.locationId) ?? 0) + t);
            }
        }
        totalYieldTonnes = round4(totalYieldTonnes);

        const inScopeLocationIds = [...yieldByLocation.keys()];

        // ─── Area (Parcel.areaHa) ────────────────────────────────────
        // Scoped → only parcels under the locations that produced yield
        //   (skip the read entirely when no in-scope location produced yield).
        // Unscoped (all-time) → ALL tenant parcels.
        let totalAreaHa = 0;
        const areaByLocation = new Map<string, number>();
        const skipParcels = scoped && inScopeLocationIds.length === 0;
        if (!skipParcels) {
            const parcelRows = await db.parcel.findMany({
                where: {
                    tenantId: ctx.tenantId,
                    deletedAt: null,
                    ...(scoped ? { locationId: { in: inScopeLocationIds } } : {}),
                },
                select: { locationId: true, areaHa: true },
                take: RECAP_TAKE,
            });
            for (const row of parcelRows) {
                const a = dec(row.areaHa) ?? 0;
                totalAreaHa += a;
                areaByLocation.set(row.locationId, (areaByLocation.get(row.locationId) ?? 0) + a);
            }
        }
        totalAreaHa = round4(totalAreaHa);

        const avgYieldTPerHa = totalAreaHa > 0 ? round4(totalYieldTonnes / totalAreaHa) : null;

        // ─── Activity + cost (LogEntry) ──────────────────────────────
        // No seasonId/locationId on LogEntry — scope by occurredAt window.
        const logWhere: Prisma.LogEntryWhereInput = {
            tenantId: ctx.tenantId,
            deletedAt: null,
            ...(scoped ? { occurredAt: { gte: season!.startDate, lte: season!.endDate } } : {}),
        };

        const [activityCount, costAgg] = await Promise.all([
            db.logEntry.count({ where: logWhere }),
            // costAmount is OPTIONAL — _sum is null when no row has a value,
            // and _count counts only rows where costAmount is non-null.
            db.logEntry.aggregate({
                where: { ...logWhere, costAmount: { not: null } },
                _sum: { costAmount: true },
                _count: { costAmount: true },
            }),
        ]);

        const costRowCount = costAgg._count.costAmount;
        const costSum = dec(costAgg._sum.costAmount);
        // costPerHa is null when there is NO costAmount signal at all
        // (honest — it's the only cost data we have), or when area is 0.
        const costPerHa =
            costRowCount > 0 && costSum != null && totalAreaHa > 0
                ? round4(costSum / totalAreaHa)
                : null;

        // ─── Top fields (names from one bounded Location read) ───────
        const topLocationIds = [...yieldByLocation.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_FIELDS)
            .map(([id]) => id);

        const locationNames = new Map<string, string>();
        if (topLocationIds.length > 0) {
            const locs = await db.location.findMany({
                where: { id: { in: topLocationIds }, tenantId: ctx.tenantId, deletedAt: null },
                select: { id: true, name: true },
                take: TOP_FIELDS,
            });
            for (const l of locs) locationNames.set(l.id, l.name);
        }

        const topFields: RecapTopField[] = topLocationIds.map((id) => {
            const yieldTonnes = round4(yieldByLocation.get(id) ?? 0);
            const areaHa = areaByLocation.has(id) ? round4(areaByLocation.get(id)!) : null;
            const tPerHa = areaHa != null && areaHa > 0 ? round4(yieldTonnes / areaHa) : null;
            return {
                locationId: id,
                name: locationNames.get(id) ?? id,
                yieldTonnes,
                areaHa,
                tPerHa,
            };
        });

        return {
            seasonId: season?.id ?? null,
            seasonName: season?.name ?? null,
            year: season?.year ?? null,
            totalAreaHa,
            totalYieldTonnes,
            avgYieldTPerHa,
            costPerHa,
            topFields,
            activityCount,
        };
    });
}
