/**
 * R23-PR-B — Shared KPI filter hook.
 *
 * `useKpiFilter` turns a typed list of KPI definitions into the
 * minimum surface a `<KpiFilterCard>` consumer needs:
 *   • `activeKpiId` — which KPI's filter is currently applied, or
 *                     null if none / multiple match.
 *   • `toggle(id)`  — click handler. Activating an inactive KPI
 *                     applies its filter; clicking the active KPI
 *                     clears it.
 *
 * Design — KPI as a typed shortcut over the existing filter context
 *
 * The shared `FilterContextValue` from `@/components/ui/filter`
 * already owns:
 *   - the canonical filter state (Record<string, string[]>)
 *   - URL synchronisation
 *   - search query
 *   - filter pill UI + clearAll behaviour
 *
 * A KPI card is JUST a typed shortcut over that contract — clicking
 * it sets one or more keys to specific values. So the KPI definition
 * encodes (a) how to APPLY the shortcut and (b) how to RECOGNISE
 * whether it's currently active.
 *
 * Two predicate callbacks instead of a `target` shape — flexibility
 * outweighs sugar. Some KPIs map to a single key/value (Open →
 * status=OPEN). Others map to multi-key combinations (Critical →
 * impact=5,4 + likelihood=5,4). The two-callback shape covers both
 * without inflating the type surface.
 *
 * AND-composition with other filters
 *
 * The KPI filter does NOT replace the page's other filter state —
 * it sets keys via the same `ctx.set` / `ctx.add` that user-driven
 * filter dropdowns use. Two consequences:
 *   1. Other filters survive a KPI click (KPI is one dimension of
 *      AND-combined filtering, not a reset).
 *   2. The user can layer filters on top of the KPI shortcut. The
 *      KPI stays "active" as long as its keys match its target
 *      values, regardless of what other filter keys are set.
 *
 * URL sync
 *
 * Free — the underlying `FilterContextValue` URL-syncs all filter
 * state. When a KPI is active, the URL reflects the underlying
 * filter values (?status=OPEN), so reload / share / back-navigation
 * restore the active KPI via `isActive(state)` re-evaluation. R23
 * deliberately does NOT add a separate `?kpi=<id>` URL param — the
 * filter state IS the source of truth.
 *
 * Edge cases
 *
 *   • Multiple matches — if two KPIs both report `isActive(state)`
 *     true (e.g. their target predicates overlap), `activeKpiId`
 *     resolves to null. The page author owns the responsibility of
 *     defining mutually-exclusive KPIs; this hook just reports the
 *     ambiguity rather than picking a winner silently.
 *
 *   • No KPI defined as "all" — a page that wants an All / Total
 *     card defines a KPI whose `apply` is `ctx.clearAll()` and whose
 *     `isActive` is "no filters are set". The hook treats it like
 *     any other KPI; clicking the active "All" card is a no-op
 *     because clearing an empty state is idempotent.
 */
import { useCallback, useMemo } from "react";

import {
    useFilters,
    type FilterContextValue,
    type FilterState,
} from "@/components/ui/filter";

/**
 * A KPI's filter shortcut. The page provides `apply` (called when
 * the user clicks the card) and `isActive` (called on every filter-
 * state change to compute the selected affordance). An optional
 * `clear` lets the KPI scope its teardown to its own keys; when
 * omitted the toggle falls back to `ctx.clearAll()`.
 */
export interface KpiFilterDef<TKpiId extends string = string> {
    /** Stable id of this KPI. Used for selected-state tracking and as
     * the key the hook returns from `activeKpiId`. */
    id: TKpiId;
    /** Apply this KPI's filter operation. Receives the page's
     * `FilterContextValue` so the implementation can call any of
     * `set` / `add` / `toggle` / `clearAll` / `setSearch`. */
    apply: (ctx: FilterContextValue) => void;
    /** Returns true if this KPI is currently active, given the
     * current filter state. The hook calls this on every re-render;
     * keep the implementation pure + cheap (a few field reads). */
    isActive: (state: FilterState) => boolean;
    /**
     * R23-PR-C — granular teardown. When the user toggles OFF the
     * active KPI, the hook calls this callback so the KPI only
     * unwinds its own filter keys, leaving sibling state (search,
     * other dropdown filters, sort) intact.
     *
     * Default behaviour (omitted): falls back to `ctx.clearAll()`,
     * which is correct for an "all/total" KPI whose target state IS
     * "no filters" — clearing IS the deactivation. For KPIs that
     * own specific keys (status=OPEN, severity=CRITICAL, …), provide
     * a `clear` that only removes those keys (e.g.
     * `ctx.removeAll('status')`).
     */
    clear?: (ctx: FilterContextValue) => void;
}

export interface UseKpiFilterReturn<TKpiId extends string> {
    /** The id of the currently-active KPI, or null if none / multiple
     * KPIs match. */
    activeKpiId: TKpiId | null;
    /** Toggle: if the KPI is already active, clears the page's
     * filters; otherwise applies the KPI's filter. The Risks-page
     * "click to filter, click active card again to clear" contract. */
    toggle: (id: TKpiId) => void;
    /** Apply a KPI's filter without toggle semantics (always sets).
     * Useful for cases where the page wants explicit "this KPI is
     * now active" semantics independent of the previous state. */
    select: (id: TKpiId) => void;
    /** Clear the page's filters (and therefore deactivate any KPI). */
    clear: () => void;
}

export function useKpiFilter<TKpiId extends string>(
    defs: ReadonlyArray<KpiFilterDef<TKpiId>>,
): UseKpiFilterReturn<TKpiId> {
    const ctx = useFilters();

    const activeKpiId = useMemo<TKpiId | null>(() => {
        const matches = defs.filter((def) => def.isActive(ctx.state));
        if (matches.length !== 1) return null;
        return matches[0].id;
    }, [defs, ctx.state]);

    const apply = useCallback(
        (id: TKpiId) => {
            const def = defs.find((d) => d.id === id);
            if (!def) return;
            def.apply(ctx);
        },
        [defs, ctx],
    );

    const toggle = useCallback(
        (id: TKpiId) => {
            if (activeKpiId === id) {
                const def = defs.find((d) => d.id === id);
                if (def?.clear) {
                    def.clear(ctx);
                } else {
                    ctx.clearAll();
                }
                return;
            }
            apply(id);
        },
        [activeKpiId, apply, defs, ctx],
    );

    const clear = useCallback(() => {
        ctx.clearAll();
    }, [ctx]);

    return {
        activeKpiId,
        toggle,
        select: apply,
        clear,
    };
}
