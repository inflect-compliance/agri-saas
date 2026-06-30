/**
 * Epic 53 — Assets list page filter configuration.
 *
 * Keys align with `AssetQuerySchema`: type, status, criticality.
 */

import type { FilterDefInput } from '@/components/ui/filter/filter-definitions';
import {
    createTypedFilterDefs,
    optionsFromEnum,
} from '@/components/ui/filter/filter-definitions';
import { CircleDot, Flag, Layers } from 'lucide-react';

// Values MUST match the Prisma enums (AssetType, AssetStatus, Criticality) in
// schema.prisma — the UI selection is passed straight through to Prisma, so
// any label key not present in the DB enum produces
// PrismaClientValidationError on query and a 500 in the list page.
export const ASSET_TYPE_LABELS = {
    TRACTOR: 'Tractor',
    HARVESTER: 'Harvester',
    IMPLEMENT: 'Implement',
    VEHICLE: 'Vehicle',
    IRRIGATION: 'Irrigation',
    BUILDING: 'Building',
    STORAGE: 'Storage',
    LIVESTOCK_EQUIPMENT: 'Livestock Equipment',
    TOOL: 'Tool',
    OTHER: 'Other',
} as const;

export const ASSET_STATUS_LABELS = {
    ACTIVE: 'Active',
    IN_MAINTENANCE: 'In maintenance',
    RETIRED: 'Retired',
} as const;

export const ASSET_CRITICALITY_LABELS = {
    LOW: 'Low',
    MEDIUM: 'Medium',
    HIGH: 'High',
} as const;

const STATIC_DEFS = {
    type: {
        label: 'Type',
        description: 'Equipment category.',
        group: 'Attributes',
        icon: Layers,
        options: optionsFromEnum(ASSET_TYPE_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
    status: {
        label: 'Status',
        description: 'Asset lifecycle state.',
        group: 'Attributes',
        icon: CircleDot,
        options: optionsFromEnum(ASSET_STATUS_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
    criticality: {
        label: 'Criticality',
        description: 'Operational importance to the farm.',
        group: 'Quantitative',
        icon: Flag,
        options: optionsFromEnum(ASSET_CRITICALITY_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
} satisfies Record<string, FilterDefInput>;

export const assetFilterDefs = createTypedFilterDefs()(STATIC_DEFS);
export const ASSET_FILTER_KEYS = assetFilterDefs.filterKeys;

export function buildAssetFilters() {
    return assetFilterDefs.filters;
}
