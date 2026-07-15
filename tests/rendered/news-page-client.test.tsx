/** @jest-environment jsdom */
/**
 * News page client shell — the standalone destination (its own nav button +
 * `/news` route). The NewsTab feed is stubbed; this test pins that the shell
 * renders the heading + the feed.
 */
import { render, screen } from '@testing-library/react';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

jest.mock('@/components/trends/NewsTab', () => ({
    NewsTab: () => <div data-testid="news-tab-body" />,
}));

import { NewsPageClient } from '@/components/trends/NewsPageClient';

describe('NewsPageClient', () => {
    it('renders the heading + News feed', () => {
        render(<NewsPageClient />);
        expect(screen.getByRole('heading', { name: 'news.pageTitle' })).toBeInTheDocument();
        expect(screen.getByTestId('news-tab-body')).toBeInTheDocument();
    });
});
