/** @jest-environment jsdom */
/**
 * Trends → News tab. Pins the states (loading / empty+operator / no-matches /
 * ready), the card content (category badge, external link, source), the
 * category-filter refetch wiring, and the LIVE keyword search (client-side,
 * filters the visible cards as the user types).
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

const twoItems = {
    category: 'all',
    items: [
        item(),
        item({ id: 'n2', title: 'Субсидии по ДФЗ', summary: 'Директни плащания', category: 'policy', url: 'https://x/2' }),
    ],
};

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
        useTenantSWR.mockReturnValue({ data: twoItems, error: undefined });
        render(<NewsTab />);

        expect(screen.getByText('Цената на пшеницата се покачва')).toBeInTheDocument();
        expect(screen.getByText('Субсидии по ДФЗ')).toBeInTheDocument();
        expect(screen.getByText('news.categories.market')).toBeInTheDocument();
        expect(screen.getByText('news.categories.policy')).toBeInTheDocument();

        const link = screen.getByText('Цената на пшеницата се покачва').closest('a')!;
        expect(link).toHaveAttribute('href', 'https://agri.bg/news/1');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('reads the "all" feed by default and refetches with the category on filter click', () => {
        useTenantSWR.mockReturnValue({ data: { category: 'all', items: [] }, error: undefined });
        render(<NewsTab />);
        expect(useTenantSWR).toHaveBeenCalledWith('/trends/news?category=all');
        fireEvent.click(screen.getByRole('tab', { name: 'news.filters.policy' }));
        expect(useTenantSWR).toHaveBeenLastCalledWith('/trends/news?category=policy');
    });

    it('filters the visible cards LIVE as the user types (title/summary/source)', () => {
        useTenantSWR.mockReturnValue({ data: twoItems, error: undefined });
        render(<NewsTab />);
        // Both visible before typing.
        expect(screen.getByText('Цената на пшеницата се покачва')).toBeInTheDocument();
        expect(screen.getByText('Субсидии по ДФЗ')).toBeInTheDocument();

        // Type a keyword that only the wheat item matches.
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'пшеницата' } });
        expect(screen.getByText('Цената на пшеницата се покачва')).toBeInTheDocument();
        expect(screen.queryByText('Субсидии по ДФЗ')).not.toBeInTheDocument();

        // Match on the summary text of the other item instead.
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'плащания' } });
        expect(screen.getByText('Субсидии по ДФЗ')).toBeInTheDocument();
        expect(screen.queryByText('Цената на пшеницата се покачва')).not.toBeInTheDocument();
    });

    it('shows a no-matches state (not the operator hint) when the search matches nothing', () => {
        useTenantSWR.mockReturnValue({ data: twoItems, error: undefined });
        render(<NewsTab />);
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzznotfound' } });
        expect(screen.getByTestId('trends-news-no-matches')).toBeInTheDocument();
        // Not the "no feed configured" operator hint.
        expect(screen.queryByTestId('trends-news-operator-hint')).not.toBeInTheDocument();
    });

    it('is case-insensitive', () => {
        useTenantSWR.mockReturnValue({ data: twoItems, error: undefined });
        render(<NewsTab />);
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ПШЕНИЦАТА' } });
        expect(screen.getByText('Цената на пшеницата се покачва')).toBeInTheDocument();
        expect(screen.queryByText('Субсидии по ДФЗ')).not.toBeInTheDocument();
    });
});
