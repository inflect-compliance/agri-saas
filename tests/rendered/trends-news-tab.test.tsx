/** @jest-environment jsdom */
/**
 * Trends → News tab. Pins the three states (loading / empty+operator / ready),
 * the card content (category badge, external link, source), and the category-
 * filter refetch wiring (clicking a filter re-reads with the new SWR key).
 */
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

const useTenantSWR = jest.fn();
jest.mock('@/lib/hooks/use-tenant-swr', () => ({
    useTenantSWR: (...args: unknown[]) => useTenantSWR(...args),
}));

import { NewsTab } from '@/components/trends/NewsTab';

const item = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    source: 'agri-bg',
    category: 'market',
    title: 'Цената на пшеницата се покачва',
    summary: 'Пазарен обзор за седмицата.',
    url: 'https://agri.bg/news/1',
    imageUrl: null,
    publishedAt: '2026-07-14T09:30:00.000Z',
    ...over,
});

beforeEach(() => useTenantSWR.mockReset());

describe('NewsTab', () => {
    it('renders the loading skeletons while data is pending', () => {
        useTenantSWR.mockReturnValue({ data: undefined, error: undefined });
        render(<NewsTab />);
        expect(screen.getByTestId('trends-news-loading')).toBeInTheDocument();
    });

    it('renders the combined empty + operator hint when the feed is empty', () => {
        useTenantSWR.mockReturnValue({ data: { category: 'all', items: [] }, error: undefined });
        render(<NewsTab />);
        expect(screen.getByTestId('trends-news-empty')).toBeInTheDocument();
        expect(screen.getByTestId('trends-news-operator-hint')).toBeInTheDocument();
    });

    it('renders the empty state on a fetch error', () => {
        useTenantSWR.mockReturnValue({ data: undefined, error: new Error('boom') });
        render(<NewsTab />);
        expect(screen.getByTestId('trends-news-empty')).toBeInTheDocument();
    });

    it('renders a card per item — title, source, category badge, external link', () => {
        useTenantSWR.mockReturnValue({
            data: { category: 'all', items: [item(), item({ id: 'n2', title: 'Субсидии', category: 'policy', url: 'https://x/2' })] },
            error: undefined,
        });
        render(<NewsTab />);

        expect(screen.getByText('Цената на пшеницата се покачва')).toBeInTheDocument();
        expect(screen.getByText('Субсидии')).toBeInTheDocument();
        expect(screen.getAllByText('agri-bg')).toHaveLength(2);

        // Category badge labels come through the i18n key path.
        expect(screen.getByText('news.categories.market')).toBeInTheDocument();
        expect(screen.getByText('news.categories.policy')).toBeInTheDocument();

        // Each card links out safely.
        const link = screen.getByText('Цената на пшеницата се покачва').closest('a')!;
        expect(link).toHaveAttribute('href', 'https://agri.bg/news/1');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('reads the "all" feed by default and refetches with the category on filter click', () => {
        useTenantSWR.mockReturnValue({ data: { category: 'all', items: [] }, error: undefined });
        render(<NewsTab />);

        // Default filter → the all-categories key.
        expect(useTenantSWR).toHaveBeenCalledWith('/trends/news?category=all');

        // Click the "Policy" filter tab → refetch with the policy key.
        fireEvent.click(screen.getByRole('tab', { name: 'news.filters.policy' }));
        expect(useTenantSWR).toHaveBeenLastCalledWith('/trends/news?category=policy');
    });
});
