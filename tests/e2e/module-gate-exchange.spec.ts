/**
 * Module gate — a tenant without EXCHANGE cannot reach the marketplace.
 *
 * Uses an isolated tenant (fresh, OWNER, all modules), disables EXCHANGE via
 * the admin modules API, then asserts BOTH gate surfaces:
 *   - Desktop: navigating to /exchange redirects to the dashboard
 *     (requireModule) — the page gate.
 *   - @mobile: the module-gated EXCHANGE tab does NOT render in the
 *     BottomTabBar — the bar never out-runs the nav's module gating.
 *
 * The mobile assertion is the gap the roadmap called out: a gated module must
 * disappear from the phone's primary navigation, not just 403 on the API.
 */
import { test, expect } from './fixtures';

// Every ModuleKey EXCEPT EXCHANGE — `setEnabledModules` replaces the list, so
// this disables only the marketplace.
const ALL_EXCEPT_EXCHANGE = [
    'JOURNAL', 'INVENTORY', 'PLANNING', 'CERTIFICATION', 'RISK',
    'VENDORS', 'AUTOMATION', 'PROCESSES', 'AI', 'GRAIN',
];

async function disableExchange(page: import('@playwright/test').Page, slug: string): Promise<void> {
    // authedPage.request shares the owner's auth cookies.
    const res = await page.request.put(`/api/t/${slug}/admin/modules`, {
        data: { enabledModules: ALL_EXCEPT_EXCHANGE },
    });
    expect(res.ok(), `disable EXCHANGE: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe('module gate — EXCHANGE disabled', () => {
    test('navigating to /exchange redirects to the dashboard', async ({ authedPage, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        await disableExchange(authedPage, slug);

        await authedPage.goto(`/t/${slug}/exchange`);
        // requireModule redirects the gated surface to the tenant dashboard.
        await authedPage.waitForURL(new RegExp(`/t/${slug}/dashboard`), { timeout: 30_000 });
        expect(authedPage.url()).toContain(`/t/${slug}/dashboard`);
    });

    test('the gated EXCHANGE tab does not render in the BottomTabBar @mobile', async ({ authedPage, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        await disableExchange(authedPage, slug);

        await authedPage.goto(`/t/${slug}/dashboard`);
        const bar = authedPage.getByTestId('bottom-tab-bar');
        await expect(bar).toBeVisible({ timeout: 30_000 });

        // The bar still renders its other field tabs…
        await expect(bar.getByTestId('bottom-tab-dashboard')).toBeVisible();
        // …but the module-gated EXCHANGE tab is gone.
        await expect(bar.getByTestId('bottom-tab-exchange')).toHaveCount(0);
    });
});
