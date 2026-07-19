'use client';

/**
 * RentRollCard — the land-obligation summary (roadmap 3/3): leased area, rent
 * per season, and contracts expiring soon, with CSV/PDF export. Tenant-wide by
 * default (the Rent page); pass a `locationId` to scope it to one location.
 *
 * Presentational: the parent (RentClient) owns the `/reports/rent-roll` SWR and
 * passes `data` down, so a create/edit/delete/pull-to-refresh revalidation on
 * the parent refreshes these KPIs too. `hasLeases` distinguishes the true
 * no-data case (tenant has no leases → render nothing) from "leases exist but
 * none are active" (→ a zero-state, so the card doesn't vanish once the first
 * lease lapses).
 */
import { useTranslations } from 'next-intl';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { leaseExpiryTier, LEASE_EXPIRY_TONE } from '@/lib/agro/lease-expiry';

export interface RentRollData {
    totalLeasedDca: number;
    totalRent: number;
    activeLeaseCount: number;
    lessorCount: number;
    expiringSoon: Array<{
        leaseId: string;
        parcelName: string;
        lessorName: string;
        kind: 'ARENDA' | 'NAEM';
        endDate: string;
        daysLeft: number;
    }>;
}

const num = (n: number) => new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 2 }).format(n);

export function RentRollCard({
    locationId,
    data,
    hasLeases,
}: {
    locationId?: string;
    data: RentRollData | undefined;
    hasLeases: boolean;
}) {
    const t = useTranslations('ag.rentRoll');
    const buildUrl = useTenantApiUrl();
    const scope = locationId ? `?locationId=${locationId}` : '';

    // Loading / not fetched yet → nothing.
    if (!data) return null;

    // Zero-state: leases exist but none are active (all expired). Reserve `null`
    // for the genuine no-data case (no leases at all).
    if (data.activeLeaseCount === 0) {
        if (!hasLeases) return null;
        return (
            <div className="space-y-default rounded-lg border border-border-subtle bg-bg-default p-4">
                <Heading level={3}>{t('title')}</Heading>
                <p className="text-sm text-content-secondary">{t('noActive')}</p>
            </div>
        );
    }

    const exportUrl = (fmt: 'csv' | 'pdf') =>
        buildUrl(`/reports/rent-roll${scope}${scope ? '&' : '?'}format=${fmt}`);

    return (
        <div className="space-y-default rounded-lg border border-border-subtle bg-bg-default p-4">
            <div className="flex items-center justify-between gap-default">
                <Heading level={3}>{t('title')}</Heading>
                <div className="flex items-center gap-default text-sm">
                    <a href={exportUrl('csv')} className="text-brand hover:underline">CSV</a>
                    <a href={exportUrl('pdf')} className="text-brand hover:underline">PDF</a>
                </div>
            </div>

            <dl className="grid grid-cols-2 gap-default text-sm sm:grid-cols-4">
                <div>
                    <dt className="text-content-secondary">{t('leasedArea')}</dt>
                    <dd className="font-medium tabular-nums">{num(data.totalLeasedDca)} дка</dd>
                </div>
                <div>
                    <dt className="text-content-secondary">{t('lessors')}</dt>
                    <dd className="font-medium tabular-nums">{data.lessorCount}</dd>
                </div>
                <div>
                    <dt className="text-content-secondary">{t('leases')}</dt>
                    <dd className="font-medium tabular-nums">{data.activeLeaseCount}</dd>
                </div>
                <div>
                    <dt className="text-content-secondary">{t('rentSeason')}</dt>
                    <dd className="font-medium tabular-nums">{num(data.totalRent)} лв</dd>
                </div>
            </dl>

            {data.expiringSoon.length > 0 ? (
                <div>
                    <p className="mb-1 text-sm font-medium text-content-emphasis">{t('expiring')}</p>
                    <ul className="space-y-tight">
                        {data.expiringSoon.slice(0, 5).map((e) => (
                            <li key={e.leaseId} className="flex items-center justify-between gap-default text-sm">
                                <span className="min-w-0 truncate">
                                    {e.parcelName} · {e.lessorName}
                                </span>
                                <StatusBadge variant={LEASE_EXPIRY_TONE[leaseExpiryTier(e.daysLeft)]}>
                                    {t('daysLeft', { days: e.daysLeft })}
                                </StatusBadge>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

export default RentRollCard;
