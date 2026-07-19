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
    /**
     * The unit THIS row is denominated in. Rows are per (lessor × unit), so a
     * lessor renting some parcels in лв/дка and others in кг/дка gets one row
     * each — never a blended number stamped with one unit.
     */
    rentUnit: string | null;
    leaseCount: number;
    leasedDca: number;
    /** Seasonal rent total (Σ rentAmount × dca), or null when no lease priced. */
    rentTotal: number | null;
    /** Paid against this lessor+unit for the season (0 when nothing recorded). */
    paid: number;
    /** rentTotal − paid. Negative means overpaid. */
    outstanding: number;
}

/** A season total for ONE unit — the roll never sums across units. */
export interface RentRollUnitTotal {
    unit: string | null;
    total: number;
    paid: number;
    outstanding: number;
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
    /** Season totals PER UNIT — replaces the old dimensionless `totalRent`. */
    totals: RentRollUnitTotal[];
    activeLeaseCount: number;
    lessorCount: number;
    /** The season the `paid` / `outstanding` figures settle. */
    seasonYear: number;
    byLessor: RentRollLessor[];
    expiringSoon: RentRollExpiring[];
}

// The roll's "expiring soon" horizon is the shared REPORT window (90d).
const DEFAULT_EXPIRING_WITHIN_DAYS = REPORT_DAYS;

export async function getRentRoll(
    ctx: RequestContext,
    opts: { expiringWithinDays?: number; locationId?: string; seasonYear?: number } = {},
): Promise<RentRoll> {
    assertCanRead(ctx);
    const withinDays = opts.expiringWithinDays ?? DEFAULT_EXPIRING_WITHIN_DAYS;
    const seasonYear = opts.seasonYear ?? new Date().getUTCFullYear();
    // Optional scope to one location (the location-overview card); tenant-wide otherwise.
    const locFilter = opts.locationId
        ? Prisma.sql`AND "p"."locationId" = ${opts.locationId}`
        : Prisma.empty;

    return runInTenantContext(ctx, async (db) => {
        // Grouped by (lessor × unit) so every row is dimensionally homogeneous.
        // Payments for the season are folded in per lease via a LEFT JOIN so a
        // lessor's row carries what was actually settled.
        const byLessorRows = await db.$queryRaw<
            Array<{
                lessorName: string;
                lessorEik: string | null;
                rentUnit: string | null;
                leaseCount: number;
                leasedDca: number | null;
                rentTotal: number | null;
                paid: number | null;
                hasRent: boolean;
            }>
        >(Prisma.sql`
            SELECT "pl"."lessorName",
                   "pl"."lessorEik",
                   "pl"."rentUnit",
                   count(*)::int AS "leaseCount",
                   sum("p"."areaHa" * 10)::float8 AS "leasedDca",
                   sum(COALESCE("pl"."rentAmount", 0) * "p"."areaHa" * 10)::float8 AS "rentTotal",
                   COALESCE(sum("pay"."paid"), 0)::float8 AS "paid",
                   bool_or("pl"."rentAmount" IS NOT NULL) AS "hasRent"
            FROM "ParcelLease" "pl"
            JOIN "Parcel" "p"
              ON "p"."id" = "pl"."parcelId" AND "p"."tenantId" = "pl"."tenantId"
             AND "p"."deletedAt" IS NULL
            LEFT JOIN (
                SELECT "leaseId", sum("amountPaid")::float8 AS "paid"
                FROM "LeasePayment"
                WHERE "tenantId" = ${ctx.tenantId}
                  AND "deletedAt" IS NULL
                  AND "seasonYear" = ${seasonYear}
                GROUP BY "leaseId"
            ) "pay" ON "pay"."leaseId" = "pl"."id"
            WHERE "pl"."tenantId" = ${ctx.tenantId}
              AND "pl"."deletedAt" IS NULL
              AND ("pl"."endDate" IS NULL OR "pl"."endDate" >= now())
              ${locFilter}
            GROUP BY "pl"."lessorName", "pl"."lessorEik", "pl"."rentUnit"
            ORDER BY "pl"."lessorName" ASC, "pl"."rentUnit" ASC NULLS LAST
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

        const byLessor: RentRollLessor[] = byLessorRows.map((r) => {
            const rentTotal = r.hasRent && r.rentTotal != null ? Number(r.rentTotal) : null;
            const paid = r.paid != null ? Number(r.paid) : 0;
            return {
                lessorName: r.lessorName,
                lessorEik: r.lessorEik,
                rentUnit: r.rentUnit,
                leaseCount: Number(r.leaseCount),
                leasedDca: r.leasedDca != null ? Number(r.leasedDca) : 0,
                rentTotal,
                paid,
                outstanding: (rentTotal ?? 0) - paid,
            };
        });

        // Season totals per unit. Rows partition the leases (each lease has one
        // unit), so summing across rows never double-counts area or leases.
        const totalsByUnit = new Map<string, RentRollUnitTotal>();
        for (const l of byLessor) {
            const key = l.rentUnit ?? '';
            const acc = totalsByUnit.get(key) ?? { unit: l.rentUnit, total: 0, paid: 0, outstanding: 0 };
            acc.total += l.rentTotal ?? 0;
            acc.paid += l.paid;
            acc.outstanding += l.outstanding;
            totalsByUnit.set(key, acc);
        }
        // Only surface units that actually carry a priced obligation.
        const totals = [...totalsByUnit.values()].filter((t) => t.total !== 0 || t.paid !== 0);

        return {
            totalLeasedDca: byLessor.reduce((s, l) => s + l.leasedDca, 0),
            totals,
            activeLeaseCount: byLessor.reduce((s, l) => s + l.leaseCount, 0),
            // Rows are per (lessor × unit) — count DISTINCT lessors, not rows.
            lessorCount: new Set(byLessor.map((l) => `${l.lessorName} ${l.lessorEik ?? ''}`)).size,
            seasonYear,
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
