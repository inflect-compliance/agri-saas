/**
 * Mobile members admin — Popover row-action bottom sheet (@mobile).
 *
 * READ-ONLY (shared seeded tenant via loginAndGetTenant). The
 * DEFAULT_USER is an OWNER/ADMIN of the seeded tenant, so /admin/members
 * lists at least their own membership row. This spec proves the
 * dropdown-unification contract at a phone viewport (<sm):
 *
 *   1. The 8-column members table renders as TAPPABLE CARDS
 *      (mobileFallback="card") — NO horizontal overflow at 390px.
 *   2. The row-action kebab opens as a vaul BOTTOM SHEET (role=dialog),
 *      not a clipped absolute panel — and it sits ABOVE the z-30
 *      BottomTabBar (which stays visible).
 *   3. Every menu item is a ≥44px tap target and is actually tappable
 *      with the tab bar visible.
 *
 * Opening the menu is non-mutating; the spec never commits a destructive
 * item (it Escapes out), so read-only shared-tenant isolation holds.
 */
import { test, expect, type Page } from '@playwright/test';
import { safeGoto, loginAndGetTenant } from '../e2e-utils';

async function expectNoHorizontalOverflow(page: Page, label: string) {
    const o = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(
        o.scrollWidth,
        `${label}: document scrollWidth (${o.scrollWidth}) should not exceed viewport clientWidth (${o.clientWidth}) — horizontal overflow on mobile`,
    ).toBeLessThanOrEqual(o.clientWidth + 1);
}

test.describe('mobile members admin — Popover bottom sheet @mobile', () => {
    let tenantSlug: string;

    test.beforeEach(async ({ page }) => {
        tenantSlug = await loginAndGetTenant(page);
    });

    test('members render as cards (no horizontal scroll) at a phone viewport', async ({
        page,
    }) => {
        await safeGoto(page, `/t/${tenantSlug}/admin/members`);
        const main = page.getByRole('main');

        // The card list (seeded membership rows) renders instead of the
        // 8-column scrolling table.
        const cardList = main.getByTestId('mobile-card-list');
        await expect(cardList).toBeVisible({ timeout: 30_000 });
        expect(await cardList.getByTestId('mobile-card').count()).toBeGreaterThan(0);

        await expectNoHorizontalOverflow(page, 'members list (card mode)');
    });

    test('the kebab opens a bottom sheet whose items are ≥44px and tappable with the tab bar visible', async ({
        page,
    }) => {
        await safeGoto(page, `/t/${tenantSlug}/admin/members`);
        const main = page.getByRole('main');

        const cardList = main.getByTestId('mobile-card-list');
        await expect(cardList).toBeVisible({ timeout: 30_000 });

        // Open the row-action menu (MoreVertical kebab, id="member-menu-<id>").
        const kebab = main.locator('[id^="member-menu-"]').first();
        await expect(kebab).toBeVisible({ timeout: 30_000 });

        // The kebab itself is a ≥44px tap target on mobile.
        const kebabBox = await kebab.boundingBox();
        expect(kebabBox, 'kebab must have a bounding box').toBeTruthy();
        expect(kebabBox!.height).toBeGreaterThanOrEqual(44);
        expect(kebabBox!.width).toBeGreaterThanOrEqual(44);

        await kebab.click();

        // The menu opens as a vaul bottom-sheet (role=dialog), portalled to
        // <body> — NOT a clipped absolute panel. Assert page-scoped.
        const sheet = page.getByRole('dialog');
        await expect(sheet).toBeVisible({ timeout: 10_000 });

        // The BottomTabBar (z-30) stays visible behind the z-50 sheet.
        await expect(page.getByTestId('bottom-tab-bar')).toBeVisible();

        // Every menu item is a ≥44px, tappable target. The seeded self-row
        // (ACTIVE) exposes change-role / view-sessions / certificates /
        // deactivate / remove.
        const items = sheet.getByRole('menuitem');
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const item = items.nth(i);
            await expect(item).toBeVisible();
            const box = await item.boundingBox();
            expect(box, `menu item ${i} must have a bounding box`).toBeTruthy();
            expect(
                box!.height,
                `menu item ${i} height (${box!.height}px) must be a ≥44px tap target`,
            ).toBeGreaterThanOrEqual(44);
        }

        // Dismiss without committing any (potentially destructive) action.
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden({ timeout: 10_000 });
    });
});
