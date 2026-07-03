'use client';

/**
 * "My interests" — the buyer's outbox: inquiries this tenant has sent, with
 * the target listing and the seller's response status. Read-only.
 */
import { ListPageShell } from '@/components/layout/ListPageShell';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { Heading } from '@/components/ui/typography';
import { StatusBadge } from '@/components/ui/status-badge';
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
    const tenantHref = useTenantHref();
    const { data, isLoading } = useTenantSWR<ExchangePublicInquiry[]>('/exchange/inquiries');
    const inquiries = data ?? [];

    return (
        <ListPageShell>
            <ListPageShell.Header>
                <PageBreadcrumbs
                    items={[
                        { label: 'Dashboard', href: tenantHref('/dashboard') },
                        { label: 'Exchange', href: tenantHref('/exchange') },
                        { label: 'My interests' },
                    ]}
                    className="mb-1"
                />
                <Heading level={1}>My interests</Heading>
                <ExchangeNav />
            </ListPageShell.Header>
            <ListPageShell.Body>
                <div className="min-h-0 flex-1 space-y-default overflow-y-auto pr-1">
                    {isLoading && <p className="text-sm text-content-muted">Loading…</p>}
                    {!isLoading && inquiries.length === 0 && (
                        <div className="rounded-lg border border-border-subtle p-4 text-sm text-content-muted">
                            You haven&apos;t expressed interest in any offers yet.
                        </div>
                    )}
                    {inquiries.map((iq) => (
                        <div key={iq.id} className="space-y-tight rounded-lg border border-border-subtle p-4">
                            <div className="flex flex-wrap items-center gap-compact">
                                {iq.listing && (
                                    <span className="font-medium text-content-emphasis">{iq.listing.commodity}</span>
                                )}
                                {iq.listing && (
                                    <span className="text-xs text-content-muted">
                                        {iq.listing.side === 'SELL' ? 'Selling' : 'Buying'} · {iq.listing.regionName}
                                    </span>
                                )}
                                <StatusBadge variant={statusVariant(iq.status)}>{iq.status}</StatusBadge>
                            </div>
                            <p className="text-sm text-content-secondary">{iq.message}</p>
                            {iq.quantityTonnes && (
                                <p className="text-xs text-content-muted">Quantity of interest: {iq.quantityTonnes} t</p>
                            )}
                        </div>
                    ))}
                </div>
            </ListPageShell.Body>
        </ListPageShell>
    );
}
