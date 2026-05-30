/**
 * E2E — search affordances.
 *
 * Two complementary affordances live on every list page (2026-05-30,
 * reversing the R14-PR7 kill sweep):
 *
 *   • A per-page LIVE filter-scoped search box — `<FilterToolbar
 *     searchPlaceholder>`, a `type="search"` input wired to the
 *     FilterProvider. Typing filters the table (no Enter). The
 *     structural guard `r14-no-page-searchbars.test.ts` pins its
 *     presence at the source level; this spec pins the observed
 *     render.
 *   • The global ⌘K command palette — cross-entity navigation.
 */
import { test, expect } from '@playwright/test';
import { loginAndGetTenant, safeGoto } from './e2e-utils';

test.describe('Search affordances', () => {
    test('controls list page renders the live filter search box AND ⌘K palette', async ({
        page,
    }) => {
        const tenantSlug = await loginAndGetTenant(page);
        await safeGoto(page, `/t/${tenantSlug}/controls`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForLoadState('networkidle').catch(() => {});

        // The page-level filter-scoped search box is present and is a
        // genuine type="search" input (restored 2026-05-30).
        const searchBox = page.getByRole('main').locator('#controls-search');
        await expect(searchBox).toBeVisible();
        await expect(searchBox).toHaveAttribute('type', 'search');

        // The palette is still the canonical cross-entity search. ⌘K opens it.
        await page.keyboard.press('Control+KeyK');
        await expect(
            page.locator('[data-testid="command-palette-input"]'),
        ).toBeVisible({ timeout: 5000 });
    });
});
