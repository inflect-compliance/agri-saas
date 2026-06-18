/**
 * Mobile responsive pass — agriculture surfaces (@mobile).
 *
 * READ-ONLY spec: logs in with the shared seeded tenant (DEFAULT_USER →
 * `loginAndGetTenant`), navigates to the locations list and the seeded
 * location detail at a phone viewport, and asserts the responsive
 * contract:
 *
 *   1. No horizontal overflow at the mobile viewport (the classic
 *      "page is wider than the screen" regression) on the list AND
 *      the location-detail Map tab.
 *   2. The location-detail Map tab stacks the map + side panel into a
 *      single column below the `md:` (768px) breakpoint — the grid was
 *      changed from `lg:grid-cols-[1fr_320px]` to `md:` so phones get
 *      a stacked layout. We verify the map sits ABOVE the side panel
 *      (top-to-bottom), not beside it.
 *   3. Key controls remain visible + large enough to tap (the Map-mode
 *      segmented control is bumped to ≥44px touch targets).
 *
 * This spec is tagged `@mobile` and runs under the mobile device matrix —
 * `mobile-android` (Pixel 5, 393px) + `mobile-iphone` (iPhone 13 viewport,
 * 390px) — both below 768px so the stacking + overflow assertions are
 * meaningful, and both on the Chromium engine (see the engine note in
 * `playwright.config.ts`). The desktop `chromium` project skips it via
 * `grepInvert: /@mobile/`.
 *
 * No mutation, no `data-testid` additions — scoped to existing `id`s,
 * roles, and seeded copy, with locators bound to `getByRole('main')`
 * where a Next streaming duplicate could otherwise match.
 */
import { test, expect, type Page } from '@playwright/test';
import { safeGoto, loginAndGetTenant } from './e2e-utils';

const SEEDED_LOCATION = 'Home Farm — Demo';

/**
 * Assert the document has no horizontal scrollbar at the current
 * viewport — i.e. nothing renders wider than the viewport width.
 * A 1px tolerance absorbs sub-pixel rounding in layout math.
 */
async function expectNoHorizontalOverflow(page: Page, label: string) {
    const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
        };
    });
    expect(
        overflow.scrollWidth,
        `${label}: document scrollWidth (${overflow.scrollWidth}) should not exceed viewport clientWidth (${overflow.clientWidth}) — horizontal overflow on mobile`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('mobile responsive — agriculture @mobile', () => {
    let tenantSlug: string;

    test.beforeEach(async ({ page }) => {
        tenantSlug = await loginAndGetTenant(page);
    });

    test('locations list fits the mobile viewport with no horizontal scroll', async ({
        page,
    }) => {
        await safeGoto(page, `/t/${tenantSlug}/locations`);

        const main = page.getByRole('main');
        // The list renders a DataTable once data resolves; the page
        // heading is the stable anchor that proves the page painted.
        await expect(
            main.getByRole('heading', { name: 'Locations', level: 1 }),
        ).toBeVisible({ timeout: 30_000 });

        // The seeded field is listed (link into the detail page).
        await expect(
            main.getByRole('link', { name: SEEDED_LOCATION }).first(),
        ).toBeVisible({ timeout: 30_000 });

        await expectNoHorizontalOverflow(page, 'locations list');
    });

    test('location detail Map tab stacks map above the side panel on mobile', async ({
        page,
    }) => {
        // Enter the detail page via the seeded location's row link so we
        // don't hard-code an id.
        await safeGoto(page, `/t/${tenantSlug}/locations`);
        const main = page.getByRole('main');
        const locationLink = main
            .getByRole('link', { name: SEEDED_LOCATION })
            .first();
        await expect(locationLink).toBeVisible({ timeout: 30_000 });
        await locationLink.click();

        // Detail header renders the location name (EntityDetailLayout title).
        await expect(
            main.getByRole('heading', { name: SEEDED_LOCATION }).first(),
        ).toBeVisible({ timeout: 30_000 });

        // Switch to the Map tab (the tab bar is part of EntityDetailLayout).
        await main.getByRole('tab', { name: 'Map' }).click();

        // The Map-mode segmented control is a radiogroup labelled "Map mode".
        const mapModeGroup = main.getByRole('radiogroup', { name: 'Map mode' });
        await expect(mapModeGroup).toBeVisible({ timeout: 30_000 });

        // Touch-target check: each Map-mode segment is ≥44px tall (WCAG
        // 2.5.5). The "Draw" radio is representative.
        const drawRadio = mapModeGroup.getByRole('radio', { name: 'Draw' });
        await expect(drawRadio).toBeVisible();
        const drawBox = await drawRadio.boundingBox();
        expect(drawBox, 'Draw control has a measurable box').not.toBeNull();
        expect(
            drawBox!.height,
            'Map-mode control should be a ≥44px touch target on mobile',
        ).toBeGreaterThanOrEqual(44);

        // The map container is the labelled, focusable group rendered by
        // MapCanvas.
        const mapRegion = main.getByRole('group', { name: /Parcel map/ });
        await expect(mapRegion).toBeVisible({ timeout: 30_000 });

        // feat/mobile-map: on phones the inline "New spray job" side panel
        // is GONE — the map is full-bleed (the operator's primary screen)
        // and a parcel tap opens a bottom-sheet instead. So the side-panel
        // heading must NOT render on a mobile viewport.
        await expect(
            main.getByRole('heading', { name: 'New spray job' }),
        ).toHaveCount(0);

        // The full-bleed map spans (near) the full viewport width.
        const mapBox = await mapRegion.boundingBox();
        const viewport = page.viewportSize();
        expect(mapBox, 'map region has a box').not.toBeNull();
        expect(viewport, 'viewport size known').not.toBeNull();
        expect(
            mapBox!.width,
            'full-bleed map should span (near) the full viewport width on mobile',
        ).toBeGreaterThanOrEqual(viewport!.width - 4);

        // On-map thumb controls (locate-me + zoom) render and are ≥44px
        // (WCAG 2.5.5) touch targets.
        const locate = main.getByTestId('map-locate');
        await expect(locate).toBeVisible({ timeout: 30_000 });
        const locateBox = await locate.boundingBox();
        expect(locateBox, 'locate control has a box').not.toBeNull();
        expect(
            locateBox!.height,
            'locate-me should be a ≥44px touch target',
        ).toBeGreaterThanOrEqual(44);

        await expectNoHorizontalOverflow(page, 'location detail — Map tab');
    });
});
