'use client';

/**
 * "My interests" — the buyer's outbox: inquiries this tenant has sent, with
 * the target listing and the seller's response status. Read-only.
 */
import { useTranslations } from 'next-intl';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { Heading } from '@/components/ui/typography';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { ExchangePublicInquiry } from '@/lib/exchange/public-listing';
import { ExchangeNav } from '../ExchangeNav';

function statusVariant(status: string): 'success' | 'neutral' | 'warning' {
    if (status === 'ACCEPTED') return 'success';
    if (status === 'PENDING') return 'warning';
    return 'neutral';
}

export function MyInterestsClient() {
    const t = useTranslations('exchange.myInterests');
    const tenantHref = useTenantHref();
    const { data, isLoading, error, mutate } = useTenantSWR<ExchangePublicInquiry[]>('/exchange/inquiries');
    const inquiries = data ?? [];

    return (
        <ListPageShell>
            <ListPageShell.Header>
                <PageBreadcrumbs
                    items={[
                        { label: t('breadcrumbDashboard'), href: tenantHref('/dashboard') },
                        { label: t('breadcrumbExchange'), href: tenantHref('/exchange') },
                        { label: t('breadcrumbCurrent') },
                    ]}
                    className="mb-1"
                />
                <Heading level={1}>{t('heading')}</Heading>
                <ExchangeNav />
            </ListPageShell.Header>
            <ListPageShell.Body>
                <div className="min-h-0 flex-1 space-y-default overflow-y-auto pr-1">
                    {error ? (
                        <ErrorState
                            description={t('loadError')}
                            onRetry={() => { void mutate(); }}
                        />
                    ) : isLoading ? (
                        <div className="space-y-default" aria-busy="true">
                            {[0, 1, 2].map((i) => (
                                <Skeleton key={i} className="h-24 w-full rounded-lg" />
                            ))}
                        </div>
                    ) : inquiries.length === 0 ? (
                        <div className="rounded-lg border border-border-subtle p-4 text-sm text-content-muted">
                            {t('empty')}
                        </div>
                    ) : (
                    inquiries.map((iq) => (
                        <div key={iq.id} className="space-y-tight rounded-lg border border-border-subtle p-4">
                            <div className="flex flex-wrap items-center gap-compact">
                                {iq.listing && (
                                    <span className="font-medium text-content-emphasis">{iq.listing.commodity}</span>
                                )}
                                {iq.listing && (
                                    <span className="text-xs text-content-muted">
                                        {iq.listing.side === 'SELL' ? t('selling') : t('buying')} · {iq.listing.regionName}
                                    </span>
                                )}
                                <StatusBadge variant={statusVariant(iq.status)}>{iq.status}</StatusBadge>
                            </div>
                            <p className="text-sm text-content-secondary">{iq.message}</p>
                            {iq.quantityTonnes && (
                                <p className="text-xs text-content-muted">{t('quantityOfInterest', { qty: iq.quantityTonnes })}</p>
                            )}
                        </div>
                    )))}
                </div>
            </ListPageShell.Body>
        </ListPageShell>
    );
}
