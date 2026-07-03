'use client';

/**
 * Exchange main page — split view: a map of Bulgaria (left) + a synced,
 * filterable offer list (right). Browse-only.
 *
 *   - Data: SWR GET /exchange/listings (public projection across all tenants).
 *   - Filters: Epic 53 FilterToolbar (side / commodity / region / quantity +
 *     live search), applied CLIENT-SIDE over the fetched array.
 *   - Map ↔ list sync: an oblast click toggles the region filter; hovering a
 *     list row highlights its marker; clicking a row (or a marker popup's
 *     "View details") opens the detail Sheet (body stubbed for now).
 *   - Create: header button stubbed — the create modal lands in a follow-up.
 */
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
    parseRangeToken,
} from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons/nucleo';
import { Heading } from '@/components/ui/typography';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import type { ExchangePublicListing } from '@/lib/exchange/public-listing';
import { EXCHANGE_SIDE_COLORS } from '@/components/exchange/ExchangeMap';
import { buildExchangeFilters, EXCHANGE_FILTER_KEYS } from './filter-defs';
import { CreateOfferModal } from './CreateOfferModal';
import { InquiryModal } from './InquiryModal';
import { ExchangeNav } from './ExchangeNav';

// The map uses browser-only APIs (maplibre-gl) — keep it off the SSR graph.
const ExchangeMap = dynamic(
    () => import('@/components/exchange/ExchangeMap').then((m) => m.ExchangeMap),
    { ssr: false },
);

export function ExchangeClient() {
    const filterCtx = useFilterContext([], EXCHANGE_FILTER_KEYS, {});
    return (
        <FilterProvider value={filterCtx}>
            <ExchangeInner />
        </FilterProvider>
    );
}

function SideDot({ side }: { side: 'SELL' | 'BUY' }) {
    return (
        <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: EXCHANGE_SIDE_COLORS[side] }}
        />
    );
}

