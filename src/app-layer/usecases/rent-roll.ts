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
    /** True when the lease set hit the cap — totals cover the first N only. */
    truncated: boolean;
    /** The cap that applied, so surfaces can say "showing the first N". */
    leaseCap: number;
    byLessor: RentRollLessor[];
    expiringSoon: RentRollExpiring[];
}

// The roll's "expiring soon" horizon is the shared REPORT window (90d).
const DEFAULT_EXPIRING_WITHIN_DAYS = REPORT_DAYS;

/**
 * Correctness bound for the roll. Aggregation happens in this layer (the
 * lessor columns are encrypted, so SQL can't group them), which means a
 * truncated fetch would silently under-report totals. We read one past this
 * cap; going over sets `truncated` so every surface can say so out loud.
 */
export const ROLL_LEASE_CAP = 2000;

export async function getRentRoll(
    ctx: RequestContext,
    opts: { expiringWithinDays?: number; locationId?: string; seasonYear?: number } = {},
): Promise<RentRoll> {
    assertCanRead(ctx);
    const withinDays = opts.expiringWithinDays ?? DEFAULT_EXPIRING_WITHIN_DAYS;
    const seasonYear = opts.seasonYear ?? new Date().getUTCFullYear();

    return runInTenantContext(ctx, async (db) => {
        // ── Why this is NOT raw SQL ───────────────────────────────────────
        // `lessorName` / `lessorEik` are encrypted at rest (Epic B manifest).
        // Raw SQL bypasses the decryption extension, and AES-GCM is
        // randomised — two leases from the same landlord yield DIFFERENT
        // ciphertexts, so `GROUP BY "lessorName"` would emit one group per
        // lease instead of one per landlord. The grouping therefore happens
        // here, over rows Prisma has decrypted.
        //
        // That makes the fetch bound a CORRECTNESS bound, not just a page
        // size: aggregating a truncated set would silently under-report the
        // totals. We read one row past the cap so truncation is detectable,
        // and report it rather than quietly lying.
        const rows = await db.parcelLease.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
                parcel: {
                    deletedAt: null,
                    ...(opts.locationId ? { locationId: opts.locationId } : {}),
                },
            },
            select: {
                lessorName: true,
                lessorEik: true,
                rentUnit: true,
                rentAmount: true,
                parcel: { select: { areaHa: true } },
                payments: {
                    where: { deletedAt: null, seasonYear },
                    select: { amountPaid: true },
                },
            },
            take: ROLL_LEASE_CAP + 1,
        });
        const truncated = rows.length > ROLL_LEASE_CAP;
        const leases = truncated ? rows.slice(0, ROLL_LEASE_CAP) : rows;

        // Aggregate per (lessor × unit) — each lease has exactly one unit, so
        // the groups partition the leases and summing across them never
        // double-counts area or lease counts.
        interface Acc {
            lessorName: string;
            lessorEik: string | null;
            rentUnit: string | null;
            leaseCount: number;
            leasedDca: number;
            rentTotal: number;
            hasRent: boolean;
            paid: number;
        }
        const groups = new Map<string, Acc>();
        for (const l of leases) {
            const dca = Number(l.parcel?.areaHa ?? 0) * 10;
            const amount = l.rentAmount != null ? Number(l.rentAmount) : null;
            const paid = l.payments.reduce((s, p) => s + Number(p.amountPaid), 0);
            const key = `${l.lessorName}\u0000${l.lessorEik ?? ''}\u0000${l.rentUnit ?? ''}`;
            const acc = groups.get(key) ?? {
                lessorName: l.lessorName,
                lessorEik: l.lessorEik,
                rentUnit: l.rentUnit,
                leaseCount: 0,
                leasedDca: 0,
                rentTotal: 0,
                hasRent: false,
                paid: 0,
            };
            acc.leaseCount += 1;
            acc.leasedDca += dca;
            acc.rentTotal += (amount ?? 0) * dca;
            acc.hasRent = acc.hasRent || amount != null;
            acc.paid += paid;
            groups.set(key, acc);
        }

        const byLessor: RentRollLessor[] = [...groups.values()]
            .map((g) => {
                const rentTotal = g.hasRent ? g.rentTotal : null;
                return {
                    lessorName: g.lessorName,
                    lessorEik: g.lessorEik,
                    rentUnit: g.rentUnit,
                    leaseCount: g.leaseCount,
                    leasedDca: g.leasedDca,
                    rentTotal,
                    paid: g.paid,
                    outstanding: (rentTotal ?? 0) - g.paid,
                };
            })
            .sort(
                (a, b) =>
                    a.lessorName.localeCompare(b.lessorName, 'bg') ||
                    (a.rentUnit ?? '').localeCompare(b.rentUnit ?? '', 'bg'),
            );

        // Season totals per unit — money and produce are never summed together.
        const totalsByUnit = new Map<string, RentRollUnitTotal>();
        for (const l of byLessor) {
            const key = l.rentUnit ?? '';
            const acc = totalsByUnit.get(key) ?? { unit: l.rentUnit, total: 0, paid: 0, outstanding: 0 };
            acc.total += l.rentTotal ?? 0;
            acc.paid += l.paid;
            acc.outstanding += l.outstanding;
            totalsByUnit.set(key, acc);
        }
        const totals = [...totalsByUnit.values()].filter((t) => t.total !== 0 || t.paid !== 0);

        // Expiring contracts — also Prisma (it selects the encrypted lessor).
        const now = new Date();
        const windowEnd = new Date(now.getTime() + withinDays * 86_400_000);
        const expiringRows = await db.parcelLease.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                endDate: { gte: now, lte: windowEnd },
                parcel: {
                    deletedAt: null,
                    ...(opts.locationId ? { locationId: opts.locationId } : {}),
                },
            },
            select: {
                id: true,
                parcelId: true,
                lessorName: true,
                kind: true,
                endDate: true,
                parcel: { select: { name: true } },
            },
            orderBy: { endDate: 'asc' },
            take: 200,
        });

        return {
            totalLeasedDca: byLessor.reduce((s, l) => s + l.leasedDca, 0),
            totals,
            activeLeaseCount: byLessor.reduce((s, l) => s + l.leaseCount, 0),
            // Groups are per (lessor × unit) — count DISTINCT lessors.
            lessorCount: new Set(byLessor.map((l) => `${l.lessorName}\u0000${l.lessorEik ?? ''}`)).size,
            seasonYear,
            truncated,
            leaseCap: ROLL_LEASE_CAP,
            byLessor,
            expiringSoon: expiringRows.map((r) => ({
                leaseId: r.id,
                parcelId: r.parcelId,
                parcelName: r.parcel?.name ?? '',
                lessorName: r.lessorName,
                kind: r.kind as 'ARENDA' | 'NAEM',
                endDate: r.endDate!.toISOString().slice(0, 10),
                daysLeft: Math.ceil((r.endDate!.getTime() - now.getTime()) / 86_400_000),
            })),
        };
    });
}
