'use client';

/**
 * "My listings" — the seller's management view. Each of the tenant's own
 * listings (any status) with its inquiries. Withdraw (undo-toast) / fulfill a
 * listing; accept / decline (Reject) each PENDING inquiry.
 */
import { useState } from 'react';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { Heading } from '@/components/ui/typography';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErrorState } from '@/components/ui/error-state';
import { ConfirmDialog, type ConfirmTone } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToastWithUndo } from '@/components/ui/hooks';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { apiPatch } from '@/lib/api-client';
import type { ExchangePublicListing } from '@/lib/exchange/public-listing';
import { ExchangeNav } from '../ExchangeNav';

interface MyInquiry {
    id: string;
    message: string;
    quantityTonnes: string | null;
    status: string;
    createdAt: string;
}
type MyListing = ExchangePublicListing & { inquiries: MyInquiry[] };

function statusVariant(status: string): 'success' | 'neutral' | 'info' | 'warning' {
    if (status === 'ACTIVE' || status === 'ACCEPTED') return 'success';
    if (status === 'PENDING') return 'warning';
    if (status === 'FULFILLED') return 'info';
    return 'neutral';
}

export function MyListingsClient() {
    const buildUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const triggerUndoToast = useToastWithUndo();
    const { data, isLoading, error, mutate } = useTenantSWR<MyListing[]>('/exchange/my-listings');
    const listings = data ?? [];
    const [busy, setBusy] = useState<string | null>(null);
    // A single confirm surface driven by the pending destructive action.
    const [confirm, setConfirm] = useState<
        { title: string; description: string; tone: ConfirmTone; confirmLabel: string; action: () => Promise<void> } | null
    >(null);

    const withdrawListing = (listing: MyListing) => {
        const previous = listings;
        // Optimistically flip status to WITHDRAWN.
        void mutate(
            listings.map((l) => (l.id === listing.id ? { ...l, status: 'WITHDRAWN' } : l)),
            { revalidate: false },
        );
        triggerUndoToast({
            message: 'Listing withdrawn',
            undoMessage: 'Undo',
            action: async () => {
                await apiPatch(buildUrl(`/exchange/listings/${listing.id}`), { action: 'WITHDRAWN' });
                await mutate();
            },
            undoAction: () => { void mutate(previous, { revalidate: false }); },
            onError: () => { void mutate(previous, { revalidate: false }); },
        });
    };

    async function fulfillListing(id: string) {
        setBusy(id);
        try {
            await apiPatch(buildUrl(`/exchange/listings/${id}`), { action: 'FULFILLED' });
            await mutate();
        } finally {
            setBusy(null);
        }
    }

    async function respond(inquiryId: string, action: 'ACCEPTED' | 'DECLINED') {
        setBusy(inquiryId);
        try {
            await apiPatch(buildUrl(`/exchange/inquiries/${inquiryId}`), { action });
            await mutate();
        } finally {
            setBusy(null);
        }
    }

    return (
        <>
        <ListPageShell>
            <ListPageShell.Header>
                <PageBreadcrumbs
                    items={[
                        { label: 'Dashboard', href: tenantHref('/dashboard') },
                        { label: 'Exchange', href: tenantHref('/exchange') },
                        { label: 'My listings' },
                    ]}
                    className="mb-1"
                />
                <Heading level={1}>My listings</Heading>
                <ExchangeNav />
            </ListPageShell.Header>
            <ListPageShell.Body>
                <div className="min-h-0 flex-1 space-y-default overflow-y-auto pr-1">
                    {error ? (
                        <ErrorState
                            description="We couldn't load your listings."
                            onRetry={() => { void mutate(); }}
                        />
                    ) : isLoading ? (
                        <div className="space-y-default" aria-busy="true">
                            {[0, 1, 2].map((i) => (
                                <Skeleton key={i} className="h-28 w-full rounded-lg" />
                            ))}
                        </div>
                    ) : listings.length === 0 ? (
                        <div className="rounded-lg border border-border-subtle p-4 text-sm text-content-muted">
                            You haven&apos;t posted any offers yet.
                        </div>
                    ) : (
                    listings.map((l) => (
                        <div
                            key={l.id}
                            id={`listing-${l.id}`}
                            className="space-y-default rounded-lg border border-border-subtle p-4 scroll-mt-4"
                        >
                            <div className="flex flex-wrap items-center gap-compact">
                                <span className="font-medium text-content-emphasis">{l.commodity}</span>
                                <span className="text-xs text-content-muted">{l.side === 'SELL' ? 'Selling' : 'Buying'}</span>
                                <StatusBadge variant={statusVariant(l.status)}>{l.status}</StatusBadge>
                                <span className="text-sm text-content-secondary">
                                    {l.quantityTonnes} t{l.pricePerTonne ? ` · ${l.pricePerTonne} ${l.priceCurrency}/t` : ''} · {l.regionName}
                                </span>
                                {l.status === 'ACTIVE' && (
                                    <span className="ml-auto flex gap-compact">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            loading={busy === l.id}
                                            onClick={() => setConfirm({
                                                title: 'Mark this listing fulfilled?',
                                                description: 'This hides the listing from the marketplace. Existing inquiries stay visible.',
                                                tone: 'warning',
                                                confirmLabel: 'Mark fulfilled',
                                                action: () => fulfillListing(l.id),
                                            })}
                                        >
                                            Mark fulfilled
                                        </Button>
                                        <Button variant="secondary" size="sm" onClick={() => withdrawListing(l)}>
                                            Withdraw
                                        </Button>
                                    </span>
                                )}
                            </div>

                            {l.inquiries.length > 0 ? (
                                <ul className="space-y-tight border-t border-border-subtle pt-default">
                                    {l.inquiries.map((iq) => (
                                        <li key={iq.id} className="flex flex-wrap items-center gap-compact text-sm">
                                            <StatusBadge variant={statusVariant(iq.status)}>{iq.status}</StatusBadge>
                                            {iq.quantityTonnes && <span className="text-content-muted">{iq.quantityTonnes} t</span>}
                                            <span className="text-content-secondary">{iq.message}</span>
                                            {iq.status === 'PENDING' && (
                                                <span className="ml-auto flex gap-compact">
                                                    <Button variant="secondary" size="sm" onClick={() => respond(iq.id, 'ACCEPTED')} loading={busy === iq.id}>
                                                        Accept
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        loading={busy === iq.id}
                                                        onClick={() => setConfirm({
                                                            title: 'Reject this inquiry?',
                                                            description: 'The buyer will be notified their inquiry was declined.',
                                                            tone: 'danger',
                                                            confirmLabel: 'Reject',
                                                            action: () => respond(iq.id, 'DECLINED'),
                                                        })}
                                                    >
                                                        Reject
                                                    </Button>
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="border-t border-border-subtle pt-default text-xs text-content-muted">No inquiries yet.</p>
                            )}
                        </div>
                    )))}
                </div>
            </ListPageShell.Body>
        </ListPageShell>
        {confirm && (
            <ConfirmDialog
                showModal
                setShowModal={() => setConfirm(null)}
                tone={confirm.tone}
                title={confirm.title}
                description={confirm.description}
                confirmLabel={confirm.confirmLabel}
                onConfirm={async () => { await confirm.action(); setConfirm(null); }}
            />
        )}
        </>
    );
}
