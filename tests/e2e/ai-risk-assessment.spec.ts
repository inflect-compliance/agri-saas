import { test, expect } from '@playwright/test';
import { loginAndGetTenant, safeGoto } from './e2e-utils';

const ADMIN_USER = { email: 'admin@acme.com', password: 'password123' };

test.describe('AI-Assisted Risk Assessment', () => {
    let tenantSlug: string;

    test.beforeEach(async ({ page }) => {
        tenantSlug = await loginAndGetTenant(page, ADMIN_USER);
    });

    test('risks page has AI Assessment button', async ({ page }) => {
        await safeGoto(page, `/t/${tenantSlug}/risks`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('#ai-risk-btn', { timeout: 30000 });
        await expect(page.locator('#ai-risk-btn')).toBeVisible();
        await expect(page.locator('#ai-risk-btn')).toContainText('AI Assessment');
    });

    test('navigates to AI assessment page and shows form', async ({ page }) => {
        await safeGoto(page, `/t/${tenantSlug}/risks/ai`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('#ai-risk-title', { timeout: 30000 });
        await expect(page.locator('#ai-risk-title')).toContainText('AI-Assisted Risk Assessment');
        await expect(page.locator('#ai-generate-form')).toBeVisible();
        await expect(page.locator('#ai-generate-btn')).toBeVisible();
    });

    test('can select frameworks and generate suggestions', async ({ page }) => {
        await safeGoto(page, `/t/${tenantSlug}/risks/ai`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('#ai-generate-form', { timeout: 30000 });

        // Select ISO27001 framework
        await page.click('#fw-iso27001');
        // Selected framework chip uses the semantic info-emphasis token after PR-1 migration.
        await expect(page.locator('#fw-iso27001')).toHaveClass(/bg-bg-info-emphasis/);

        // Generate suggestions
        await page.click('#ai-generate-btn');

        // Wait for review section
        await page.waitForSelector('#ai-review-section', { timeout: 30000 });
        await expect(page.locator('#ai-review-section')).toBeVisible();

        // Should have suggestion cards
        await expect(page.locator('[id^="suggestion-"]').first()).toBeVisible();
    });

    test('can accept, reject, and apply suggestions', async ({ page }) => {
        await safeGoto(page, `/t/${tenantSlug}/risks/ai`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('#ai-generate-form', { timeout: 30000 });

        // Generate
        await page.click('#fw-iso27001');
        await page.click('#ai-generate-btn');
        await page.waitForSelector('#ai-review-section', { timeout: 30000 });

        // Accept first suggestion
        await page.click('#accept-0');
        await expect(page.locator('#accepted-count')).toContainText('1 accepted');

        // Reject second suggestion
        await page.click('#reject-1');
        await expect(page.locator('#rejected-count')).toContainText('1 rejected');

        // Apply accepted
        await page.click('#apply-btn');

        // Wait for done phase
        await page.waitForSelector('#ai-done', { timeout: 30000 });
        await expect(page.locator('#ai-done')).toContainText('added to your register');
    });

    test('applied risk appears in risk register', async ({ page }) => {
        // First generate and apply
        await safeGoto(page, `/t/${tenantSlug}/risks/ai`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('#ai-generate-form', { timeout: 30000 });
        await page.click('#fw-iso27001');
        await page.click('#ai-generate-btn');
        await page.waitForSelector('#ai-review-section', { timeout: 30000 });

        // Get title of first suggestion
        const firstTitle = await page.locator('#suggestion-0 h3').first().textContent();

        // Accept first, apply
        await page.click('#accept-0');
        await page.click('#apply-btn');
        await page.waitForSelector('#ai-done', { timeout: 30000 });

        // Navigate to risk register
        await page.click('#view-risks-btn');
        await page.waitForURL('**/risks', { timeout: 30000 });
        await page.waitForLoadState('networkidle').catch(() => {});

        // Verify the risk is in the register. R14 (#443) removed the
        // risks-page search box; the register now renders every row
        // (LIST_BACKFILL_CAP, no pagination — internal scroll only), so
        // assert against the full table directly.
        if (firstTitle) {
            await expect(page.locator('[data-testid="risks-table"]')).toContainText(
                firstTitle,
                { timeout: 15000 },
            );
        }
    });

    test('dismiss session returns to form', async ({ page }) => {
        await safeGoto(page, `/t/${tenantSlug}/risks/ai`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('#ai-generate-form', { timeout: 30000 });
        await page.click('#ai-generate-btn');
        await page.waitForSelector('#ai-review-section', { timeout: 30000 });

        // Dismiss
        await page.click('#dismiss-btn');

        // Should return to form
        await page.waitForSelector('#ai-generate-form', { timeout: 30000 });
        await expect(page.locator('#ai-generate-form')).toBeVisible();
    });
});
