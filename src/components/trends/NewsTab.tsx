'use client';

/**
 * Trends → News tab.
 *
 * A category filter (`All / Market / Policy / General`) over the aggregated
 * agri-news feed. Each item is a card that links out to the source article.
 * Degrades to a skeleton while loading, and to a combined empty + operator-
 * configuration panel when the feed is empty (the endpoint returns an empty
 * feed both when no feeds are configured and when the window is genuinely
 * empty — indistinguishable to the client, so the panel carries both messages,
 * mirroring the Prices tab).
 *
 * Text-first (no thumbnails) — keeps the feed cheap on rural LTE and avoids
 * remote-image domain config; `imageUrl` is stored for future use.
 *
 * Lives under `src/components/trends/` (not the route folder) deliberately: the
 * `single-tab-pattern` guard forbids `<TabSelect>` inside `src/app/**`, and this
 * tab uses TabSelect for the category filter.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { TabSelect } from '@/components/ui/tab-select';
import { formatRelativeTime } from '@/lib/format-date';
import type { TrendNewsResponse, NewsItem } from '@/app-layer/usecases/trends';

const FILTERS = ['all', 'market', 'policy', 'general'] as const;
type Filter = (typeof FILTERS)[number];

/** Category → StatusBadge variant. */
const CATEGORY_VARIANT: Record<string, 'info' | 'warning' | 'neutral'> = {
    market: 'info',
    policy: 'warning',
    general: 'neutral',
};

// ─── News card ───────────────────────────────────────────────────────

function NewsCard({ item, now }: { item: NewsItem; now: Date }) {
    const t = useTranslations('trends');
    const variant = CATEGORY_VARIANT[item.category] ?? 'neutral';
    return (
        <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-default"
        >
            <Card className="space-y-tight hover:border-border-emphasis">
                <div className="flex items-center justify-between gap-tight">
                    <StatusBadge variant={variant} size="sm">
                        {t(`news.categories.${item.category}`)}
                    </StatusBadge>
                    <span className="text-xs text-content-muted tabular-nums">
                        {formatRelativeTime(item.publishedAt, now)}
                    </span>
                </div>
                <p className="font-medium text-content-emphasis">{item.title}</p>
                {item.summary && (
                    <p className="line-clamp-2 text-sm text-content-muted">{item.summary}</p>
                )}
                <p className="text-xs text-content-subtle">{item.source}</p>
            </Card>
        </a>
    );
}

// ─── News tab ────────────────────────────────────────────────────────

export function NewsTab() {
    const t = useTranslations('trends');
    const [filter, setFilter] = useState<Filter>('all');

    const { data, error } = useTenantSWR<TrendNewsResponse>(CACHE_KEYS.trends.news(filter));

    // Stable "now" for relative times within one render pass.
    const now = useMemo(() => new Date(), [data]);

    const filterOptions = useMemo(
        () => FILTERS.map((f) => ({ id: f, label: t(`news.filters.${f}`) })),
        [t],
    );

    const isLoading = !data && !error;
    const items = data?.items ?? [];
    const empty = error != null || (data != null && items.length === 0);

    return (
        <div className="space-y-section" id="trends-news-panel">
            <TabSelect<Filter>
                options={filterOptions}
                selected={filter}
                onSelect={setFilter}
                ariaLabel={t('news.filterAriaLabel')}
                idPrefix="trends-news-filter-"
            />

            {isLoading ? (
                <div className="space-y-default" data-testid="trends-news-loading">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                </div>
            ) : empty ? (
                <EmptyState
                    variant="no-records"
                    title={t('news.empty.title')}
                    description={t('news.empty.description')}
                    data-testid="trends-news-empty"
                >
                    {/* Operator-configuration explainer — the feed is populated
                        by a scheduled job reading these curated/env feeds. */}
                    <div
                        className="mt-default rounded-lg border border-border-subtle bg-bg-muted px-4 py-3 text-left"
                        data-testid="trends-news-operator-hint"
                    >
                        <p className="text-xs font-semibold text-content-emphasis">
                            {t('news.operator.title')}
                        </p>
                        <p className="mt-1 text-xs text-content-muted">
                            {t('news.operator.body', { env: 'MARKET_NEWS_FEEDS' })}
                        </p>
                    </div>
                </EmptyState>
            ) : (
                <ul className="space-y-default">
                    {items.map((item) => (
                        <li key={item.id}>
                            <NewsCard item={item} now={now} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
