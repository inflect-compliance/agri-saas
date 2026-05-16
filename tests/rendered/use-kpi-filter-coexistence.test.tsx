/**
 * R23-PR-C — `useKpiFilter` coexistence behavioural test.
 *
 * Locks the contract that the KPI filter composes with — rather
 * than replaces — sibling filter dimensions (search, dropdown
 * filters, other KPIs).
 *
 * Covered:
 *   1. Granular clear — when a KPI carries an optional `clear`
 *      callback, toggling it OFF unwinds only its own keys; sibling
 *      filter values + search query survive.
 *   2. Fallback clear — a KPI without `clear` falls back to
 *      `ctx.clearAll()` (the previous behaviour, correct for the
 *      "all/total" pattern).
 *   3. Coexistence AND-composition — when search and sibling filter
 *      keys are set, applying a KPI ADDS its keys without disturbing
 *      siblings.
 *
 * These behaviours are what makes the KPI a first-class shortcut
 * over the existing FilterContextValue rather than an isolated UI.
 */
import * as React from 'react';
import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

import {
    FilterProvider,
    type FilterContextValue,
    type FilterState,
} from '@/components/ui/filter';
import {
    useKpiFilter,
    type KpiFilterDef,
} from '@/components/ui/kpi-filter';

function makeMockCtx(initial: FilterState = {}, search = ''): {
    ctx: FilterContextValue;
    setSpy: jest.Mock;
    addSpy: jest.Mock;
    removeAllSpy: jest.Mock;
    clearAllSpy: jest.Mock;
} {
    let state = initial;
    let searchValue = search;
    const setSpy = jest.fn((key: string, value: string) => {
        state = { ...state, [key]: [value] };
    });
    const addSpy = jest.fn();
    const removeAllSpy = jest.fn((key: string) => {
        const { [key]: _removed, ...rest } = state;
        state = rest;
    });
    const clearAllSpy = jest.fn(() => {
        state = {};
        searchValue = '';
    });
    const ctx: FilterContextValue = {
        get state() {
            return state;
        },
        filters: [],
        filterKeys: [],
        set: setSpy,
        add: addSpy,
        remove: jest.fn(),
        removeAll: removeAllSpy,
        toggle: jest.fn(),
        clearAll: clearAllSpy,
        hasActive: false,
        activeCount: 0,
        get search() {
            return searchValue;
        },
        setSearch: jest.fn(),
    };
    return { ctx, setSpy, addSpy, removeAllSpy, clearAllSpy };
}

type KpiId = 'all' | 'open' | 'critical';

const defsGranular: ReadonlyArray<KpiFilterDef<KpiId>> = [
    {
        id: 'all',
        apply: (ctx) => ctx.clearAll(),
        isActive: (state) => Object.keys(state).length === 0,
        // No `clear` — falls back to clearAll, which is the
        // canonical behaviour for an "all" KPI.
    },
    {
        id: 'open',
        apply: (ctx) => ctx.set('status', 'OPEN'),
        isActive: (state) => (state.status ?? []).includes('OPEN'),
        // Granular teardown — removeAll('status') unwinds the KPI's
        // own key only.
        clear: (ctx) => ctx.removeAll('status'),
    },
    {
        id: 'critical',
        apply: (ctx) => ctx.set('severity', 'CRITICAL'),
        isActive: (state) => (state.severity ?? []).includes('CRITICAL'),
        clear: (ctx) => ctx.removeAll('severity'),
    },
];

describe('useKpiFilter — coexistence with sibling filter state', () => {
    it('granular `clear` removes only the KPI\'s own key (sibling filter survives)', () => {
        // Initial state: KPI 'open' is active (status=OPEN) AND a
        // sibling category filter is set. Toggling off the KPI
        // should remove `status` only — `category` survives.
        const { ctx, removeAllSpy } = makeMockCtx({
            status: ['OPEN'],
            category: ['IT-SECURITY'],
        });
        const { result } = renderHook(() => useKpiFilter(defsGranular), {
            wrapper: ({ children }) => (
                <FilterProvider value={ctx}>{children}</FilterProvider>
            ),
        });
        // Confirm active state.
        expect(result.current.activeKpiId).toBe('open');
        // Toggle the active KPI off.
        act(() => {
            result.current.toggle('open');
        });
        expect(removeAllSpy).toHaveBeenCalledWith('status');
        expect(removeAllSpy).not.toHaveBeenCalledWith('category');
    });

    it('fallback `clear` (no callback) calls ctx.clearAll', () => {
        // 'all' KPI has no `clear`. Toggling it off when active
        // should fall back to ctx.clearAll. Initial state is empty
        // (so 'all' is the active KPI per its isActive).
        const { ctx, clearAllSpy } = makeMockCtx({});
        const { result } = renderHook(() => useKpiFilter(defsGranular), {
            wrapper: ({ children }) => (
                <FilterProvider value={ctx}>{children}</FilterProvider>
            ),
        });
        expect(result.current.activeKpiId).toBe('all');
        act(() => {
            result.current.toggle('all');
        });
        expect(clearAllSpy).toHaveBeenCalled();
    });

    it('AND-composition — applying a KPI on top of sibling filters does not disturb them', () => {
        // Initial state: category=IT-SECURITY (a sibling filter).
        // Applying the 'open' KPI should call set('status', 'OPEN')
        // — the underlying FilterContextValue's `set` REPLACES the
        // status key but doesn't touch category. The shared filter
        // primitive owns that contract; the hook just delegates.
        const { ctx, setSpy } = makeMockCtx({
            category: ['IT-SECURITY'],
        });
        const { result } = renderHook(() => useKpiFilter(defsGranular), {
            wrapper: ({ children }) => (
                <FilterProvider value={ctx}>{children}</FilterProvider>
            ),
        });
        expect(result.current.activeKpiId).toBeNull(); // category-only matches no KPI
        act(() => {
            result.current.toggle('open');
        });
        expect(setSpy).toHaveBeenCalledWith('status', 'OPEN');
        // category was never touched by the KPI.
        expect(setSpy).not.toHaveBeenCalledWith('category', expect.anything());
    });

    it('switching between KPIs: applying a NEW KPI replaces the old one\'s key but preserves siblings', () => {
        // Initial state: status=OPEN ('open' KPI active) + a sibling
        // category filter. Toggle to 'critical' KPI — should call
        // set('severity', 'CRITICAL') which doesn't disturb status
        // OR category. The previous KPI's keys remain (status=OPEN
        // still present) — KPIs don't auto-clear the previous one;
        // page authors who want exclusivity define mutually-exclusive
        // predicates so only one isActive at a time.
        const { ctx, setSpy, removeAllSpy } = makeMockCtx({
            status: ['OPEN'],
            category: ['IT-SECURITY'],
        });
        const { result } = renderHook(() => useKpiFilter(defsGranular), {
            wrapper: ({ children }) => (
                <FilterProvider value={ctx}>{children}</FilterProvider>
            ),
        });
        expect(result.current.activeKpiId).toBe('open');
        act(() => {
            result.current.toggle('critical');
        });
        // Critical KPI applied — sets severity.
        expect(setSpy).toHaveBeenCalledWith('severity', 'CRITICAL');
        // Old KPI's `status` key was NOT auto-removed; the page
        // author owns mutual exclusivity via the predicate model.
        expect(removeAllSpy).not.toHaveBeenCalledWith('status');
    });
});
