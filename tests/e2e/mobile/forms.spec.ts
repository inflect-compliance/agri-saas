/**
 * Mobile forms — FAB launches the create flow (@mobile).
 *
 * READ-ONLY (shared seeded tenant). On a phone viewport (mobile-android /
 * mobile-iphone, both < md) the page header's "+" is augmented by a
 * floating action button (FAB) for the primary create flow. Proves:
 *   1. The FAB is visible on a key list page (md:hidden → shown < md).
 *   2. Tapping it launches the create flow as a bottom drawer (the <Modal>
 *      primitive renders a Vaul drawer on mobile) with the pinned footer's
 *      primary action ("Create Task") reachable — i.e. Save isn't buried.
 *
 * The keyboard-aware footer + the drag/dirty-guard are unit/rendered-tested
 * (hard to drive a soft keyboard in Playwright); this covers the launch +
 * reachable-Save contract end-to-end.
 */
import { test, expect } from '@playwright/test';
import { safeGoto, loginAndGetTenant } from '../e2e-utils';

test.describe('mobile forms — FAB launches create @mobile', () => {
    let tenantSlug: string;

    test.beforeEach(async ({ page }) => {
        tenantSlug = await loginAndGetTenant(page);
    });

    test('the Tasks FAB opens the create drawer with a reachable Save', async ({
        page,
    }) => {
        await safeGoto(page, `/t/${tenantSlug}/tasks`);
        const main = page.getByRole('main');
        await expect(
            main.getByRole('heading', { name: 'Tasks', level: 1 }),
        ).toBeVisible({ timeout: 30_000 });

        // The mobile FAB is shown (md:hidden → visible at phone width).
        const fab = page.getByTestId('fab');
        await expect(fab).toBeVisible();

        // Tap it → the create modal opens as a bottom drawer (role=dialog).
        await fab.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 15_000 });

        // The pinned footer's primary action is present + reachable — Save
        // is never buried even before scrolling the form.
        await expect(
            dialog.getByRole('button', { name: 'Create Task' }),
        ).toBeVisible({ timeout: 15_000 });
    });
});
