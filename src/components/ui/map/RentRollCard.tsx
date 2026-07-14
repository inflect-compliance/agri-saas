'use client';

/**
 * RentRollCard — the location's land-obligation summary (roadmap 3/3): leased
 * area, rent per season, and contracts expiring soon, with CSV/PDF export.
 * Scoped to one location (tenant-wide is the same endpoint without locationId).
 * Renders nothing when the location has no active leases.
 */
import { useTranslations } from 'next-intl';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { StatusBadge } from '@/components/ui/status-badge';

interface RentRollData {
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

export function RentRollCard({ locationId }: { locationId: string }) {
    const t = useTranslations('ag.rentRoll');
    const buildUrl = useTenantApiUrl();
    const q = useTenantSWR<RentRollData>(`/reports/rent-roll?locationId=${locationId}`);
    const data = q.data;
    if (!data || data.activeLeaseCount === 0) return null;

    const exportUrl = (fmt: 'csv' | 'pdf') =>
        buildUrl(`/reports/rent-roll?locationId=${locationId}&format=${fmt}`);

    return (
        <div className="space-y-default rounded-lg border border-border-subtle bg-bg-default p-4">
            <div className="flex items-center justify-between gap-default">
                <h3 className="font-medium text-content-emphasis">{t('title')}</h3>
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
                                <StatusBadge variant={e.daysLeft <= 14 ? 'error' : 'warning'}>
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
