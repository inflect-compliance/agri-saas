'use client';

/**
 * PR-1 — Shared "Load more" table footer.
 *
 * Renders the same visual rhythm the org-level tables use for
 * their cursor-paginated "Load more …" affordance, but adapted
 * for client-side threshold-based progressive disclosure on
 * tenant tables. Composes cleanly with either:
 *
 *   • `useCursorPagination`        — org server-cursor flow (loading
 *                                     spinner + retry on fetch error).
 *   • `useThresholdLoadMore`       — tenant in-memory flow (no async,
 *                                     so `loading`/`error` are omitted).
 *
 * The visible / total count line + the action button are the
 * cross-context invariants. The error branch only shows for
 * cursor-mode consumers — passing `error={null}` (the threshold
 * flow's only valid value) hides it.
 *
 * Suppressed entirely when `hasMore` is `false`. Consumers should
 * still render the footer unconditionally — gating happens here so
 * the call site stays a single JSX block regardless of state.
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export interface TableLoadMoreFooterProps {
    /** True iff there are more rows to reveal. */
    hasMore: boolean;
    /** Currently visible rows. Renders as the "X of Y" count. */
    visibleCount: number;
    /** Total rows in the underlying set. */
    totalCount: number;
    /** Click → reveal more rows (or fetch the next cursor). */
    onLoadMore: () => void;
    /** Optional async-loading state for cursor-mode consumers. */
    loading?: boolean;
    /**
     * Optional error string for cursor-mode consumers. Threshold-
     * mode consumers omit; null hides the row.
     */
    error?: string | null;
    /**
     * Entity-noun label, used in both the button copy and the
     * count line. Defaults to "rows" so anything-goes consumers
     * still get a sensible default.
     */
    resourceName?: string;
    /** Stable testid prefix. Defaults to "load-more". */
    testId?: string;
}

export function TableLoadMoreFooter({
    hasMore,
    visibleCount,
    totalCount,
    onLoadMore,
    loading = false,
    error = null,
    resourceName = 'rows',
    testId = 'load-more',
}: TableLoadMoreFooterProps) {
    const t = useTranslations('ui.tableLoadMore');
    if (!hasMore) return null;
    return (
        <div
            className="flex flex-col items-center gap-tight pt-3"
            data-testid={`${testId}-footer`}
        >
            <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid={`${testId}-button`}
                onClick={onLoadMore}
                disabled={loading}
            >
                {loading
                    ? t('loading')
                    : t('loadMore', { resourceName, visibleCount, totalCount })}
            </Button>
            {error && (
                <span
                    className="text-content-error text-sm"
                    role="alert"
                    data-testid={`${testId}-error`}
                >
                    {t('error')}
                </span>
            )}
        </div>
    );
}
