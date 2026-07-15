/** @jest-environment jsdom */
/**
 * Trends page client shell — two tabs (Prices / News), Prices active by
 * default, switching mounts the other panel. The tab children are stubbed so
 * this test stays focused on the tab wiring (their own tests cover content).
 */
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

jest.mock('@/components/trends/PricesTab', () => ({
    PricesTab: () => <div data-testid="prices-tab-body" />,
}));
jest.mock('@/components/trends/NewsTab', () => ({
    NewsTab: () => <div data-testid="news-tab-body" />,
}));

import { TrendsPageClient } from '@/components/trends/TrendsPageClient';

describe('TrendsPageClient', () => {
    it('renders both tabs with Prices active by default', () => {
        render(<TrendsPageClient />);
        expect(screen.getByRole('tab', { name: 'tabs.prices' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByRole('tab', { name: 'tabs.news' })).toHaveAttribute(
            'aria-selected',
            'false',
        );
        expect(screen.getByTestId('prices-tab-body')).toBeInTheDocument();
        expect(screen.queryByTestId('news-tab-body')).not.toBeInTheDocument();
    });

    it('switches to the News tab on click', () => {
        render(<TrendsPageClient />);
        fireEvent.click(screen.getByRole('tab', { name: 'tabs.news' }));
        expect(screen.getByTestId('news-tab-body')).toBeInTheDocument();
        expect(screen.queryByTestId('prices-tab-body')).not.toBeInTheDocument();
    });
});
