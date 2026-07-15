'use client';

/**
 * Dashboard "Market trends" widget — a crop slideshow.
 *
 * Cycles through every supported commodity (wheat / maize / barley / sunflower),
 * each slide showing that crop's headline latest price + a sparkline. The slide
 * auto-advances every 10s, and is manually slidable via prev/next controls, the
 * dot indicators, or a touch swipe. Manual navigation (and hover/focus) resets /
 * pauses the timer so the card never changes out from under the reader.
 *
 * Data-light: a single SWR read keyed by the ACTIVE crop, so only the crops the
 * user actually sees are fetched (SWR + the persistent cache keep already-seen
 * crops instant). The price/sparkline area taps through to the full Trends page;
 * the slideshow controls sit outside that link (no nested interactive elements).
 *
 * The tenant dashboard is a hand-composed static page (no widget registry —
 * unlike the org dashboard), so this mounts directly in `DashboardClient.tsx`
 * alongside `<TasksTrendCard>`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from '@/components/ui/icons/nucleo/chevron-left';
import { ChevronRight } from '@/components/ui/icons/nucleo/chevron-right';

import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/typography';
import { Skeleton } from '@/components/ui/skeleton';
import { MiniAreaChart } from '@/components/ui/mini-area-chart';
import {
    type TrendPricesResponse,
    findEcSeries,
    findListingsSeries,
    findReferenceSeries,
    latestPoint,
    weekOverWeekDelta,
    formatPrice,
    formatDelta,
} from './trends-helpers';

/** Crops the slideshow cycles through (matches the MarketPriceSeries slugs). */
const WIDGET_COMMODITIES = ['wheat', 'maize', 'barley', 'sunflower'] as const;
const WIDGET_RANGE = '3m';
const AUTO_ADVANCE_MS = 10_000;
/** Min horizontal travel (px) to count a touch as a swipe. */
const SWIPE_THRESHOLD_PX = 40;

export function MarketTrendsWidget() {
    const t = useTranslations('trends');
    const tenantHref = useTenantHref();

    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const commodity = WIDGET_COMMODITIES[index];
    const count = WIDGET_COMMODITIES.length;

    const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);
    const prev = useCallback(() => go(index - 1), [go, index]);
    const next = useCallback(() => go(index + 1), [go, index]);

    // Auto-advance. The timer resets whenever the slide changes (manual or auto)
    // or when paused toggles, so a manual nav gives a fresh 10s and hover pauses.
    useEffect(() => {
        if (paused) return undefined;
        const id = setTimeout(() => setIndex((i) => (i + 1) % count), AUTO_ADVANCE_MS);
        return () => clearTimeout(id);
    }, [index, paused, count]);

    // Touch swipe.
    const touchStartX = useRef<number | null>(null);
    const onTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
    };
    const onTouchEnd = (e: React.TouchEvent) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
        if (dx < 0) next();
        else prev();
    };

    const { data } = useTenantSWR<TrendPricesResponse>(
        CACHE_KEYS.trends.prices(commodity, WIDGET_RANGE),
    );

    // Headline series: prefer official BG, then own-listings, then reference.
    const headline = useMemo(() => {
        if (!data) return null;
        const s =
            findEcSeries(data.series, 'BG') ??
            findListingsSeries(data.series) ??
            findReferenceSeries(data.series);
        if (!s) return null;
        const latest = latestPoint(s);
        if (!latest) return null;
        const delta = weekOverWeekDelta(s);
        return {
            unit: s.unit,
            price: latest.price,
            delta,
            points: s.points.map((p) => ({
                date: new Date(`${p.date}T00:00:00Z`),
                value: p.price,
            })),
        };
    }, [data]);

    const deltaTone =
        headline?.delta == null
            ? 'text-content-muted'
            : headline.delta > 0
              ? 'text-content-success'
              : headline.delta < 0
                ? 'text-content-error'
                : 'text-content-muted';

    const commodityLabel = t(`commodities.${commodity}`);

    return (
        <Card
            className="space-y-default"
            // Pause the auto-advance while the user is reading / interacting.
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            role="group"
            aria-roledescription={t('widget.carousel')}
            aria-label={t('widget.title')}
        >
            <div className="flex items-center justify-between gap-tight">
                <Heading level={3}>{t('widget.title')}</Heading>
                <div className="flex items-center gap-tight">
                    <span className="text-xs text-content-muted" aria-live="polite">
                        {commodityLabel}
                    </span>
                    <button
                        type="button"
                        onClick={prev}
                        aria-label={t('widget.prev')}
                        className="rounded-md p-1 text-content-muted transition-colors hover:bg-bg-subtle hover:text-content-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                        <ChevronLeft width={16} height={16} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        onClick={next}
                        aria-label={t('widget.next')}
                        className="rounded-md p-1 text-content-muted transition-colors hover:bg-bg-subtle hover:text-content-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                        <ChevronRight width={16} height={16} aria-hidden="true" />
                    </button>
                </div>
            </div>

            <Link
                href={tenantHref('/trends')}
                id="market-trends-widget"
                aria-label={t('widget.tapThrough')}
                className="block rounded-lg transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
                {!data ? (
                    <Skeleton className="h-16 w-full" />
                ) : !headline ? (
                    <p className="py-4 text-xs text-content-subtle">{t('widget.empty')}</p>
                ) : (
                    <div className="flex items-center gap-default">
                        <div className="min-w-0">
                            <p className="text-2xl font-semibold text-content-emphasis tabular-nums">
                                {formatPrice(headline.price)}
                            </p>
                            <p className="text-xs text-content-muted tabular-nums">{headline.unit}</p>
                            {headline.delta != null && (
                                <p className={`text-xs tabular-nums ${deltaTone}`}>
                                    {formatDelta(headline.delta)}
                                </p>
                            )}
                        </div>
                        <div className="h-12 flex-1">
                            <MiniAreaChart
                                data={headline.points}
                                variant="brand"
                                aria-label={t('widget.ariaSparkline', { commodity: commodityLabel })}
                            />
                        </div>
                    </div>
                )}
            </Link>

            {/* Dot indicators — one per crop, clickable to jump. */}
            <div className="flex items-center justify-center gap-tight" role="tablist" aria-label={t('widget.title')}>
                {WIDGET_COMMODITIES.map((c, i) => (
                    <button
                        key={c}
                        type="button"
                        role="tab"
                        aria-selected={i === index}
                        aria-label={t('widget.showCrop', { commodity: t(`commodities.${c}`) })}
                        onClick={() => go(i)}
                        className={`h-1.5 rounded-full transition-all ${
                            i === index ? 'w-4 bg-brand-default' : 'w-1.5 bg-border-default hover:bg-content-muted'
                        }`}
                    />
                ))}
            </div>
        </Card>
    );
}
