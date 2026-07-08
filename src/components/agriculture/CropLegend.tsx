'use client';

import { useTranslations } from 'next-intl';
import { CropGlyph } from './CropGlyph';

export interface CropLegendProps {
    /** Distinct crop values present on the map, in display order. */
    crops: string[];
}

/**
 * Compact legend for the Location-map crop-icon overlay (#1). Mirrors
 * `SoilLegend`: one row per crop present, glyph + label. `crops` carries the
 * catalogue `value` strings (also the display label); an off-catalogue value
 * still renders (with the generic sprout glyph). Rendered by the host page
 * beside the map, only when at least one crop is present.
 */
export function CropLegend({ crops }: CropLegendProps) {
    const t = useTranslations('ag.crop');
    if (crops.length === 0) return null;
    return (
        <div className="rounded-md border border-border-subtle bg-bg-default p-3 text-sm">
            <p className="mb-2 font-medium text-content-emphasis">{t('legendTitle')}</p>
            <ul className="space-y-1">
                {crops.map((crop) => (
                    <li key={crop} className="flex items-center gap-tight">
                        <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-content-emphasis">
                            <CropGlyph crop={crop} className="h-4 w-4" />
                        </span>
                        <span className="text-content-default">{crop}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
