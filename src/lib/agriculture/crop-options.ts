/**
 * Shared crop catalogue for the ag UI — the single source of truth for the
 * crop picker used on the Location parcels dropdown, the shapefile-import
 * crop step (#7), the map crop-icon table (#1), and crop planning (#9).
 *
 * Extracted from the previously page-local `CROP_OPTIONS` so every surface
 * that lets a user pick a parcel crop shares one list (and one season
 * grouping). `value` is what we persist to `Parcel.cropType`; `label` is the
 * display string; `meta.season` groups the options in the combobox.
 *
 * `ComboboxOption` is imported type-only (erased at build) — no runtime
 * dependency on the UI layer.
 */
import type { ComboboxOption } from '@/components/ui/combobox';

export const CROP_OPTIONS: ComboboxOption<{ season: string }>[] = [
    { value: 'Wheat', label: 'Wheat', meta: { season: 'Autumn crop' } },
    { value: 'Barley', label: 'Barley', meta: { season: 'Autumn crop' } },
    { value: 'Canola', label: 'Canola', meta: { season: 'Autumn crop' }, separatorAfter: true },
    { value: 'Maize', label: 'Maize', meta: { season: 'Spring crop' } },
    { value: 'Sunflower', label: 'Sunflower', meta: { season: 'Spring crop' } },
    { value: 'Peas', label: 'Peas', meta: { season: 'Spring crop' } },
];

/** The set of catalogue crop values, for validating a submitted cropType. */
export const CROP_VALUES: ReadonlySet<string> = new Set(CROP_OPTIONS.map((o) => o.value));
