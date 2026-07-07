'use client';

/**
 * Per-parcel soil profile display (#37) — texture, pH, organic carbon, the
 * sand/silt/clay split, and the SoilGrids uncertainty, always framed as a
 * MODELLED ESTIMATE (never a lab result). Mounted in the location-map click
 * panel / parcel sheet and on the crop-planning field surface.
 *
 * `profile` is the `Parcel.soilJson` value (or null while the async fetch is
 * still pending — then we show the "soil pending" note, never a fabricated
 * value).
 */

import { useTranslations } from 'next-intl';
import type { SoilProfile } from '@/lib/soil/types';

export interface SoilProfileCardProps {
    profile: SoilProfile | null;
    /** Compact variant drops the sand/silt/clay + bulk-density detail rows. */
    compact?: boolean;
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-4">
            <span className="text-content-muted">{label}</span>
            <span className="text-content-default">{value}</span>
        </div>
    );
}

export function SoilProfileCard({ profile, compact }: SoilProfileCardProps) {
    const t = useTranslations('ag.soil');

    if (!profile) {
        return <p className="text-sm text-content-muted">{t('noSoilYet')}</p>;
    }

    const num = (v: number | null | undefined, digits = 1): string =>
        v == null ? '—' : v.toFixed(digits);
    const phUnc = profile.uncertainty?.phh2o?.uncertainty;

    return (
        <div className="space-y-default text-sm">
            <p className="font-medium text-content-emphasis">{t('profileTitle')}</p>
            <div className="space-y-tight">
                <Row label={t('texture')} value={profile.textureClass ?? '—'} />
                <Row
                    label={t('ph')}
                    value={
                        profile.phH2o == null
                            ? '—'
                            : phUnc != null
                                ? `${num(profile.phH2o)} (${t('uncertainty')} ${num(phUnc)})`
                                : num(profile.phH2o)
                    }
                />
                <Row label={t('soc')} value={t('unitGkg', { value: num(profile.socGkg) })} />
                {!compact && (
                    <>
                        <Row
                            label={t('sandSiltClay')}
                            value={`${num(profile.sandPct, 0)} / ${num(profile.siltPct, 0)} / ${num(profile.clayPct, 0)}`}
                        />
                        <Row
                            label={t('bulkDensity')}
                            value={t('unitGcm3', { value: num(profile.bulkDensity, 2) })}
                        />
                        <Row label={t('depth')} value={profile.depth} />
                    </>
                )}
            </div>
            <p className="text-xs text-content-muted">{t('estimate')}</p>
            <p className="text-xs text-content-muted">{t('attribution')}</p>
        </div>
    );
}
