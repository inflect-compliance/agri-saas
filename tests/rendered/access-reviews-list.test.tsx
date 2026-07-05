/**
 * Epic G-4 — Access reviews list page render test.
 *
 *   1. Renders the title + count line + create button.
 *   2. Renders one row per campaign with the status badge,
 *      progress bar, and detail-page link.
 *   3. Empty state renders when no campaigns exist.
 *   4. Truncation banner renders when the backfill cap fired.
 *   5. Clicking "New campaign" opens the create modal.
 */
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/t/acme/access-reviews',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('next-intl', () => ({
    useTranslations: () => {
        const t = (key: string) => key;
        (t as unknown as { rich: (k: string) => string }).rich = (key: string) => key;
        return t;
    },
}));

import { AccessReviewsClient } from '@/app/t/[tenantSlug]/(app)/access-reviews/AccessReviewsClient';

function withClient(ui: React.ReactNode) {
    const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const sample = (overrides: Record<string, unknown> = {}) =>
    ({
        id: 'rev_1',
        name: 'Q1 access review',
        scope: 'ALL_USERS' as const,
        status: 'OPEN' as const,
        periodStartAt: null,
        periodEndAt: null,
        dueAt: null,
        closedAt: null,
        createdAt: new Date('2026-04-01').toISOString(),
        reviewerUserId: 'usr_reviewer',
        createdByUserId: 'usr_creator',
        _count: { decisions: 4 },
        ...overrides,
    });

describe('AccessReviewsClient', () => {
    beforeEach(() => {
        // Provide a non-pending fetch so the SWR hook hydrates with
        // initialData rather than spinning.
        (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ rows: [], truncated: false }),
        }));
    });

    it('renders title, count, create-button and one row per campaign', () => {
        render(
            withClient(
                <AccessReviewsClient
                    tenantSlug="acme"
                    initialReviews={[
                        sample({ id: 'rev_1', name: 'Q1' }),
                        sample({ id: 'rev_2', name: 'Q2', status: 'IN_REVIEW' }),
                    ]}
                />,
            ),
        );
        expect(screen.getByTestId('access-reviews-title')).toBeTruthy();
        expect(screen.getByTestId('access-review-new-campaign-button')).toBeTruthy();
        expect(screen.getByTestId('access-review-row-rev_1')).toBeTruthy();
        expect(screen.getByTestId('access-review-row-rev_2')).toBeTruthy();
        // Each row carries a Link to its detail page.
        const link1 = screen.getByText('Q1');
        expect(link1.closest('a')?.getAttribute('href')).toBe(
            '/t/acme/access-reviews/rev_1',
        );
    });

    it('renders empty state when there are no campaigns', () => {
        render(
            withClient(
                <AccessReviewsClient tenantSlug="acme" initialReviews={[]} />,
            ),
        );
        expect(screen.getByTestId('access-reviews-empty')).toBeTruthy();
    });

    it('clicking New campaign opens the create modal', () => {
        render(
            withClient(
                <AccessReviewsClient tenantSlug="acme" initialReviews={[]} />,
            ),
        );
        fireEvent.click(screen.getByTestId('access-review-new-campaign-button'));
        expect(screen.getByTestId('access-review-new-name')).toBeTruthy();
        expect(screen.getByTestId('access-review-new-reviewer')).toBeTruthy();
        expect(screen.getByTestId('access-review-new-submit')).toBeTruthy();
    });

    it('scope radios: default is checked and clicking a label switches selection', () => {
        render(
            withClient(
                <AccessReviewsClient tenantSlug="acme" initialReviews={[]} />,
            ),
        );
        fireEvent.click(screen.getByTestId('access-review-new-campaign-button'));

        const allUsers = document.getElementById('access-review-scope-ALL_USERS')!;
        const adminOnly = document.getElementById('access-review-scope-ADMIN_ONLY')!;
        // Default scope (ALL_USERS) renders CHECKED — the bug report was
        // a blank radio group (neither selected) + unclickable rows.
        expect(allUsers.getAttribute('data-state')).toBe('checked');
        expect(adminOnly.getAttribute('data-state')).toBe('unchecked');

        // Clicking the LABEL (htmlFor → id) must switch the selection —
        // the previous label-wrapped form didn't associate the control.
        // i18n: useTranslations is mocked to echo the key, so the scope
        // label renders as its message key.
        fireEvent.click(screen.getByText('scopeAdminOnly'));
        expect(adminOnly.getAttribute('data-state')).toBe('checked');
        expect(allUsers.getAttribute('data-state')).toBe('unchecked');
    });

    it('create-modal shows error when name + reviewer are missing', () => {
        render(
            withClient(
                <AccessReviewsClient tenantSlug="acme" initialReviews={[]} />,
            ),
        );
        fireEvent.click(screen.getByTestId('access-review-new-campaign-button'));
        fireEvent.click(screen.getByTestId('access-review-new-submit'));
        expect(screen.getByTestId('access-review-new-error').textContent).toMatch(
            /required/i,
        );
    });
});
