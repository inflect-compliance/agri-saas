/** @jest-environment jsdom */
/**
 * Trends → Prices tab. The visx charts are stubbed (jsdom has no layout); these
 * tests pin the three states (loading / empty+operator / ready), the source
 * legend labels, and the commodity-picker + range-selector refetch wiring.
 */
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

// Stub the chart primitives — the tab's own contract (states, legend, tiles,
// SWR key) is what matters, not the visx render.
jest.mock('@/components/ui/charts', () => ({
    TimeSeriesChart: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="ts-chart">{children}</div>
    ),
    Areas: () => <div data-testid="areas" />,
    XAxis: () => null,
    YAxis: () => null,
}));

// A minimal Combobox stub that exposes a button per option.
jest.mock('@/components/ui/combobox', () => ({
    Combobox: ({
        options,
        setSelected,
    }: {
        options: Array<{ value: string; label: React.ReactNode }>;
        setSelected: (o: { value: string; label: React.ReactNode }) => void;
    }) => (
        <div>
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    data-testid={`cmbx-${o.value}`}
                    onClick={() => setSelected(o)}
                >
                    {o.value}
                </button>
            ))}
        </div>
    ),
}));

const useTenantSWR = jest.fn();
jest.mock('@/lib/hooks/use-tenant-swr', () => ({
    useTenantSWR: (...args: unknown[]) => useTenantSWR(...args),
}));

import { PricesTab } from '@/components/trends/PricesTab';

const READY = {
    commodity: 'wheat',
    range: '3m',
    series: [
        {
            source: 'ec-agrifood',
            region: 'BG',
            stage: 'delivered',
            unit: 'EUR/t',
            currency: 'EUR',
            label: 'Wheat',
            points: [
                { date: '2026-01-01', price: 200 },
                { date: '2026-01-10', price: 212 },
            ],
        },
        {
            source: 'listings',
            region: 'BG',
            stage: null,
            unit: 'BGN/t',
            currency: 'BGN',
            label: 'Own-listings median',
            points: [{ date: '2026-01-10', price: 400, count: 9 }],
        },
    ],
};

describe('PricesTab', () => {
    beforeEach(() => useTenantSWR.mockReset());

    it('renders a loading skeleton while the read is in flight', () => {
        useTenantSWR.mockReturnValue({ data: undefined, error: undefined });
        render(<PricesTab />);
        expect(screen.getByTestId('trends-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('ts-chart')).not.toBeInTheDocument();
    });

    it('renders the empty state + operator-configuration explainer on no data', () => {
        useTenantSWR.mockReturnValue({
            data: { commodity: 'wheat', range: '3m', series: [] },
            error: undefined,
        });
        render(<PricesTab />);
        expect(screen.getByTestId('trends-empty')).toBeInTheDocument();
        expect(screen.getByTestId('trends-operator-hint')).toBeInTheDocument();
        expect(screen.queryByTestId('ts-chart')).not.toBeInTheDocument();
    });

    it('renders source-tagged legend labels + charts when data is ready', () => {
        useTenantSWR.mockReturnValue({ data: READY, error: undefined });
        render(<PricesTab />);
        // One chart per unit-group (EUR/t + BGN/t = 2).
        expect(screen.getAllByTestId('ts-chart')).toHaveLength(2);
        // Source legend labels (mocked intl → the i18n key path renders).
        expect(screen.getAllByText('sources.official').length).toBeGreaterThan(0);
        expect(screen.getAllByText('sources.listings').length).toBeGreaterThan(0);
    });

    it('refetches when the range selector changes', () => {
        useTenantSWR.mockReturnValue({ data: READY, error: undefined });
        const { container } = render(<PricesTab />);
        expect(useTenantSWR).toHaveBeenCalledWith(
            '/trends/prices?commodity=wheat&range=3m',
        );
        const oneYear = container.querySelector('#trends-range-1y') as HTMLElement;
        fireEvent.click(oneYear);
        expect(useTenantSWR).toHaveBeenCalledWith(
            '/trends/prices?commodity=wheat&range=1y',
        );
    });

    it('refetches when the commodity picker changes', () => {
        useTenantSWR.mockReturnValue({ data: READY, error: undefined });
        render(<PricesTab />);
        fireEvent.click(screen.getByTestId('cmbx-maize'));
        expect(useTenantSWR).toHaveBeenCalledWith(
            '/trends/prices?commodity=maize&range=3m',
        );
    });
});
