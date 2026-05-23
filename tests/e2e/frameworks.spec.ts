import { test, expect, Page } from '@playwright/test';
import { loginAndGetTenant } from './e2e-utils';


// GAP-23 carve-out: this spec depends on the seeded acme-corp tenant
// having ISO27001 / SOC2 / NIS2 / ISO9001 / ISO28000 / ISO39001
// frameworks installed. createIsolatedTenant produces an empty
// tenant with no installed frameworks. Migrating this spec is gated
// on the factory gaining a `installFrameworks: ['ISO27001', …]`
// option (or a sibling helper that calls the framework-install
// usecase for a freshly-created tenant).

test.describe('Framework Coverage UI', () => {
    test.describe.configure({ mode: 'serial' });

    let tenantSlug: string;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        // Warmup: visit root page to ensure server compiles
        await page.goto('/login', { timeout: 60000 }).catch(() => null);
        await page.waitForTimeout(2000);
        tenantSlug = await loginAndGetTenant(page);
    });

    test.afterAll(async () => {
        await page.close();
    });

    test('frameworks page loads', async () => {
        await page.goto(`/t/${tenantSlug}/frameworks`);
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('#frameworks-heading', { timeout: 60000 });
        await expect(page.locator('#frameworks-heading')).toContainText('Compliance Frameworks');
    });

    test('framework cards are visible', async () => {
        // Epic 66 reshaped this page from the legacy `id="fw-card-..."`
        // card grid to a `<CardList>` primitive that uses
        // `data-testid="fw-card-..."` instead. The visual contract
        // (one card per seeded framework) is unchanged. Seed
        // guarantees ISO27001 + SOC2 + NIS2 + ISO9001 + ISO28000 +
        // ISO39001.
        const cards = page.locator('[data-testid^="fw-card-"]');
        await expect(cards.first()).toBeVisible({ timeout: 30_000 });
        expect(await cards.count()).toBeGreaterThanOrEqual(1);
    });

    test('can navigate to framework detail', async () => {
        // Epic 66 also removed the per-card "View Details" link
        // (`id="view-framework-..."`); the whole card is now
        // clickable via its onClick. We click the first card row to
        // navigate. The card title's anchor would also work; either
        // path lands on the same /frameworks/<key> URL.
        const viewBtn = page.locator('[data-testid^="fw-card-"]').first();
        await expect(viewBtn).toBeVisible({ timeout: 30_000 });
        await viewBtn.click();
        // Framework detail is a client page that fetches 4 API endpoints.
        // On first access, Next.js JIT-compiles the page + all API routes,
        // which can take 30-60s in cold environments.
        await page.waitForLoadState('networkidle').catch(() => {});
        await expect(page.locator('#framework-detail-heading')).toBeVisible({ timeout: 60_000 });
    });

    test('detail page shows tabs', async () => {
        // The previous test may have navigated away; re-establish the
        // framework detail view deterministically via the URL.
        await page.goto(`/t/${tenantSlug}/frameworks/ISO27001`);
        await expect(page.locator('#framework-detail-heading')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#tab-requirements')).toBeVisible();
        await expect(page.locator('#tab-packs')).toBeVisible();
        await expect(page.locator('#tab-coverage')).toBeVisible();
    });

    test('requirements tab renders the Epic 46 tree explorer', async () => {
        await expect(page.locator('#tab-requirements')).toBeVisible({ timeout: 30_000 });
        await page.locator('#tab-requirements').click();
        await expect(page.locator('#requirements-panel')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#framework-explorer')).toBeVisible({ timeout: 30_000 });
        // Migrated search box (replaces the legacy `#requirements-search`).
        await expect(page.locator('#framework-explorer-search')).toBeVisible();
        // Tree container — `<TreeView>` paints `role="tree"`.
        await expect(page.locator('#framework-explorer [role="tree"]')).toBeVisible();
        // Detail pane is empty until a row is selected.
        await expect(page.locator('#framework-explorer-detail')).toBeVisible();
    });

    test('expand-all reveals nested requirements; collapse-all hides them', async () => {
        // Pre-state: nothing expanded, so requirement rows should not
        // be visible — only section rows are.
        await page.locator('#tab-requirements').click();
        await expect(page.locator('#framework-explorer')).toBeVisible({ timeout: 30_000 });

        const treeitems = page.locator('#framework-explorer [role="treeitem"]');
        const collapsedCount = await treeitems.count();
        expect(collapsedCount).toBeGreaterThan(0);

        // Expand all — count should grow strictly (sections + every
        // requirement become visible rows).
        await page.locator('#framework-explorer-toggle-expand').click();
        // Repaint waits for the new flat-row materialisation.
        await page.waitForFunction(
            ([initial]) => {
                const items = document.querySelectorAll(
                    '#framework-explorer [role="treeitem"]',
                );
                return items.length > (initial as number);
            },
            [collapsedCount],
            { timeout: 10_000 },
        );
        const expandedCount = await treeitems.count();
        expect(expandedCount).toBeGreaterThan(collapsedCount);

        // Collapse all — back to root-level only.
        await page.locator('#framework-explorer-toggle-collapse').click();
        await page.waitForFunction(
            ([target]) => {
                const items = document.querySelectorAll(
                    '#framework-explorer [role="treeitem"]',
                );
                return items.length === (target as number);
            },
            [collapsedCount],
            { timeout: 10_000 },
        );
        await expect(treeitems).toHaveCount(collapsedCount);
    });

    test('selecting a requirement renders the detail pane', async () => {
        await page.locator('#tab-requirements').click();
        await expect(page.locator('#framework-explorer')).toBeVisible({ timeout: 30_000 });
        // Expand all so we have a requirement row to click.
        await page.locator('#framework-explorer-toggle-expand').click();
        // Pick a requirement-row (level 2 minimum). Sections sit at
        // aria-level=1; requirements at 2+. ISO 27001 has 5.1 in the
        // Organizational theme, so its label code is `5.1`.
        const reqRow = page
            .locator(
                '#framework-explorer [role="treeitem"][aria-level="2"]',
            )
            .first();
        await expect(reqRow).toBeVisible({ timeout: 10_000 });
        await reqRow.click();
        await expect(
            page.locator('#framework-explorer-requirement-detail'),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('Epic 46.3 — minimap is rendered with section rows', async () => {
        await page.locator('#tab-requirements').click();
        await expect(page.locator('#framework-explorer')).toBeVisible({ timeout: 30_000 });
        // Minimap mounts on lg+ breakpoints; Playwright's default
        // viewport (1280×720) crosses lg.
        await expect(page.locator('#framework-minimap')).toBeVisible();
        // ISO 27001 has 4 themes (ORGANIZATIONAL, PEOPLE, PHYSICAL,
        // TECHNOLOGICAL) so the minimap should carry exactly that many
        // rows on this seed.
        const minimapRows = page.locator('#framework-minimap [data-minimap-section-id]');
        const count = await minimapRows.count();
        expect(count).toBeGreaterThanOrEqual(4);
    });

    test('Epic 46.3 — clicking a minimap row jumps + selects that section', async () => {
        await page.locator('#tab-requirements').click();
        await expect(page.locator('#framework-explorer')).toBeVisible({ timeout: 30_000 });
        // Click the SECOND minimap row (so we move away from the
        // default first section).
        const target = page
            .locator('#framework-minimap [data-minimap-section-id]')
            .nth(1);
        await expect(target).toBeVisible();
        const targetSectionId = await target.getAttribute('data-minimap-section-id');
        expect(targetSectionId).toBeTruthy();
        await target.click();
        // The matching tree section row should now be selected
        // (data-selected="true" set by TreeViewItem when its node
        // matches the explorer's selectedId).
        const treeRow = page.locator(
            `#framework-explorer-tree-scroll [data-tree-node-id="${targetSectionId}"]`,
        );
        await expect(treeRow).toBeVisible({ timeout: 10_000 });
        await expect(treeRow).toHaveAttribute('data-selected', 'true');
    });

    test('Epic 46.3 — compliance status indicators paint on tree rows', async () => {
        await page.locator('#tab-requirements').click();
        await expect(page.locator('#framework-explorer')).toBeVisible({ timeout: 30_000 });
        // Section rows render their aggregated status dot whether
        // expanded OR collapsed — no need to flip the tree state.
        // Earlier tests in this serial suite may leave expand-all
        // already in 'all' state (which disables the toggle button),
        // so we don't attempt to click it.
        const indicators = page.locator(
            '#framework-explorer-tree-scroll [data-status]',
        );
        await expect(indicators.first()).toBeVisible({ timeout: 10_000 });
        const status = await indicators.first().getAttribute('data-status');
        expect(['compliant', 'partial', 'gap', 'na', 'unknown']).toContain(status);
    });

    test('Epic 46.4 — builder tab renders for ADMIN with draggable rows', async () => {
        // The default test user (admin@acme.com) is ADMIN, so the
        // permission-gated panel mounts.
        await page.goto(`/t/${tenantSlug}/frameworks/ISO27001`);
        await expect(page.locator('#framework-detail-heading')).toBeVisible({ timeout: 30_000 });
        const builderTab = page.locator('#tab-builder');
        await expect(builderTab).toBeVisible();
        await builderTab.click();
        await expect(page.locator('#builder-panel')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#framework-builder')).toBeVisible();
        // At least one section + one requirement should be draggable.
        await expect(
            page.locator('[data-builder-section-id]').first(),
        ).toBeVisible({ timeout: 10_000 });
        await expect(
            page.locator('[data-builder-requirement-id]').first(),
        ).toBeVisible();
        // Save button starts disabled (model is clean).
        await expect(page.locator('#framework-builder-save')).toBeDisabled();
    });

    test('packs tab works', async () => {
        await expect(page.locator('#tab-packs')).toBeVisible({ timeout: 30_000 });
        await page.locator('#tab-packs').click();
        await expect(page.locator('#packs-panel')).toBeVisible({ timeout: 30_000 });
    });

    test('coverage tab works', async () => {
        await expect(page.locator('#tab-coverage')).toBeVisible({ timeout: 30_000 });
        await page.locator('#tab-coverage').click();
        await expect(page.locator('#coverage-panel')).toBeVisible({ timeout: 30_000 });
    });

    test('install wizard loads', async () => {
        await page.goto(`/t/${tenantSlug}/frameworks/ISO27001/install`);
        await page.waitForLoadState('networkidle').catch(() => {});
        await expect(page.locator('#install-wizard-heading')).toContainText('Install', { timeout: 30_000 });
    });

    test('install wizard shows preview', async () => {
        // The wizard auto-selects the first pack and renders the preview
        // counter; its value depends on seed state but must be numeric.
        await expect(page.locator('#install-wizard-heading')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#preview-new-controls')).toBeVisible({ timeout: 30_000 });
        const text = await page.locator('#preview-new-controls').textContent();
        expect(parseInt(text || 'NaN')).toBeGreaterThanOrEqual(0);
    });

    test('can install pack', async () => {
        const installBtn = page.locator('#confirm-install-btn');
        await expect(installBtn).toBeVisible({ timeout: 30_000 });
        const btnText = (await installBtn.textContent()) || '';
        if (btnText.includes('already installed')) {
            // Idempotent path: seed already installed the pack links, so
            // the button reflects the "already installed" end state.
            expect(btnText).toContain('already installed');
            return;
        }
        await installBtn.click();
        await expect(page.locator('#install-result')).toContainText('Successfully', { timeout: 60_000 });
    });

    // Coverage data is exposed via the in-page Coverage tab on the
    // framework detail page (see "coverage tab works" above). There is
    // no separate `/frameworks/[key]/coverage` route in the product
    // surface — the standalone-route smoke tests previously here were
    // always skipped and have been removed in the Epic 55/56 cleanup
    // pass.
});
