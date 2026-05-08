'use client';

/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Epic 53 — canonical filter toolbar for list pages.
 *
 * Composes the shared `FilterSelect` picker + `FilterList` active-pill strip
 * + a standardised free-text search input. Every migrated list page wires
 * this one component at its toolbar position; the filter definitions
 * (enum options, groups, range configs) come from that page's own
 * `filter-defs.ts`, so the toolbar stays entity-agnostic.
 *
 * Must be rendered inside a `<FilterProvider>` — it consumes state via
 * `useFilters()`. Page authors typically wrap their client component with
 * `FilterProvider` at the outer boundary (see any migrated *Client.tsx for
 * the pattern).
 *
 * Keyboard / a11y: the shared FilterSelect carries the `f` shortcut, Escape
 * cascade, and keyboard-driven option navigation. The search input uses
 * `type="search"` so browsers expose a clear affordance; commit semantics
 * match the pre-Epic 53 filter bar: commit on Enter + blur.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    Filter as FilterUI,
    filterStateToActiveFilters,
    useFilters,
    type ActiveFilter,
    type FilterType,
} from '@/components/ui/filter';

export interface FilterToolbarProps {
    /**
     * Resolved filter definitions for this page. Include any runtime-derived
     * options (owner / category lookups built from loaded rows).
     */
    filters: FilterType[];
    /**
     * DOM id of the search input. Every page uses a stable id (e.g.
     * `control-search`) so E2E tests and power users' browser shortcuts can
     * locate it. The id IS the page-specific part of this toolbar.
     */
    searchId: string;
    /** Placeholder text (usually "Search {entityPlural}…"). */
    searchPlaceholder: string;
    /** Optional label for the FilterSelect trigger button. Defaults to "Filter". */
    triggerLabel?: ReactNode;
    /**
     * Slot rendered on the right side of the toolbar — typically the
     * DataTable's `<EditColumnsButton>` so column visibility lives at the
     * same eye-line as the filter controls. Pass a React element or a
     * render-prop function for more flexibility.
     */
    actions?: ReactNode;
    /** Optional className forwarded to the outer container. */
    className?: string;
}

/**
 * Dispatch a FilterSelect `onSelect` into the shared context, picking
 * `toggle` / `set` based on the filter definition's `multiple` / `type`.
 * Extracted here so every page calls the same branching logic.
 */
function dispatchOnSelect(
    filters: FilterType[],
    ctx: ReturnType<typeof useFilters>,
    key: string,
    value: string | string[],
): void {
    if (Array.isArray(value)) {
        for (const v of value) ctx.toggle(key, String(v));
        return;
    }
    const def = filters.find((f) => f.key === key);
    if (def?.type === 'range') {
        ctx.set(key, String(value));
    } else if (def?.multiple) {
        ctx.toggle(key, String(value));
    } else {
        ctx.set(key, String(value));
    }
}

export function FilterToolbar({
    filters,
    searchId,
    searchPlaceholder,
    triggerLabel,
    actions,
    className,
}: FilterToolbarProps) {
    const ctx = useFilters();
    const { remove, removeAll, clearAll, search, setSearch, state } = ctx;

    // Local draft so typing doesn't churn the URL on every keystroke —
    // committed on Enter or blur, matching the pre-Epic 53 filter-bar UX.
    const [draft, setDraft] = useState(search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => setDraft(search), [search]);

    const activeFilters: ActiveFilter[] = useMemo(
        () => filterStateToActiveFilters(state),
        [state],
    );

    return (
        <div className={`flex flex-wrap items-start gap-3${className ? ` ${className}` : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    id={searchId}
                    type="search"
                    className="input w-full sm:w-64 text-sm"
                    placeholder={searchPlaceholder}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            setSearch(draft);
                        }
                    }}
                    onBlur={() => { if (draft !== search) setSearch(draft); }}
                />
                <FilterUI.Select
                    filters={filters}
                    activeFilters={activeFilters}
                    onSelect={(key, value) => dispatchOnSelect(filters, ctx, String(key), value as string | string[])}
                    onRemove={(key, value) => remove(String(key), String(value))}
                    onRemoveFilter={(key) => removeAll(String(key))}
                    className="h-9"
                >
                    {triggerLabel ?? 'Filter'}
                </FilterUI.Select>
            </div>
            <div className="flex-1 min-w-0">
                <FilterUI.List
                    filters={filters}
                    activeFilters={activeFilters}
                    onRemove={(key, value) => remove(String(key), String(value))}
                    onRemoveFilter={(key) => removeAll(String(key))}
                    onRemoveAll={clearAll}
                />
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
    );
}