function ExchangeInner() {
    const tenantHref = useTenantHref();
    const { data, isLoading, mutate } = useTenantSWR<ExchangePublicListing[]>('/exchange/listings');
    const { state, search, toggle } = useFilters();

    const offers = useMemo(() => data ?? [], [data]);
    const selectedRegionCodes = state.region ?? [];

    // Runtime commodity options from the feed.
    const liveFilters = useMemo(
        () => buildExchangeFilters(offers.map((o) => o.commodity)),
        [offers],
    );

    // Client-side filter (side / commodity / region / quantity + search).
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const sides = state.side ?? [];
        const regions = state.region ?? [];
        const commodities = state.commodity ?? [];
        const range = state.quantity?.[0] ? parseRangeToken(state.quantity[0]) : null;
        return offers.filter((o) => {
            if (q && !`${o.commodity} ${o.regionName}`.toLowerCase().includes(q)) return false;
            if (sides.length && !sides.includes(o.side)) return false;
            if (regions.length && !regions.includes(o.regionCode)) return false;
            if (commodities.length && !commodities.includes(o.commodity)) return false;
            if (range) {
                const qt = Number(o.quantityTonnes);
                if (range.min != null && qt < range.min) return false;
                if (range.max != null && qt > range.max) return false;
            }
            return true;
        });
    }, [offers, search, state]);

    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [inquiryOpen, setInquiryOpen] = useState(false);

    // Optimistically add a freshly-created listing to the shared SWR cache so
    // it lands on the map + list instantly, then revalidate to reconcile.
    function handleCreated(created: ExchangePublicListing) {
        void mutate([created, ...offers], { revalidate: true });
    }
    const selectedOffer = useMemo(
        () => filtered.find((o) => o.id === selectedId) ?? offers.find((o) => o.id === selectedId) ?? null,
        [filtered, offers, selectedId],
    );

    return (
        <ListPageShell>
            <ListPageShell.Header>
                <PageBreadcrumbs
                    items={[
                        { label: 'Dashboard', href: tenantHref('/dashboard') },
                        { label: 'Exchange' },
                    ]}
                    className="mb-1"
                />
                <div className="flex flex-wrap items-center justify-between gap-default">
                    <div className="flex flex-wrap items-center gap-section">
                        <Heading level={1}>Борса / Exchange</Heading>
                        {/* SELL/BUY colour legend — matches the map markers. */}
                        <div className="flex items-center gap-default text-xs text-content-muted">
                            <span className="flex items-center gap-compact">
                                <SideDot side="SELL" /> Selling
                            </span>
                            <span className="flex items-center gap-compact">
                                <SideDot side="BUY" /> Buying
                            </span>
                        </div>
                    </div>
                    <Button
                        variant="primary"
                        icon={<Plus />}
                        id="new-offer-btn"
                        onClick={() => setCreateOpen(true)}
                    >
                        Offer
                    </Button>
                </div>
                <ExchangeNav />
            </ListPageShell.Header>

            <ListPageShell.Filters>
                <FilterToolbar
                    filters={liveFilters}
                    searchId="exchange-search"
                    searchPlaceholder="Search offers…"
                />
            </ListPageShell.Filters>

            <ListPageShell.Body>
                <div className="flex min-h-0 flex-1 gap-default overflow-hidden max-md:flex-col">
                    {/* Map — fills the pane. */}
                    <div className="min-h-0 flex-1 overflow-hidden max-md:h-[46vh] max-md:min-h-[18rem]">
                        <ExchangeMap
                            listings={filtered}
                            selectedRegionCodes={selectedRegionCodes}
                            onRegionClick={(code) => toggle('region', code)}
                            onListingSelect={(id) => setSelectedId(id)}
                            highlightedId={hoveredId}
                        />
                    </div>

                    {/* Synced offer list — scrolls. */}
                    <div className="flex min-h-0 w-full flex-col md:w-[380px]">
                        <p className="mb-default flex-shrink-0 text-xs text-content-muted">
                            {isLoading ? 'Loading offers…' : `${filtered.length} offer${filtered.length === 1 ? '' : 's'}`}
                        </p>
                        <div className="min-h-0 flex-1 space-y-default overflow-y-auto pr-1">
                            {!isLoading && filtered.length === 0 && (
                                <div className="rounded-lg border border-border-subtle p-4 text-sm text-content-muted">
                                    No offers match your filters.
                                </div>
                            )}
                            {filtered.map((o) => (
                                <button
                                    key={o.id}
                                    type="button"
                                    onMouseEnter={() => setHoveredId(o.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    onClick={() => setSelectedId(o.id)}
                                    className={cn(
                                        'w-full space-y-tight rounded-lg border p-3 text-left transition',
                                        hoveredId === o.id
                                            ? 'border-border-emphasis bg-bg-subtle'
                                            : 'border-border-subtle hover:border-border-emphasis',
                                    )}
                                >
                                    <div className="flex items-center gap-compact">
                                        <SideDot side={o.side} />
                                        <span className="font-medium text-content-emphasis">{o.commodity}</span>
                                        <span className="text-xs text-content-muted">
                                            {o.side === 'SELL' ? 'Selling' : 'Buying'}
                                        </span>
                                        {o.isOwn && (
                                            <span className="ml-auto rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-content-secondary">
                                                Your offer
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-content-secondary">
                                        {o.quantityTonnes} t
                                        {o.pricePerTonne ? ` · ${o.pricePerTonne} ${o.priceCurrency}/t` : ''}
                                    </div>
                                    <div className="text-xs text-content-muted">
                                        {o.regionName}
                                        {o.sellerDisplayName ? ` · ${o.sellerDisplayName}` : ''}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </ListPageShell.Body>

            {/* Detail Sheet — open/close wired here; body stubbed (Prompt 3). */}
            <Sheet
                open={selectedId != null}
                onOpenChange={(o) => {
                    if (!o) setSelectedId(null);
                }}
                direction="right"
                title={selectedOffer?.commodity ?? 'Offer'}
                description="Offer detail"
            >
                <Sheet.Header title={selectedOffer?.commodity ?? 'Offer'} />
                <Sheet.Body className="space-y-section">
                    {selectedOffer && (
                        <div className="space-y-default text-sm">
                            <div className="flex items-center gap-compact">
                                <SideDot side={selectedOffer.side} />
                                <span className="font-medium text-content-emphasis">
                                    {selectedOffer.side === 'SELL' ? 'Selling' : 'Buying'}
                                </span>
                                {selectedOffer.isOwn && (
                                    <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-content-secondary">
                                        Your offer
                                    </span>
                                )}
                            </div>
                            <dl className="grid grid-cols-[auto_1fr] gap-x-section gap-y-tight text-content-secondary">
                                <dt className="text-content-muted">Quantity</dt>
                                <dd>{selectedOffer.quantityTonnes} t</dd>
                                <dt className="text-content-muted">Price</dt>
                                <dd>
                                    {selectedOffer.pricePerTonne
                                        ? `${selectedOffer.pricePerTonne} ${selectedOffer.priceCurrency}/t`
                                        : 'Market / negotiable'}
                                </dd>
                                <dt className="text-content-muted">Region</dt>
                                <dd>{selectedOffer.regionName}</dd>
                                {selectedOffer.expiresAt && (
                                    <>
                                        <dt className="text-content-muted">Expires</dt>
                                        <dd>{new Date(selectedOffer.expiresAt).toLocaleDateString()}</dd>
                                    </>
                                )}
                                <dt className="text-content-muted">Seller</dt>
                                <dd>{selectedOffer.sellerDisplayName || 'Anonymous farm'}</dd>
                            </dl>
                            {selectedOffer.description && (
                                <p className="whitespace-pre-wrap text-content-muted">{selectedOffer.description}</p>
                            )}
                            {/* Contact happens only through a mediated inquiry — and never
                                on your own listing. */}
                            {!selectedOffer.isOwn && (
                                <Button variant="primary" size="sm" className="w-full" onClick={() => setInquiryOpen(true)}>
                                    Express interest
                                </Button>
                            )}
                        </div>
                    )}
                </Sheet.Body>
            </Sheet>

            <CreateOfferModal open={createOpen} setOpen={setCreateOpen} onCreated={handleCreated} />
            <InquiryModal
                open={inquiryOpen}
                setOpen={setInquiryOpen}
                listing={selectedOffer}
                onSent={() => setSelectedId(null)}
            />
        </ListPageShell>
    );
}
