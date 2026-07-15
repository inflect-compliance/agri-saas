/** @jest-environment jsdom */
/**
 * Dashboard "Market trends" widget — a crop slideshow. Cycles wheat → maize →
 * barley → sunflower; auto-advances every 10s; manually slidable via prev/next
 * + dot indicators. The sparkline (visx) is stubbed; SWR is mocked so we can
 * assert which crop's series is being read as the slide changes.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';

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

const DATA = {
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
                label: 'Crop',
                points: [
                    { date: '2026-01-01', price: 200 },
                    { date: '2026-01-10', price: 212 },
                ],
            },
        ],
    },
};

/** The SWR key the widget reads for a given crop. */
const keyFor = (c: string) => `/trends/prices?commodity=${c}&range=3m`;

beforeEach(() => useTenantSWR.mockReset());

describe('MarketTrendsWidget slideshow', () => {
    it('starts on wheat — headline price, sparkline, tap-through to /trends', () => {
        useTenantSWR.mockReturnValue(DATA);
        render(<MarketTrendsWidget />);
        expect(screen.getByText('212')).toBeInTheDocument();
        expect(screen.getByTestId('sparkline')).toBeInTheDocument();
        expect(screen.getByText('commodities.wheat')).toBeInTheDocument();
        expect(useTenantSWR).toHaveBeenCalledWith(keyFor('wheat'));
        expect(screen.getByRole('link')).toHaveAttribute('href', '/t/acme/trends');
    });

    it('renders one dot per crop, the first selected', () => {
        useTenantSWR.mockReturnValue(DATA);
        render(<MarketTrendsWidget />);
        const dots = screen.getAllByRole('tab');
        expect(dots).toHaveLength(4);
        expect(dots[0]).toHaveAttribute('aria-selected', 'true');
        expect(dots[1]).toHaveAttribute('aria-selected', 'false');
    });

    it('Next advances to the following crop (reads its series)', () => {
        useTenantSWR.mockReturnValue(DATA);
        render(<MarketTrendsWidget />);
        fireEvent.click(screen.getByRole('button', { name: 'widget.next' }));
        expect(screen.getByText('commodities.maize')).toBeInTheDocument();
        expect(useTenantSWR).toHaveBeenLastCalledWith(keyFor('maize'));
    });

    it('Prev from the first crop wraps to the last (sunflower)', () => {
        useTenantSWR.mockReturnValue(DATA);
        render(<MarketTrendsWidget />);
        fireEvent.click(screen.getByRole('button', { name: 'widget.prev' }));
        expect(screen.getByText('commodities.sunflower')).toBeInTheDocument();
        expect(useTenantSWR).toHaveBeenLastCalledWith(keyFor('sunflower'));
    });

    it('a dot jumps directly to its crop', () => {
        useTenantSWR.mockReturnValue(DATA);
        render(<MarketTrendsWidget />);
        fireEvent.click(screen.getAllByRole('tab')[2]); // barley
        expect(screen.getByText('commodities.barley')).toBeInTheDocument();
        expect(useTenantSWR).toHaveBeenLastCalledWith(keyFor('barley'));
    });

    it('auto-advances to the next crop after 10s', () => {
        jest.useFakeTimers();
        try {
            useTenantSWR.mockReturnValue(DATA);
            render(<MarketTrendsWidget />);
            expect(screen.getByText('commodities.wheat')).toBeInTheDocument();
            act(() => {
                jest.advanceTimersByTime(10_000);
            });
            expect(screen.getByText('commodities.maize')).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('still renders a muted empty state (tap-through intact) with no data', () => {
        useTenantSWR.mockReturnValue({ data: { commodity: 'wheat', range: '3m', series: [] } });
        render(<MarketTrendsWidget />);
        expect(screen.getByText('widget.empty')).toBeInTheDocument();
        expect(screen.getByRole('link')).toHaveAttribute('href', '/t/acme/trends');
    });
});
