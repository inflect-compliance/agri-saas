/**
 * Epic 53 — Exchange browse filters.
 *
 * `side` + `region` are static option sets (region from bulgaria-regions.ts);
 * `commodity` options are runtime-derived from the fetched listings via
 * `buildExchangeFilters(offers)`; `quantity` is a numeric min/max range.
 * Filtering is CLIENT-SIDE over the fetched listing array (browse-only).
 */
import type { FilterDefInput } from '@/components/ui/filter/filter-definitions';
import { createTypedFilterDefs } from '@/components/ui/filter/filter-definitions';
import type { FilterType } from '@/components/ui/filter';
import { ArrowLeftRight, MapPin, Scale, Wheat, Tag } from 'lucide-react';
import { BULGARIA_REGIONS } from '@/lib/geo/bulgaria-regions';

const REGION_OPTIONS = BULGARIA_REGIONS.map((r) => ({
    value: r.code,
    label: `${r.nameBg} / ${r.nameEn}`,
}));

const STATIC_DEFS = {
    side: {
        label: 'Side',
        description: 'Sellers offering (SELL) vs buyers seeking (BUY).',
        group: 'Attributes',
        icon: ArrowLeftRight,
        options: [
            { value: 'SELL', label: 'Selling' },
            { value: 'BUY', label: 'Buying' },
        ],
        multiple: true,
        resetBehavior: 'clearable',
    },
    kind: {
        label: 'Type',
        description: 'Product class — culture, fertilizer, seeds, or product.',
        group: 'Attributes',
        icon: Tag,
        options: [
            { value: 'CULTURE', label: 'Culture' },
            { value: 'FERTILIZER', label: 'Fertilizer' },
            { value: 'SEEDS', label: 'Seeds' },
            { value: 'PRODUCT', label: 'Product' },
        ],
        multiple: true,
        resetBehavior: 'clearable',
    },
    commodity: {
        label: 'Commodity',
        description: 'The crop / product on offer.',
        group: 'Attributes',
        icon: Wheat,
        // Runtime-derived from the fetched listings — see buildExchangeFilters.
        options: null,
        multiple: true,
        resetBehavior: 'clearable',
    },
    region: {
        label: 'Region',
        description: 'Bulgarian oblast. Also set by clicking the map.',
        group: 'Location',
        icon: MapPin,
        options: REGION_OPTIONS,
        multiple: true,
        resetBehavior: 'clearable',
    },
    quantity: {
        label: 'Quantity (t)',
        description: 'Tonnes on offer.',
        group: 'Quantitative',
        icon: Scale,
        options: null,
        type: 'range',
        hideOperator: true,
        rangeNumberStep: 1,
        formatRangeBound: (n: number) => String(n),
        formatRangePillLabel: (token: string) => {
            const [min, max] = token.split('|');
            const fmt = (raw: string) => (raw === '' ? '—' : raw);
            return `${fmt(min)}–${fmt(max)} t`;
        },
        resetBehavior: 'clearable',
    },
} satisfies Record<string, FilterDefInput>;

export const exchangeFilterDefs = createTypedFilterDefs()(STATIC_DEFS);
export const EXCHANGE_FILTER_KEYS = exchangeFilterDefs.filterKeys;

/** Inject runtime commodity options (distinct commodities from the feed). */
export function buildExchangeFilters(commodities: readonly string[]): FilterType[] {
    const options = Array.from(new Set(commodities))
        .sort((a, b) => a.localeCompare(b))
        .map((c) => ({ value: c, label: c }));
    return exchangeFilterDefs.filters.map((f) =>
        f.key === 'commodity' ? { ...f, options } : f,
    );
}
