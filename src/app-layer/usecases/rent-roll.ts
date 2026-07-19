/**
 * Rent roll & obligations (roadmap 3/3) — the tenant-wide aggregation over the
 * parcel lease register: how much land is leased, the rent due per lessor, and
 * which contracts are expiring soon. Rent is per DECARE, so a lease's seasonal
 * rent = rentAmount × (parcel areaHa × 10). Read-only; the daily
 * `lease-expiry-sweep` job reuses the expiry query for notifications.
 *
 * Raw SQL (RLS-scoped via runInTenantContext, with an explicit tenant barrier)
 * — the join + area math + GROUP BY don't fit a Prisma findMany, and staying in
 * SQL keeps it a single round-trip.
 */
import { Prisma } from '@prisma/client';
import type { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { REPORT_DAYS } from '@/lib/agro/lease-expiry';

export interface RentRollLessor {
    lessorName: string;
    lessorEik: string | null;
    leaseCount: number;
    leasedDca: number;
    /** Seasonal rent total (Σ rentAmount × dca), or null when no lease priced. */
    rentTotal: number | null;
    /** Rent unit of the lessor's most recent lease (лв/дка …), or null. */
    rentUnit: string | null;
}

export interface RentRollExpiring {
    leaseId: string;
    parcelId: string;
    parcelName: string;
    lessorName: string;
    kind: 'ARENDA' | 'NAEM';
    endDate: string;
    daysLeft: number;
}

export interface RentRoll {
    totalLeasedDca: number;
    totalRent: number;
    activeLeaseCount: number;
    lessorCount: number;
    byLessor: RentRollLessor[];
    expiringSoon: RentRollExpiring[];
}

// The roll's "expiring soon" horizon is the shared REPORT window (90d).
const DEFAULT_EXPIRING_WITHIN_DAYS = REPORT_DAYS;

export async function getRentRoll(
    ctx: RequestContext,
    opts: { expiringWithinDays?: number; locationId?: string } = {},
): Promise<RentRoll> {
    assertCanRead(ctx);
    const withinDays = opts.expiringWithinDays ?? DEFAULT_EXPIRING_WITHIN_DAYS;
    // Optional scope to one location (the location-overview card); tenant-wide otherwise.
    const locFilter = opts.locationId
        ? Prisma.sql`AND "p"."locationId" = ${opts.locationId}`
        : Prisma.empty;

    return runInTenantContext(ctx, async (db) => {
        const byLessorRows = await db.$queryRaw<
            Array<{
                lessorName: string;
                lessorEik: string | null;
                leaseCount: number;
                leasedDca: number | null;
                rentTotal: number | null;
                rentUnit: string | null;
                hasRent: boolean;
            }>
        >(Prisma.sql`
            SELECT "pl"."lessorName",
                   "pl"."lessorEik",
                   count(*)::int AS "leaseCount",
                   sum("p"."areaHa" * 10)::float8 AS "leasedDca",
                   sum(COALESCE("pl"."rentAmount", 0) * "p"."areaHa" * 10)::float8 AS "rentTotal",
                   (array_agg("pl"."rentUnit" ORDER BY "pl"."createdAt" DESC))[1] AS "rentUnit",
                   bool_or("pl"."rentAmount" IS NOT NULL) AS "hasRent"
            FROM "ParcelLease" "pl"
            JOIN "Parcel" "p"
              ON "p"."id" = "pl"."parcelId" AND "p"."tenantId" = "pl"."tenantId"
             AND "p"."deletedAt" IS NULL
            WHERE "pl"."tenantId" = ${ctx.tenantId}
              AND "pl"."deletedAt" IS NULL
              AND ("pl"."endDate" IS NULL OR "pl"."endDate" >= now())
              ${locFilter}
            GROUP BY "pl"."lessorName", "pl"."lessorEik"
            ORDER BY "rentTotal" DESC NULLS LAST, "leasedDca" DESC NULLS LAST
        `);

        const expiringRows = await db.$queryRaw<
            Array<{
                leaseId: string;
                parcelId: string;
                parcelName: string;
                lessorName: string;
                kind: 'ARENDA' | 'NAEM';
                endDate: Date;
                daysLeft: number;
            }>
        >(Prisma.sql`
            SELECT "pl"."id" AS "leaseId",
                   "pl"."parcelId",
                   "p"."name" AS "parcelName",
                   "pl"."lessorName",
                   "pl"."kind",
                   "pl"."endDate",
                   ("pl"."endDate"::date - now()::date)::int AS "daysLeft"
            FROM "ParcelLease" "pl"
            JOIN "Parcel" "p"
              ON "p"."id" = "pl"."parcelId" AND "p"."tenantId" = "pl"."tenantId"
             AND "p"."deletedAt" IS NULL
            WHERE "pl"."tenantId" = ${ctx.tenantId}
              AND "pl"."deletedAt" IS NULL
              AND "pl"."endDate" IS NOT NULL
              AND "pl"."endDate" >= now()
              AND "pl"."endDate" <= now() + make_interval(days => ${withinDays})
              ${locFilter}
            ORDER BY "pl"."endDate" ASC
            LIMIT 200
        `);

        const byLessor: RentRollLessor[] = byLessorRows.map((r) => ({
            lessorName: r.lessorName,
            lessorEik: r.lessorEik,
            leaseCount: Number(r.leaseCount),
            leasedDca: r.leasedDca != null ? Number(r.leasedDca) : 0,
            rentTotal: r.hasRent && r.rentTotal != null ? Number(r.rentTotal) : null,
            rentUnit: r.rentUnit,
        }));

        return {
            totalLeasedDca: byLessor.reduce((s, l) => s + l.leasedDca, 0),
            totalRent: byLessor.reduce((s, l) => s + (l.rentTotal ?? 0), 0),
            activeLeaseCount: byLessor.reduce((s, l) => s + l.leaseCount, 0),
            lessorCount: byLessor.length,
            byLessor,
            expiringSoon: expiringRows.map((r) => ({
                leaseId: r.leaseId,
                parcelId: r.parcelId,
                parcelName: r.parcelName,
                lessorName: r.lessorName,
                kind: r.kind,
                endDate: r.endDate.toISOString().slice(0, 10),
                daysLeft: Number(r.daysLeft),
            })),
        };
    });
}
