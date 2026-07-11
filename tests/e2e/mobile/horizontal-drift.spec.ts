/**
 * Mobile horizontal-drift ratchet (@mobile).
 *
 * READ-ONLY: logs into the shared seeded tenant and, at a phone viewport,
 * asserts every key page renders with NO horizontal overflow — the document's
 * scrollWidth never exceeds the viewport width (±1px for sub-pixel rounding).
 *
 * Why: commit #210 ("fix(mobile): remove horizontal drift on dashboard cards +
 * app-wide sweep") fixed this class BY HAND — a negative-margin child inside a
 * scroll container that pushes the page sideways on a phone, the single worst
 * mobile-feel bug for a field user. Nothing stopped it from recurring. This is
 * the mobile equivalent of the repo's structural ratchets: add a page to
 * `PAGES` in one line and it's guarded forever.
 *
 * Runs under the `mobile-android` (Pixel 5) + `mobile-iphone` projects (both
 * < 768px). Picked up via the `@mobile` tag (see playwright.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { safeGoto, loginAndGetTenant } from '../e2e-utils';

/**
 * Assert the page has no horizontal drift. `documentElement.scrollWidth`
 * exceeding `clientWidth` means SOMETHING is wider than the viewport — the
 * exact symptom a user feels as "the page slides left/right".
 */
async function expectNoHorizontalDrift(page: Page, label: string): Promise<void> {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(
        scrollWidth,
        `${label}: page overflows horizontally (scrollWidth ${scrollWidth} > viewport ${clientWidth})`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

// Key field surfaces. One line per page — this is the extension point.
const PAGES: ReadonlyArray<{ label: string; path: (slug: string) => string }> = [
    { label: 'dashboard', path: (s) => `/t/${s}/dashboard` },
    { label: 'journal', path: (s) => `/t/${s}/journal` },
    { label: 'exchange', path: (s) => `/t/${s}/exchange` },
    { label: 'my-listings', path: (s) => `/t/${s}/exchange/my-listings` },
    { label: 'farm-tasks', path: (s) => `/t/${s}/farm-tasks` },
    { label: 'locations (list)', path: (s) => `/t/${s}/locations` },
    // High-traffic pages added — drift is the app's #1 mobile regression class,
    // so the ratchet covers the busy list surfaces, not just the ag ones.
    { label: 'risks', path: (s) => `/t/${s}/risks` },
    { label: 'controls', path: (s) => `/t/${s}/controls` },
    { label: 'grain', path: (s) => `/t/${s}/grain` },
    { label: 'planning', path: (s) => `/t/${s}/planning` },
    { label: 'inventory', path: (s) => `/t/${s}/inventory` },
    { label: 'vendors', path: (s) => `/t/${s}/vendors` },
    { label: 'evidence', path: (s) => `/t/${s}/evidence` },
    { label: 'calendar', path: (s) => `/t/${s}/calendar` },
    { label: 'admin/members', path: (s) => `/t/${s}/admin/members` },
];

test.describe('mobile horizontal-drift ratchet @mobile', () => {
    let tenantSlug: string;

    test.beforeEach(async ({ page }) => {
        tenantSlug = await loginAndGetTenant(page);
    });

    for (const { label, path } of PAGES) {
        test(`${label} does not drift horizontally`, async ({ page }) => {
            await safeGoto(page, path(tenantSlug));
            // Let streaming content settle before measuring.
            await page.waitForLoadState('networkidle').catch(() => undefined);
            await expectNoHorizontalDrift(page, label);
        });
    }

    test('the create-offer modal open state does not drift', async ({ page }) => {
        await safeGoto(page, `/t/${tenantSlug}/exchange`);
        // Open the create-offer flow if the affordance is present; the modal is
        // the historical drift culprit (a wide form inside a phone-width sheet).
        const trigger = page.getByRole('button', { name: /offer/i }).first();
        if (await trigger.count()) {
            await trigger.click().catch(() => undefined);
            await page.waitForTimeout(300);
        }
        await expectNoHorizontalDrift(page, 'exchange + create-offer modal');
    });
});
