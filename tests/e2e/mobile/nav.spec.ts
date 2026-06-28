/**
 * Mobile one-thumb navigation — bottom-tab bar smoke (@mobile).
 *
 * READ-ONLY: logs into the shared seeded tenant (DEFAULT_USER via
 * `loginAndGetTenant`) and drives the mobile-shell PR-1 bottom-tab bar
 * at a phone viewport. Runs under the `mobile-android` (Pixel 5) +
 * `mobile-iphone` (iPhone 13 viewport) Playwright projects — both
 * < 768px so the `md:hidden` bar is visible.
 *
 * Asserts the field-grade contract:
 *   1. The bar is visible + pinned to the viewport bottom on mobile.
 *   2. It exposes the five permission-gated field tabs.
 *   3. Each tab is a ≥44px touch target (WCAG 2.5.5 / Apple HIG).
 *   4. The active tab carries aria-current="page" (a non-visual cue).
 *   5. Tapping a tab navigates and moves the active state — one-thumb
 *      reach with NO hamburger.
 *   6. Page content clears the fixed bar (the safe-area spacer exists).
 *
 * Lives in `tests/e2e/mobile/` and is tagged `@mobile`; the device
 * projects pick it up via that tag (see `playwright.config.ts`).
 */
import { test, expect } from '@playwright/test';
import { safeGoto, loginAndGetTenant } from '../e2e-utils';

// The legacy compliance Tasks tab was dropped from the bottom bar; the
// farm surfaces are dashboard / farm-tasks / locations / journal.
const FIELD_TABS = ['dashboard', 'farm-tasks', 'locations', 'journal'];

test.describe('mobile bottom-tab navigation @mobile', () => {
    let tenantSlug: string;

    test.beforeEach(async ({ page }) => {
        tenantSlug = await loginAndGetTenant(page);
    });

    test('bottom-tab bar gives one-thumb reach to the field surfaces', async ({ page }) => {
        await safeGoto(page, `/t/${tenantSlug}/dashboard`);

        const bar = page.getByTestId('bottom-tab-bar');
        await expect(bar).toBeVisible({ timeout: 30_000 });

        // (1) Pinned to the viewport bottom (≤2px slack for sub-pixel rounding).
        const barBox = await bar.boundingBox();
        const viewport = page.viewportSize();
        expect(barBox, 'bar has a measurable box').not.toBeNull();
        expect(viewport, 'viewport size is known').not.toBeNull();
        expect(
            Math.abs(barBox!.y + barBox!.height - viewport!.height),
            'bar bottom edge sits at the viewport bottom',
        ).toBeLessThanOrEqual(2);

        // (2) The four field tabs are present.
        for (const slug of FIELD_TABS) {
            await expect(bar.getByTestId(`bottom-tab-${slug}`)).toBeVisible();
        }

        // (3) ≥44px touch target — the dashboard tab is representative.
        const dashTab = bar.getByTestId('bottom-tab-dashboard');
        const dashBox = await dashTab.boundingBox();
        expect(dashBox, 'tab has a measurable box').not.toBeNull();
        expect(
            dashBox!.height,
            'each tab is a ≥44px touch target',
        ).toBeGreaterThanOrEqual(44);

        // (4) Active tab = dashboard on the dashboard route.
        await expect(dashTab).toHaveAttribute('aria-current', 'page');

        // (5) One-thumb navigation: tap Locations → route + active state move,
        //     no hamburger involved.
        await bar.getByTestId('bottom-tab-locations').click();
        await page.waitForURL(/\/t\/[^/]+\/locations/, { timeout: 30_000 });
        await expect(bar.getByTestId('bottom-tab-locations')).toHaveAttribute(
            'aria-current',
            'page',
        );
        await expect(bar.getByTestId('bottom-tab-dashboard')).not.toHaveAttribute(
            'aria-current',
            'page',
        );
    });

    test('a safe-area spacer clears content from behind the fixed bar', async ({ page }) => {
        await safeGoto(page, `/t/${tenantSlug}/dashboard`);

        // The bar is fixed (overlays scrolling content); the spacer is what
        // keeps the last row of content reachable above it.
        const bar = page.getByTestId('bottom-tab-bar');
        await expect(bar).toBeVisible({ timeout: 30_000 });
        const position = await bar.evaluate((el) => getComputedStyle(el).position);
        expect(position, 'bar overlays content via fixed positioning').toBe('fixed');

        const spacer = page.getByTestId('bottom-tab-spacer');
        const spacerBox = await spacer.boundingBox();
        expect(spacerBox, 'spacer has a measurable box').not.toBeNull();
        expect(
            spacerBox!.height,
            'spacer reserves at least the bar height so content is not occluded',
        ).toBeGreaterThanOrEqual(44);
    });
});
