'use client';

/**
 * News page — client shell.
 *
 * Standalone top-level destination (its own nav button + `/news` route),
 * decoupled from the Trends page. Renders the page heading + the `NewsTab`
 * feed (category filter + cards). Housed under `src/components/trends/`
 * alongside `NewsTab` because the feed uses the shared `<TabSelect>` primitive,
 * which the `single-tab-pattern` guard forbids inside `src/app/**`.
 */
import { useTranslations } from 'next-intl';

import { Heading } from '@/components/ui/typography';
import { NewsTab } from './NewsTab';

export function NewsPageClient() {
    const t = useTranslations('trends');

    return (
        <div className="space-y-section">
            <Heading level={1} id="news-title">
                {t('news.pageTitle')}
            </Heading>
            <NewsTab />
        </div>
    );
}
