/**
 * Mobile detail-tab swipe (@mobile).
 *
 * READ-ONLY: logs into the shared seeded tenant (DEFAULT_USER via
 * `loginAndGetTenant`) and drives the mobile-native-feel PR-1 horizontal
 * swipe between tabs on a detail page's CONTENT area. A field user on a
 * phone expects to swipe left/right to move between an entity's tabs
 * instead of reaching up to the tab strip.
 *
 * Uses the Locations detail page — an agri surface with seed data and a
 * multi-tab `<EntityDetailLayout>` (overview / map / operations). The
 * swipe is dispatched as real Chromium touch events on the tabpanel
 * (both mobile projects run on the Chromium engine — see
 * playwright.config.ts).
 *
 * Contract asserted:
 *   1. A left swipe on the content advances to the NEXT tab.
 *   2. A right swipe returns to the PREVIOUS tab.
 *   3. A short (< threshold) horizontal drag does NOT change the tab.
 *
 * Locators are scoped to `getByRole('main')` so a Next streaming
 * duplicate of the page can't match, and use existing HTML `id`
 * attributes (`#tab-*`) rather than added test ids.
 */
import { test, expect, type Page } from '@playwright/test';
import { safeGoto, loginAndGetTenant } from '../e2e-utils';

/**
 * Dispatch a horizontal swipe as native touch events on `selector`.
 * `dx` is the total horizontal travel (negative = leftward). React's
 * onTouchStart/onTouchEnd read `touches[0]` / `changedTouches[0]`.
 */
async function swipe(page: Page, selector: string, dx: number): Promise<void> {
    await page.evaluate(
        ({ selector, dx }) => {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (!el) throw new Error(`swipe target not found: ${selector}`);
            const rect = el.getBoundingClientRect();
            const y = rect.top + rect.height / 2;
            const startX = rect.left + rect.width * 0.7;
            const endX = startX + dx;
            const mk = (type: string, x: number): TouchEvent => {
                const touch = new Touch({
                    identifier: 1,
                    target: el,
                    clientX: x,
                    clientY: y,
                });
                const active = type === 'touchend' ? [] : [touch];
                return new TouchEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    touches: active,
                    targetTouches: active,
                    changedTouches: [touch],
                });
            };
            el.dispatchEvent(mk('touchstart', startX));
            el.dispatchEvent(mk('touchmove', (startX + endX) / 2));
            el.dispatchEvent(mk('touchend', endX));
        },
        { selector, dx },
    );
}

test.describe('mobile detail-tab swipe @mobile', () => {
    let tenantSlug: string;

    test.beforeEach(async ({ page }) => {
        tenantSlug = await loginAndGetTenant(page);
    });

    test('swiping the content area moves between detail tabs', async ({ page }) => {
        // Reach a location detail page (multi-tab EntityDetailLayout).
        await safeGoto(page, `/t/${tenantSlug}/locations`);
        const main = page.getByRole('main');
        const firstRowLink = main.locator('a[href*="/locations/"]').first();
        await expect(firstRowLink).toBeVisible({ timeout: 30_000 });
        await firstRowLink.click();

        // Tab strip present, overview active by default.
        await expect(main.locator('#tab-overview')).toBeVisible({ timeout: 30_000 });
        await expect(main.locator('#tab-overview')).toHaveAttribute(
            'aria-selected',
            'true',
        );

        // (1) Left swipe → next tab (map).
        await swipe(page, '#tabpanel-overview', -120);
        await expect(main.locator('#tab-map')).toHaveAttribute(
            'aria-selected',
            'true',
            { timeout: 5_000 },
        );

        // (2) Right swipe → back to the previous tab (overview).
        await swipe(page, '#tabpanel-map', 120);
        await expect(main.locator('#tab-overview')).toHaveAttribute(
            'aria-selected',
            'true',
            { timeout: 5_000 },
        );

        // (3) A short drag below the threshold does not change the tab.
        await swipe(page, '#tabpanel-overview', -20);
        await expect(main.locator('#tab-overview')).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });
});
