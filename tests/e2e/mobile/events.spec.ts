/**
 * Agriculture events page — mobile smoke (@mobile).
 *
 * READ-ONLY: logs into the shared seeded tenant and checks the global events
 * catalogue renders as a populated feed at a phone viewport, with a working
 * external link.
 *
 * Unlike /trends and /news — which assert the shell only because their data is
 * env-gated — this spec asserts real CONTENT, because `prisma/seed.ts` now
 * populates the `AgriEvent` catalogue (it is global, so it exists regardless of
 * which tenant is used). If this spec ever fails with an empty feed, the seed
 * wiring has regressed, which is exactly the defect the page shipped with.
 *
 * `loginAndGetTenant` forces NEXT_LOCALE=en, so assertions target the English
 * copy even though the product is Bulgarian-first.
 *
 * Horizontal drift for `/events` is also covered by the ratchet in
 * `horizontal-drift.spec.ts`; this spec adds the content + link checks.
 */
import { test, expect, type Page } from '@playwright/test';
import { safeGoto, loginAndGetTenant } from '../e2e-utils';

async function settle(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle').catch(() => undefined);
}

test.describe('Agriculture events page @mobile', () => {
    test('renders the populated catalogue with a safe external link', async ({ page }) => {
        const slug = await loginAndGetTenant(page);
        await safeGoto(page, `/t/${slug}/events`);
        await settle(page);

        const main = page.getByRole('main');

        // Shell renders.
        await expect(main.locator('#events-title')).toBeVisible();

        // The feed is POPULATED — not the empty state. This is the assertion
        // that would have caught the original defect.
        const list = main.locator('#events-list');
        await expect(list).toBeVisible();
        const cards = list.locator('li');
        expect(await cards.count()).toBeGreaterThan(0);

        // Each card carries a title.
        await expect(cards.first()).not.toBeEmpty();

        // External links open safely. The seed includes at least one event with
        // a url (AGRA); assert the safety attributes rather than a specific
        // href so re-curating the seed doesn't break the spec.
        const externalLinks = list.locator('a[target="_blank"]');
        const linkCount = await externalLinks.count();
        expect(linkCount).toBeGreaterThan(0);

        const first = externalLinks.first();
        await expect(first).toHaveAttribute('rel', /noopener/);
        await expect(first).toHaveAttribute('href', /^https?:\/\//);

        // No horizontal drift at phone width.
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
});
