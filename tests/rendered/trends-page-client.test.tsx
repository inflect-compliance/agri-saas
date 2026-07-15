/** @jest-environment jsdom */
/**
 * Trends page client shell — Prices only (News was decoupled into its own
 * `/news` destination). The Prices tab body is stubbed; this test pins that the
 * shell renders the heading + Prices content and no longer mounts a tab bar.
 */
import { render, screen } from '@testing-library/react';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

jest.mock('@/components/trends/PricesTab', () => ({
    PricesTab: () => <div data-testid="prices-tab-body" />,
}));

import { TrendsPageClient } from '@/components/trends/TrendsPageClient';

describe('TrendsPageClient', () => {
    it('renders the heading + Prices content', () => {
        render(<TrendsPageClient />);
        expect(screen.getByRole('heading', { name: 'title' })).toBeInTheDocument();
        expect(screen.getByTestId('prices-tab-body')).toBeInTheDocument();
    });

    it('no longer renders a tab bar (News moved to its own page)', () => {
        render(<TrendsPageClient />);
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });
});
