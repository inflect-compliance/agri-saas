'use client';

/**
 * Trends → News tab (placeholder mount point).
 *
 * A real, minimal section the later "market news" PR fills in. For now it
 * renders a coming-soon empty state so the two-tab page reads as complete
 * rather than showing a blank panel.
 */
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/ui/empty-state';

export function NewsTab() {
    const t = useTranslations('trends');
    return (
        <section id="trends-news-panel" className="space-y-section">
            <EmptyState
                variant="no-records"
                title={t('news.comingSoonTitle')}
                description={t('news.comingSoonBody')}
                data-testid="trends-news-placeholder"
            />
        </section>
    );
}
