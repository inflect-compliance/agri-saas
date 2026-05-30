/**
 * `<FilterToolbar>` live-search rendered tests.
 *
 * Locks the 2026-05-30 behaviour change: the filter-scoped search box
 * is LIVE. Typing commits the query to the FilterProvider on a short
 * debounce (table filters as you type, no Enter required); Enter still
 * commits immediately for users who reach for it.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

// FilterToolbar transitively uses Next router hooks via the filter
// system's URL-sync layer — mock them.
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/t/acme/controls',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { CheckCircle } from 'lucide-react';

import { FilterToolbar } from '@/components/filters/FilterToolbar';
import {
    createFilterDefs,
    FilterProvider,
    useFilterContext,
    useFilters,
} from '@/components/ui/filter';

const { filters: defs, filterKeys } = createFilterDefs({
    status: {
        label: 'Status',
        icon: CheckCircle,
        options: [{ value: 'A', label: 'A' }],
    },
});

// Surfaces the COMMITTED search (the value that drives the URL + data
// fetch) so the test can assert when the debounce has propagated.
function SearchProbe() {
    const { search } = useFilters();
    return <output data-testid="committed-search">{search}</output>;
}

function Shell() {
    const ctx = useFilterContext(defs, filterKeys);
    return (
        <FilterProvider value={ctx}>
            <FilterToolbar
                filters={defs}
                searchId="probe-search"
                searchPlaceholder="Search…"
            />
            <SearchProbe />
        </FilterProvider>
    );
}

describe('FilterToolbar — live search', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
    });

    it('commits the typed query after the debounce — no Enter needed', () => {
        render(<Shell />);
        const input = document.getElementById(
            'probe-search',
        ) as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(screen.getByTestId('committed-search').textContent).toBe('');

        fireEvent.change(input, { target: { value: 'iso' } });
        // Still debounced — the committed query has not changed yet.
        expect(screen.getByTestId('committed-search').textContent).toBe('');

        act(() => {
            jest.advanceTimersByTime(300);
        });
        // Now the live query has propagated without any Enter press.
        expect(screen.getByTestId('committed-search').textContent).toBe('iso');
    });

    it('commits immediately on Enter, bypassing the debounce', () => {
        render(<Shell />);
        const input = document.getElementById(
            'probe-search',
        ) as HTMLInputElement;

        fireEvent.change(input, { target: { value: 'soc2' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        // Committed without advancing the debounce timer.
        expect(screen.getByTestId('committed-search').textContent).toBe('soc2');
    });
});
