/**
 * Grain contracts list page filter configuration (Epic 53).
 *
 * Declarative filter defs for the Contracts list toolbar. Keys map 1:1
 * onto the API query parameters accepted by
 * `GET /api/t/:slug/grain/contracts`:
 *
 *   q       → free-text search (managed by useFilterContext's search slot;
 *             the contracts API does not filter server-side on q, so the
 *             FilterToolbar live search filters the loaded rows in-memory)
 *   status  → ContractStatus enum
 *   type    → ContractType enum (SALE | PURCHASE)
 *
 * `seasonId` is intentionally excluded from the toolbar — season is a
 * create-time relation, not a list facet the operator reaches for. The
 * API still accepts ?seasonId= for deep links if needed.
 *
 * This module is the single source of truth for the Contracts filter
 * contract. Do not scatter filter logic back into the page; extend the
 * config instead.
 */

// Import from concrete sub-modules (not the barrel) so jest's node env can
// require this file without transitively pulling the tsx components.
import type {
    FilterDef,
    FilterDefInput,
} from '@/components/ui/filter/filter-definitions';
import {
    createTypedFilterDefs,
    optionsFromEnum,
} from '@/components/ui/filter/filter-definitions';
// Icons are Nucleo (the canonical family) cast to the icon shape the
// `FilterDefInput` contract types — the cast is sourced from the contract
// type itself, so this file never depends on the legacy lucide package
// (keeping it off the Nucleo-migration allowlist). Same precedent as
// `planning/filter-defs.ts`.
import {
    CircleDotted,
    ArrowsOppositeDirectionX,
} from '@/components/ui/icons/nucleo';

/** The icon shape the filter contract expects, derived from the contract
 *  type itself (no direct legacy-icon-package dependency). */
type FilterIcon = FilterDefInput['icon'];
const asIcon = (c: unknown): FilterIcon => c as FilterIcon;

/** A next-intl translator scoped to the `grainEnums` namespace. */
type Translator = (key: string) => string;

// ─── Static labels (enum copy lives here, not in the client) ─────────
//
// English fallbacks kept as the source of truth for `optionsFromEnum`
// (used by the create/edit form modal). The Contracts filter toolbar
// overrides these with translated copy via `buildContractFilters(t)`.

export const CONTRACT_STATUS_LABELS = {
    DRAFT: 'Draft',
    ACTIVE: 'Active',
    DELIVERED: 'Delivered',
    SETTLED: 'Settled',
    CANCELLED: 'Cancelled',
} as const;

export const CONTRACT_TYPE_LABELS = {
    SALE: 'Sale',
    PURCHASE: 'Purchase',
} as const;

// ─── Static filter definitions ───────────────────────────────────────

const STATIC_DEFS = {
    status: {
        label: 'Status',
        labelPlural: 'Statuses',
        description: 'Lifecycle stage of the contract.',
        group: 'Attributes',
        icon: asIcon(CircleDotted),
        options: optionsFromEnum(CONTRACT_STATUS_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
    type: {
        label: 'Type',
        labelPlural: 'Types',
        description: 'Whether the contract sells produce or buys inputs.',
        group: 'Attributes',
        icon: asIcon(ArrowsOppositeDirectionX),
        options: optionsFromEnum(CONTRACT_TYPE_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
} satisfies Record<string, FilterDefInput>;

// ─── Public API ──────────────────────────────────────────────────────

export const contractFilterDefs = createTypedFilterDefs()(STATIC_DEFS);

/** URL param keys managed by the Contracts filter set. `q` is the
 * separate search slot owned by `useFilterContext`. */
export const CONTRACT_FILTER_KEYS = contractFilterDefs.filterKeys;

/** Produce the Filter[] array FilterToolbar consumes. Both facets are
 * static (enum-backed); the builder takes a `grainEnums` translator so the
 * facet labels + enum option labels render in the active locale. */
export function buildContractFilters(t: Translator): FilterDef[] {
    return contractFilterDefs.filters.map((f) => {
        if (f.key === 'status') {
            return {
                ...f,
                label: t('status'),
                labelPlural: t('statuses'),
                options: optionsFromEnum({
                    DRAFT: t('statusDraft'),
                    ACTIVE: t('statusActive'),
                    DELIVERED: t('statusDelivered'),
                    SETTLED: t('statusSettled'),
                    CANCELLED: t('statusCancelled'),
                }),
            };
        }
        if (f.key === 'type') {
            return {
                ...f,
                label: t('type'),
                labelPlural: t('types'),
                options: optionsFromEnum({
                    SALE: t('typeSale'),
                    PURCHASE: t('typePurchase'),
                }),
            };
        }
        return f;
    });
}
