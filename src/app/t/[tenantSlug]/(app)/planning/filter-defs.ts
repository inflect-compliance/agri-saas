/**
 * Crop-plan list-page filter configuration.
 *
 * Keys align with the crop-plans GET query: status, seasonId, cropTypeId.
 * The `status` values MUST match the Prisma `CropPlanStatus` enum — the UI
 * selection passes straight through to Prisma; `seasonId` / `cropTypeId`
 * options are injected at runtime from the catalog the page loads.
 *
 * Icons are Nucleo (the canonical family) cast to the icon shape the
 * `FilterDefInput` contract types. The cast is sourced from
 * `FilterDefInput['icon']` so this new file never reaches for the
 * legacy icon package — keeping it off the Nucleo-migration allowlist.
 */

import type { FilterDefInput } from '@/components/ui/filter/filter-definitions';
import {
    createTypedFilterDefs,
    optionsFromEnum,
} from '@/components/ui/filter/filter-definitions';
import type { FilterType } from '@/components/ui/filter';
import type { FilterOption } from '@/components/ui/filter/types';
import type { useTranslations } from 'next-intl';
import { CircleDotted, CalendarIcon } from '@/components/ui/icons/nucleo';

/** The icon shape the filter contract expects, derived from the
 *  contract type itself (no direct legacy-icon-package dependency). */
type FilterIcon = FilterDefInput['icon'];
const asIcon = (c: unknown): FilterIcon => c as FilterIcon;

export const CROP_PLAN_STATUS_LABELS = {
    DRAFT: 'Draft',
    ACTIVE: 'Active',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
} as const;

const STATIC_DEFS = {
    status: {
        label: 'Status',
        description: 'Plan lifecycle status.',
        group: 'Attributes',
        icon: asIcon(CircleDotted),
        options: optionsFromEnum(CROP_PLAN_STATUS_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
    // Season + crop are tenant-specific — the filter KEYS map straight to the
    // crop-plans GET query (?seasonId / ?cropTypeId). `options: null` marks
    // them as runtime-derived; `buildPlanningFilters` swaps in the real
    // options from the seasons / crop types the page already loaded.
    seasonId: {
        label: 'Season',
        description: 'Filter to plans in a season.',
        group: 'Attributes',
        icon: asIcon(CalendarIcon),
        options: null,
        resetBehavior: 'clearable',
    },
    cropTypeId: {
        label: 'Crop',
        description: 'Filter to plans of a crop type.',
        group: 'Attributes',
        icon: asIcon(CircleDotted),
        options: null,
        shouldFilter: true,
        resetBehavior: 'clearable',
    },
} satisfies Record<string, FilterDefInput>;

export const cropPlanFilterDefs = createTypedFilterDefs()(STATIC_DEFS);
export const CROP_PLAN_FILTER_KEYS = cropPlanFilterDefs.filterKeys;

interface NamedOption {
    id: string;
    name: string;
}

/**
 * Localize the crop-plan filter defs + inject the runtime-derived season /
 * crop options from the catalog the page already loaded. Enum VALUES
 * (option `value`s, filter keys, icons) are preserved; only display labels
 * are localized. `t` is a `useTranslations('planningEnums')` translator.
 */
export function buildPlanningFilters(
    t: ReturnType<typeof useTranslations>,
    seasons: ReadonlyArray<NamedOption> = [],
    cropTypes: ReadonlyArray<NamedOption> = [],
): FilterType[] {
    const toOptions = (rows: ReadonlyArray<NamedOption>): FilterOption[] =>
        rows.map((r) => ({ value: r.id, label: r.name }));
    const seasonOpts = toOptions(seasons);
    const cropOpts = toOptions(cropTypes);

    return cropPlanFilterDefs.filters.map((f) => {
        if (f.key === 'status') {
            return {
                ...f,
                label: t('filter.status'),
                options: f.options
                    ? f.options.map((o) => ({ ...o, label: t(`status.${o.value}`) }))
                    : f.options,
            };
        }
        if (f.key === 'seasonId') return { ...f, label: t('filter.season'), options: seasonOpts };
        if (f.key === 'cropTypeId') return { ...f, label: t('filter.crop'), options: cropOpts };
        return f;
    });
}
