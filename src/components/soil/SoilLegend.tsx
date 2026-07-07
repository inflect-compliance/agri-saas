'use client';

/**
 * Soil-view map legend (#37) — one colour-swatch row per soil texture class
 * present on the map, plus a "soil pending" row when any parcel lacks soil.
 * Colours come from the colour-blind-safe palette in `@/lib/soil/types` so
 * the legend and the map fills always agree.
 *
 * Mirrors the inline vegetation-index legend on the location map, but as a
 * reusable component (the location map AND the crop-planning map both mount
 * it). Ends with the SoilGrids attribution + a "modelled estimate" note so
 * the estimate framing travels with the colours.
 */

import { useTranslations } from 'next-intl';
import {
    SOIL_TEXTURE_COLORS,
    SOIL_PENDING_COLOR,
} from '@/lib/soil/types';
import type { UsdaTextureClass } from '@/lib/soil/texture';

export interface SoilLegendProps {
    /** Texture classes currently shown on the map (deduped, ordered). */
    classes: UsdaTextureClass[];
    /** Whether any parcel is awaiting a soil reading. */
    hasPending?: boolean;
}

export function SoilLegend({ classes, hasPending }: SoilLegendProps) {
    const t = useTranslations('ag.soil');

    return (
        <div className="rounded-md border border-border-subtle bg-bg-default p-3 text-sm">
            <p className="mb-2 font-medium text-content-emphasis">{t('legendTitle')}</p>
            <ul className="space-y-1">
                {classes.map((cls) => (
                    <li key={cls} className="flex items-center gap-2">
                        <span
                            className="inline-block h-3 w-3 flex-shrink-0 rounded-sm"
                            style={{ backgroundColor: SOIL_TEXTURE_COLORS[cls] }}
                            aria-hidden="true"
                        />
                        <span className="text-content-default">{cls}</span>
                    </li>
                ))}
                {hasPending && (
                    <li className="flex items-center gap-2">
                        <span
                            className="inline-block h-3 w-3 flex-shrink-0 rounded-sm border border-dashed border-content-muted"
                            style={{ backgroundColor: SOIL_PENDING_COLOR }}
                            aria-hidden="true"
                        />
                        <span className="text-content-muted">{t('pending')}</span>
                    </li>
                )}
            </ul>
            <p className="mt-2 border-t border-border-subtle pt-2 text-xs text-content-muted">
                {t('estimate')}
            </p>
            <p className="mt-1 text-xs text-content-muted">{t('attribution')}</p>
        </div>
    );
}
