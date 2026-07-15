'use client';

/**
 * Trends page — client shell (Prices).
 *
 * A dashboard-style (NOT entity-list) page showing the market-price charts.
 * News used to live here as a second tab; it is now its own top-level nav
 * destination (`/news`, `NewsPageClient`), so this page is single-purpose and
 * no longer renders a tab bar.
 */
import { useTranslations } from 'next-intl';

import { Heading } from '@/components/ui/typography';
import { PricesTab } from './PricesTab';

export function TrendsPageClient() {
    const t = useTranslations('trends');

    return (
        <div className="space-y-section">
            <Heading level={1} id="trends-title">
                {t('title')}
            </Heading>
            <PricesTab />
        </div>
    );
}
