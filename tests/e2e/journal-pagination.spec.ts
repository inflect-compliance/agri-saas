/**
 * Roadmap-6 P3 — journal list cursor pagination.
 *
 * Cold start on rural LTE must NOT download the whole farm. The journal
 * list now server-renders a bounded first page (JOURNAL_PAGE_SIZE = 50)
 * and pages forward over the `?limit&cursor` path via
 * `useCursorPagination`. This spec proves the two halves: the first
 * page is bounded (not the old flat take:200), and "Load more" fetches
 * the next cursor page and appends it.
 *
 * Mutating spec → isolated empty tenant.
 */
import { test, expect } from './fixtures';

test('journal list paginates — bounded first page, then fetches the next page via cursor', async ({
    authedPage,
    isolatedTenant,
}) => {
    test.setTimeout(90_000);
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request;
    // Just over one page so a second cursor page exists.
    const TOTAL = 55;
    const PAGE_SIZE = 50;

    // Seed the tenant's journal directly through the API.
    for (let i = 0; i < TOTAL; i++) {
        const res = await api.post(`/api/t/${slug}/journal`, {
            data: { type: 'OBSERVATION', title: `Journal row ${String(i).padStart(3, '0')}` },
        });
        expect(res.ok()).toBeTruthy();
    }

    await authedPage.goto(`/t/${slug}/journal`);

    const main = authedPage.getByRole('main');
    // Each data row renders a `#journal-link-<id>` cell link.
    const rows = main.locator('[id^="journal-link-"]');

    // First paint is bounded to a single page — NOT all 55 rows.
    await expect(rows).toHaveCount(PAGE_SIZE);

    const loadMore = main.locator('#journal-load-more');
    await expect(loadMore).toBeVisible();

    // Fetch the next cursor page.
    await loadMore.click();

    // The remaining rows are appended; every entry now renders and the
    // footer hides because there are no further pages.
    await expect(rows).toHaveCount(TOTAL);
    await expect(loadMore).toBeHidden();
});
