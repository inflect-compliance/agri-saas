import { getTranslations } from 'next-intl/server';
import { getTenantCtx } from '@/app-layer/context';
import { listUpcomingAgriEvents } from '@/app-layer/usecases/agri-events';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { formatDate, formatDateRange } from '@/lib/format-date';
import type { AgriEventCategory } from '@/app-layer/schemas/agri-event.schemas';

/**
 * Agriculture events (Събития) — #15. A scrollable feed of upcoming fairs,
 * trainings, webinars, and subsidy deadlines from the GLOBAL AgriEvent
 * catalogue (shared across tenants).
 *
 * Read-only by design — the catalogue is global, so a tenant-facing write would
 * change what every other tenant sees. Rows come from the platform-admin API
 * (`/api/admin/agri-events`) in production, and from
 * `scripts/seed-agri-events.ts` in dev/demo/staging.
 *
 * The sidebar hides the entry for this page when the catalogue has nothing
 * upcoming, so the empty state below is a fallback (direct link, the ⌘K
 * palette entry, or the catalogue emptying mid-session), not the common case.
 */

/**
 * The curated set is closed on the WRITE side (`AGRI_EVENT_CATEGORIES`), so
 * this map is exhaustive by type: adding a category without giving it a label
 * is a compile error, not a row that quietly renders as "Fair".
 */
const CATEGORY_LABEL_KEYS: Record<AgriEventCategory, string> = {
    fair: 'catFair',
    training: 'catTraining',
    webinar: 'catWebinar',
    'subsidy-deadline': 'catSubsidy',
};

export default async function AgriEventsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    const [events, t] = await Promise.all([
        listUpcomingAgriEvents(ctx),
        getTranslations('ag.events'),
    ]);

    /**
     * The previous `default:` arm mislabeled anything unknown — a subsidy
     * deadline arriving as an unrecognised string would have been presented to
     * a farmer as a trade fair. Rows predating the write-side validation can
     * still hold arbitrary strings, so the runtime fallback shows the raw value
     * instead of asserting a category we don't actually know.
     */
    const categoryLabel = (c: string): string =>
        c in CATEGORY_LABEL_KEYS
            ? t(CATEGORY_LABEL_KEYS[c as AgriEventCategory])
            : c;

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
                <Heading level={1} id="events-title">{t('title')}</Heading>
                <p className="text-sm text-content-secondary">{t('description')}</p>
            </div>

            {events.length === 0 ? (
                <div className="rounded-lg border border-border-subtle bg-bg-default p-6 text-sm text-content-muted">
                    {t('empty')}
                </div>
            ) : (
                <ul className="space-y-default" id="events-list">
                    {events.map((e) => (
                        <li
                            key={e.id}
                            id={`event-${e.id}`}
                            className="rounded-lg border border-border-subtle bg-bg-default p-4"
                        >
                            <div className="flex items-start justify-between gap-default">
                                <div className="min-w-0">
                                    <p className="font-medium text-content-emphasis">{e.title}</p>
                                    {e.description && (
                                        <p className="mt-1 text-sm text-content-muted">{e.description}</p>
                                    )}
                                    <p className="mt-2 text-xs text-content-subtle">
                                        {/*
                                          * A real span goes through the canonical
                                          * `formatDateRange` (which the format-date
                                          * docblock requires instead of a hand-built
                                          * ` – ` separator, and which collapses
                                          * same-month / same-year endpoints).
                                          *
                                          * A single date deliberately does NOT:
                                          * `formatDateRange(start, null)` renders
                                          * "From 16 Apr 2026", which is wrong for the
                                          * majority of this feed — a one-day webinar
                                          * isn't open-ended, and on a subsidy DEADLINE
                                          * "From" inverts the meaning of the date a
                                          * farmer must act by.
                                          */}
                                        {e.endsAt
                                            ? formatDateRange(e.startsAt, e.endsAt)
                                            : formatDate(e.startsAt)}
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
