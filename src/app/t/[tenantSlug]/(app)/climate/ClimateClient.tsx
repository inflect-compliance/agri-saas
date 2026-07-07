'use client';

/**
 * Climate (Климат) client (#14). Renders the tenant's Meteobot station embed
 * when configured, else an Open-Meteo weather fallback; admins can set/clear
 * the station URL inline.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Heading } from '@/components/ui/typography';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export interface ClimateClientProps {
    tenantSlug: string;
    meteobotStationUrl: string | null;
    canAdmin: boolean;
}

export function ClimateClient({ tenantSlug, meteobotStationUrl, canAdmin }: ClimateClientProps) {
    const t = useTranslations('ag.climate');
    const router = useRouter();
    const buildUrl = useTenantApiUrl();
    const [url, setUrl] = useState(meteobotStationUrl ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async (value: string | null) => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(buildUrl('/climate/meteobot'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meteobotStationUrl: value }),
            });
            if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                throw new Error((typeof b?.error === 'string' && b.error) || b?.message || t('saveFailed'));
            }
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : t('saveFailed'));
        } finally {
            setSaving(false);
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

            {meteobotStationUrl ? (
                <div className="space-y-default">
                    <div className="overflow-hidden rounded-lg border border-border-default">
                        <iframe
                            src={meteobotStationUrl}
                            title={t('stationTitle')}
                            className="h-[70vh] w-full"
                            loading="lazy"
                        />
                    </div>
                    <p className="text-xs text-content-muted">
                        {t('attribution')} ·{' '}
                        <a
                            href={meteobotStationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-content-link hover:underline"
                        >
                            {t('openInNewTab')}
                        </a>
                    </p>
                </div>
            ) : (
                <div className="rounded-lg border border-border-subtle bg-bg-default p-6">
                    <p className="text-sm text-content-default">{t('noStation')}</p>
                    <p className="mt-2 text-sm text-content-muted">{t('fallbackHint')}</p>
                    <div className="mt-default">
                        <Button variant="secondary" size="sm" onClick={() => router.push(`/t/${tenantSlug}/locations`)}>
                            {t('openWeather')}
                        </Button>
                    </div>
                </div>
            )}

            {canAdmin && (
                <div className="space-y-default rounded-lg border border-border-subtle bg-bg-subtle p-4">
                    <p className="text-sm font-medium text-content-emphasis">{t('settingsTitle')}</p>
                    <p className="text-xs text-content-muted">{t('settingsHint')}</p>
                    {error && (
                        <div role="alert" className="rounded-md border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                            {error}
                        </div>
                    )}
                    <FormField label={t('stationUrlLabel')}>
                        <Input
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder={t('urlPlaceholder')}
                            inputMode="url"
                        />
                    </FormField>
                    <div className="flex gap-compact">
                        <Button variant="primary" size="sm" loading={saving} onClick={() => save(url)}>
                            {t('save')}
                        </Button>
                        {meteobotStationUrl && (
                            <Button variant="secondary" size="sm" disabled={saving} onClick={() => { setUrl(''); void save(null); }}>
                                {t('clear')}
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
