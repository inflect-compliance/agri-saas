/**
 * E2E test — Epic 44.5
 *
 * Proves the full configurable risk-matrix loop:
 *   1. Admin opens /admin/risk-matrix
 *   2. Edits an axis title to a recognisable string
 *   3. Saves
 *   4. Navigates to /risks and switches to the heatmap view
 *   5. The new axis title surfaces in the live matrix
 *
 * This is the headline success criterion of the prompt — "saved
 * config flows through to the live risk matrix rendering" — and
 * is the only direct check that prompt 1's persistence + prompt 4's
 * page wiring + prompt 5's editor agree at runtime.
 *
 * Cleanup: the test resets the axis title back to "Likelihood" at
 * the end so subsequent serial-mode tests start from the canonical
 * default. The DB row stays — that's fine because the row's other
 * fields match the canonical default after reset.
 */

import { test, expect } from '@playwright/test';
import { loginAndGetTenant, safeGoto } from './e2e-utils';

const ADMIN_USER = { email: 'admin@acme.com', password: 'password123' };
const READER_USER = { email: 'viewer@acme.com', password: 'password123' };
const CUSTOM_LABEL = 'Probability of occurrence';

test.describe('Risk matrix admin → live rendering loop', () => {
    test('admin can edit the axis title and see it propagate to /risks', async ({ page }) => {
        const tenantSlug = await loginAndGetTenant(page, ADMIN_USER);

        // The `/admin/*` segment has a `loading.tsx`, so Next.js streams
        // the page through a Suspense boundary. Under slow/loaded CI the
        // streaming staging DOM can leave a SECOND, hidden copy of the
        // editor in the document — invalid duplicate `id`, but harmless
        // (the live page renders fine). A bare `#risk-matrix-admin`
        // locator then trips Playwright strict mode ("resolved to 2
        // elements"). Scope every editor locator to the live `<main>`
        // region so the test always targets the rendered, visible
        // editor and ignores the hidden streaming artifact.
        const editor = page.getByRole('main').locator('#risk-matrix-admin');

        // ── 1. Admin lands on the matrix config page ──────────────
        await safeGoto(page, `/t/${tenantSlug}/admin/risk-matrix`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForLoadState('networkidle').catch(() => {});
        await expect(editor).toBeVisible({
            timeout: 30_000,
        });

        // ── 2. Edit the likelihood axis title ─────────────────────
        const titleInput = editor.locator('#rm-axis-likelihood');
        await expect(titleInput).toBeVisible();
        await titleInput.fill(CUSTOM_LABEL);

        // ── 3. Save ───────────────────────────────────────────────
        //
        // Previous shape used `toHaveText(/Save changes/i)` to wait
        // for the save to settle. That label is the button's IDLE
        // text — `'Saving…'` only briefly replaces it during the
        // PUT — so the assertion could pass before React even
        // re-rendered the saving state, and the next navigation to
        // `/risks` raced the in-flight PUT. Wait on the real signal:
        // the PUT response itself.
        const savePromise = page.waitForResponse(
            (res) =>
                res.url().includes(
                    `/api/t/${tenantSlug}/admin/risk-matrix-config`,
                ) && res.request().method() === 'PUT',
            { timeout: 30_000 },
        );
        await editor.locator('#risk-matrix-save-btn').click();
        const saveRes = await savePromise;
        expect(saveRes.ok()).toBe(true);
        // Belt-and-braces: also wait for the button to settle back
        // to its idle label (covers React state-update propagation).
        await expect(editor.locator('#risk-matrix-save-btn')).toHaveText(
            /Save changes/i,
            { timeout: 15_000 },
        );

        // ── 4. Navigate to /risks → switch to heatmap view ────────
        await safeGoto(page, `/t/${tenantSlug}/risks`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForLoadState('networkidle').catch(() => {});

        // RQ3-5 — the page header carries a three-option ToggleGroup
        // (Register / Matrix / Histogram); options render with
        // role="radio". The old single-button selector returned
        // nothing and the matrix never opened, so we look for the
        // radio first and fall back to the legacy button shape so the
        // spec stays portable across a future toggle redesign.
        const heatmapToggle =
            (await page.getByRole('radio', { name: /Matrix/i }).count())
                ? page.getByRole('radio', { name: /Matrix/i }).first()
                : page.getByRole('button', { name: /Matrix/i }).first();
        if (await heatmapToggle.isVisible().catch(() => false)) {
            await heatmapToggle.click();
        }

        // ── 5. The custom axis title surfaces in the matrix ───────
        await expect(
            page.getByText(CUSTOM_LABEL, { exact: false }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // ── Cleanup — reset to default ────────────────────────────
        await safeGoto(page, `/t/${tenantSlug}/admin/risk-matrix`, {
            waitUntil: 'domcontentloaded',
        });
        await expect(editor).toBeVisible({
            timeout: 30_000,
        });
        await editor.locator('#risk-matrix-restore-defaults').click();
        // Same response-wait as the main save above so cleanup
        // fully lands before the test exits and other serial-mode
        // tests start from the canonical default.
        const cleanupPromise = page.waitForResponse(
            (res) =>
                res.url().includes(
                    `/api/t/${tenantSlug}/admin/risk-matrix-config`,
                ) && res.request().method() === 'PUT',
            { timeout: 30_000 },
        );
        await editor.locator('#risk-matrix-save-btn').click();
        await cleanupPromise;
        await expect(editor.locator('#risk-matrix-save-btn')).toHaveText(
            /Save changes/i,
            { timeout: 15_000 },
        );
    });

    test('non-admin (READER) cannot reach the matrix admin page', async ({ page }) => {
        const tenantSlug = await loginAndGetTenant(page, READER_USER);
        await safeGoto(page, `/t/${tenantSlug}/admin/risk-matrix`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The shared admin layout's `<RequirePermission>` short-circuits
        // to a forbidden page. The editor itself never mounts.
        await expect(page.locator('#risk-matrix-admin')).toHaveCount(0);
    });
});
