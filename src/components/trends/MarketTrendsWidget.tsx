'use client';

/**
 * Dashboard "Market trends" widget.
 *
 * Headline latest price for the tenant's lead commodity (wheat — the primary
 * Bulgarian cereal; the tenant dashboard has no per-tenant "top commodity"
 * signal today, so this is a sensible fixed default) + a sparkline of the same
 * series, with the WHOLE card tapping through to the full Trends page.
 *
 * The tenant dashboard is a hand-composed static page (no widget registry —
 * unlike the org dashboard), so this mounts directly in `DashboardClient.tsx`
 * alongside `<TasksTrendCard>`.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

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

const WIDGET_COMMODITY = 'wheat';
const WIDGET_RANGE = '3m';

export function MarketTrendsWidget() {
    const t = useTranslations('trends');
    const tenantHref = useTenantHref();
    const { data } = useTenantSWR<TrendPricesResponse>(
        CACHE_KEYS.trends.prices(WIDGET_COMMODITY, WIDGET_RANGE),
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

    return (
        <Link
            href={tenantHref('/trends')}
            id="market-trends-widget"
            aria-label={t('widget.tapThrough')}
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
            <Card className="space-y-default transition-colors hover:border-border-emphasis">
                <div className="flex items-baseline justify-between gap-tight">
                    <Heading level={3}>{t('widget.title')}</Heading>
                    <span className="text-xs text-content-muted">
                        {t(`commodities.${WIDGET_COMMODITY}`)}
                    </span>
                </div>

                {!data ? (
                    <Skeleton className="h-16 w-full" />
                ) : !headline ? (
                    <p className="text-xs text-content-subtle">{t('widget.empty')}</p>
                ) : (
                    <div className="flex items-center gap-default">
                        <div className="min-w-0">
                            <p className="text-2xl font-semibold text-content-emphasis tabular-nums">
                                {formatPrice(headline.price)}
                            </p>
                            <p className="text-xs text-content-muted tabular-nums">
                                {headline.unit}
                            </p>
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
                                aria-label={t('widget.ariaSparkline', {
                                    commodity: t(`commodities.${WIDGET_COMMODITY}`),
                                })}
                            />
                        </div>
                    </div>
                )}
            </Card>
        </Link>
    );
}
