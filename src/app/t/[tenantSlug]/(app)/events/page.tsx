import { getTranslations } from 'next-intl/server';
import { getTenantCtx } from '@/app-layer/context';
import { listUpcomingAgriEvents } from '@/app-layer/usecases/agri-events';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { formatDate } from '@/lib/format-date';

/**
 * Agriculture events (Събития) — #15. A scrollable feed of upcoming fairs,
 * trainings, webinars, and subsidy deadlines from the GLOBAL AgriEvent
 * catalogue (shared across tenants). Read-only; population is via seed/admin.
 */
export default async function AgriEventsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    const [events, t] = await Promise.all([
        listUpcomingAgriEvents(ctx),
        getTranslations('ag.events'),
    ]);

    const categoryLabel = (c: string): string => {
        switch (c) {
            case 'training': return t('catTraining');
            case 'webinar': return t('catWebinar');
            case 'subsidy-deadline': return t('catSubsidy');
            default: return t('catFair');
        }
    };

    return (
        <div className="space-y-section p-4">
            <div>
                <PageBreadcrumbs
                    items={[
                        { label: t('breadcrumbDashboard'), href: `/t/${tenantSlug}/dashboard` },
                        { label: t('title') },
                    ]}
                    className="mb-1"
                />
                <Heading level={1}>{t('title')}</Heading>
                <p className="text-sm text-content-secondary">{t('description')}</p>
            </div>

            {events.length === 0 ? (
                <div className="rounded-lg border border-border-subtle bg-bg-default p-6 text-sm text-content-muted">
                    {t('empty')}
                </div>
            ) : (
                <ul className="space-y-default">
                    {events.map((e) => (
                        <li
                            key={e.id}
                            className="rounded-lg border border-border-subtle bg-bg-default p-4"
                        >
                            <div className="flex items-start justify-between gap-default">
                                <div className="min-w-0">
                                    <p className="font-medium text-content-emphasis">{e.title}</p>
                                    {e.description && (
                                        <p className="mt-1 text-sm text-content-muted">{e.description}</p>
                                    )}
                                    <p className="mt-2 text-xs text-content-subtle">
                                        {formatDate(e.startsAt)}
                                        {e.endsAt ? ` – ${formatDate(e.endsAt)}` : ''}
                                        {e.place ? ` · ${e.place}` : ''}
                                    </p>
                                </div>
                                <span className="flex-shrink-0 rounded-full bg-bg-muted px-2 py-0.5 text-xs text-content-muted">
                                    {categoryLabel(e.category)}
                                </span>
                            </div>
                            {e.url && (
                                <a
                                    href={e.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-2 inline-block text-sm text-content-link hover:underline"
                                >
                                    {t('moreInfo')}
                                </a>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
