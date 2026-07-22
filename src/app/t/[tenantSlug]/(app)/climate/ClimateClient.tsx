'use client';

/**
 * Climate (Климат) client — renders the tenant's own Open-Meteo weather
 * (collected daily by the `weather-pull` job into `WeatherObservation`):
 * current conditions, a recent + forecast temperature chart, and today's
 * spray window, for a selected location. The location selector drives a
 * `?location=` query param the server component reads.
 *
 * (The former Meteobot iframe embed was removed — it was blocked by the app
 * CSP and its intent is served natively here. See the 2026-07 climate note.)
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Combobox } from '@/components/ui/combobox';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import {
    TimeSeriesChart,
    Areas,
    XAxis,
    YAxis,
    type Series,
    type TimeSeriesDatum,
} from '@/components/ui/charts';
import type {
    LocationClimate,
    WeatherLocationOption,
    DailyWeather,
} from '@/app-layer/usecases/climate';
import type { SprayWindowStatus } from '@/lib/agro/rules';

export interface ClimateClientProps {
    tenantSlug: string;
    locations: WeatherLocationOption[];
    selectedLocationId: string | null;
    climate: LocationClimate | null;
}

const SPRAY_TONE: Record<SprayWindowStatus, 'success' | 'warning' | 'error'> = {
    GOOD: 'success',
    CAUTION: 'warning',
    UNSUITABLE: 'error',
};

const TEMP_MAX_LINE = 'text-content-error';
const TEMP_MIN_LINE = 'text-brand-default';

type TempValues = { max: number; min: number };

function fmtNum(v: number | null, digits = 0): string {
    return v == null ? '—' : v.toFixed(digits);
}

function hh(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
}

function StatTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
    return (
        <div className="rounded-lg border border-border-subtle bg-bg-default p-3">
            <p className="text-xs text-content-subtle">{label}</p>
            <p className="mt-1 text-lg font-semibold text-content-emphasis tabular-nums">
                {value}
                {unit && value !== '—' ? <span className="ml-1 text-sm font-normal text-content-muted">{unit}</span> : null}
            </p>
        </div>
    );
}

export function ClimateClient({ tenantSlug, locations, selectedLocationId, climate }: ClimateClientProps) {
    const t = useTranslations('ag.climate');
    const router = useRouter();
    const pathname = usePathname();

    const chartData = useMemo<TimeSeriesDatum<TempValues>[]>(
        () =>
            (climate?.daily ?? [])
                .filter((d): d is DailyWeather & { tempMaxC: number; tempMinC: number } =>
                    d.tempMaxC != null && d.tempMinC != null)
                .map((d) => ({
                    date: new Date(`${d.date}T00:00:00Z`),
                    values: { max: d.tempMaxC, min: d.tempMinC },
                })),
        [climate],
    );

    const series = useMemo<Series<TempValues>[]>(
        () => [
            { id: 'max', isActive: true, valueAccessor: (d) => d.values.max, colorClassName: TEMP_MAX_LINE },
            { id: 'min', isActive: true, valueAccessor: (d) => d.values.min, colorClassName: TEMP_MIN_LINE },
        ],
        [],
    );

    const locationOptions = useMemo(
        () => locations.map((l) => ({ value: l.id, label: l.name })),
        [locations],
    );
    const selectedOption = locationOptions.find((o) => o.value === selectedLocationId) ?? null;

    const header = (
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
    );

    // No locations at all — nothing to show weather for.
    if (locations.length === 0) {
        return (
            <div className="space-y-section p-4">
                {header}
                <EmptyState title={t('noLocationsTitle')} description={t('locationsEmptyBody')}>
                    <Button variant="primary" size="sm" onClick={() => router.push(`/t/${tenantSlug}/locations`)}>
                        {t('goToLocations')}
                    </Button>
                </EmptyState>
            </div>
        );
    }

    const current = climate?.current ?? null;
    const spray = climate?.sprayWindow ?? null;

    return (
        <div className="space-y-section p-4">
            {header}

            <div className="max-w-xs">
                <Combobox
                    options={locationOptions}
                    selected={selectedOption}
                    setSelected={(opt) => {
                        if (opt) router.push(`${pathname}?location=${encodeURIComponent(opt.value)}`);
                    }}
                    placeholder={t('selectLocation')}
                    matchTriggerWidth
                />
            </div>

            {!climate || climate.daily.length === 0 ? (
                <EmptyState title={t('noWeatherTitle')} description={t('weatherEmptyBody')} />
            ) : (
                <div className="space-y-section">
                    {/* Current conditions + spray verdict */}
                    <Card>
                        <div className="flex items-baseline justify-between gap-tight">
                            <Heading level={3}>{t('currentTitle', { location: climate.locationName })}</Heading>
                            {spray && (
                                <StatusBadge variant={SPRAY_TONE[spray.status]}>
                                    {t(`spray.${spray.status}`)}
                                </StatusBadge>
                            )}
                        </div>
                        <div className="mt-default grid grid-cols-2 gap-default sm:grid-cols-3 lg:grid-cols-6">
                            <StatTile label={t('tempMean')} value={fmtNum(current?.tempMeanC ?? null)} unit="°C" />
                            <StatTile label={t('tempMax')} value={fmtNum(current?.tempMaxC ?? null)} unit="°C" />
                            <StatTile label={t('tempMin')} value={fmtNum(current?.tempMinC ?? null)} unit="°C" />
                            <StatTile label={t('precip')} value={fmtNum(current?.precipMm ?? null, 1)} unit={t('mm')} />
                            <StatTile label={t('wind')} value={fmtNum(current?.windMaxKmh ?? null)} unit={t('kmh')} />
                            <StatTile label={t('humidity')} value={fmtNum(current?.humidityMean ?? null)} unit="%" />
                        </div>

                        {/* Spray window strip */}
                        {spray && (
                            <div className="mt-default border-t border-border-subtle pt-default">
                                {spray.windows.length > 0 ? (
                                    <p className="text-sm text-content-default">
                                        {t('sprayWindows')}{' '}
                                        <span className="font-medium">
                                            {spray.windows.map((w) => `${hh(w.startHour)}–${hh(w.endHour)}`).join(', ')}
                                        </span>
                                    </p>
                                ) : (
                                    <p className="text-sm text-content-muted">{t('sprayNone')}</p>
                                )}
                            </div>
                        )}
                    </Card>

                    {/* Temperature trend */}
                    <Card>
                        <div className="mb-3 flex items-baseline justify-between gap-tight">
                            <Heading level={3}>{t('tempTrendTitle')}</Heading>
                            <span className="flex items-center gap-default text-xs">
                                <span className="flex items-center gap-tight">
                                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-content-error" />
                                    <span className="text-content-muted">{t('tempMax')}</span>
                                </span>
                                <span className="flex items-center gap-tight">
                                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-default" />
                                    <span className="text-content-muted">{t('tempMin')}</span>
                                </span>
                            </span>
                        </div>
                        {chartData.length > 0 ? (
                            <div className="h-48" role="img" aria-label={t('tempTrendAria', { days: chartData.length })}>
                                <TimeSeriesChart<TempValues> type="area" data={chartData} series={series}>
                                    <YAxis showGridLines />
                                    <Areas />
                                    <XAxis />
                                </TimeSeriesChart>
                            </div>
                        ) : (
                            <p className="text-xs text-content-subtle">{t('weatherEmptyBody')}</p>
                        )}
                        <p className="mt-2 text-xs text-content-subtle">
                            {t('source', { source: climate.source })}
                        </p>
                    </Card>
                </div>
            )}
        </div>
    );
}
