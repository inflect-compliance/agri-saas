/** @jest-environment jsdom */
/**
 * Dashboard "Market trends" widget — headline price + sparkline, whole-card
 * tap-through to the Trends page. The sparkline (visx) is stubbed.
 */
import { render, screen } from '@testing-library/react';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantHref: () => (path: string) => `/t/acme${path}`,
}));

jest.mock('@/components/ui/mini-area-chart', () => ({
    MiniAreaChart: (props: { 'aria-label': string }) => (
        <div data-testid="sparkline" aria-label={props['aria-label']} />
    ),
}));

const useTenantSWR = jest.fn();
jest.mock('@/lib/hooks/use-tenant-swr', () => ({
    useTenantSWR: (...args: unknown[]) => useTenantSWR(...args),
}));

import { MarketTrendsWidget } from '@/components/trends/MarketTrendsWidget';

describe('MarketTrendsWidget', () => {
    beforeEach(() => useTenantSWR.mockReset());

    it('renders headline price + sparkline and taps through to /trends', () => {
        useTenantSWR.mockReturnValue({
            data: {
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
                ],
            },
        });
        render(<MarketTrendsWidget />);
        expect(screen.getByText('212')).toBeInTheDocument();
        expect(screen.getByTestId('sparkline')).toBeInTheDocument();
        // Whole-card tap-through.
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/t/acme/trends');
    });

    it('shows a muted empty state (still tappable) when there is no data', () => {
        useTenantSWR.mockReturnValue({
            data: { commodity: 'wheat', range: '3m', series: [] },
        });
        render(<MarketTrendsWidget />);
        expect(screen.getByText('widget.empty')).toBeInTheDocument();
        expect(screen.getByRole('link')).toHaveAttribute('href', '/t/acme/trends');
    });
});
