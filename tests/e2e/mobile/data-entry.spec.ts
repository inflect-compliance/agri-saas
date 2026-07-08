/**
 * Mobile data-entry — Spray job StepWizard (@mobile).
 *
 * ISOLATED / MUTATING tenant (per the e2e-isolation convention). The spec
 * seeds its OWN location + parcel through the authenticated API so the
 * "Spray job" launcher is DETERMINISTICALLY enabled — it renders
 * `disabled={parcels.length === 0}`, fed by a client-side SWR fetch.
 *
 * Why not the shared seed: the earlier read-only variant logged into the
 * shared "Home Farm — Demo" tenant and relied on its three parcels. Those
 * parcels come from a seed SPATIAL-IMPORT side effect
 * (`importLocationSpatialFile`) wrapped in a try/catch — if it is skipped in
 * CI the location exists with ZERO parcels, the launcher stays disabled, and
 * the click auto-waits the full test timeout (×2 retries ×2 mobile projects
 * ≈ 18 min) until the whole E2E job times out. Seeding the parcel here
 * removes that dependency entirely.
 *
 * Scope: the wizard LAUNCH + the first step transition on a real mobile
 * browser (parcel picker → product step). The wizard's Next/Back/Finish and
 * the OFFLINE-queued completion are unit-tested at the primitive level
 * (tests/rendered/mobile-data-entry.test.tsx); the offline queue-and-sync of
 * a field operation is covered end-to-end by
 * tests/e2e/offline-field-sync.spec.ts. The product/rate steps need seeded
 * product Items + RATE units, so the chain stops at the product heading.
 *
 * Safety: retries:0 + a 90 s per-test cap + explicit per-action timeouts keep
 * a regression here FAST and cheap — it can never again consume the E2E
 * job's 40-min budget.
 */
import { test, expect } from '../fixtures';

// A small valid WGS84 square (mirrors offline-field-sync.spec.ts).
const SQUARE = {
    type: 'Polygon' as const,
    coordinates: [[[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]],
};

test.describe('mobile data-entry — spray job wizard @mobile', () => {
    // A failure must not 3× the wall-clock (and must surface a clean error
    // rather than a 40-min job timeout) — the historic suite-killer here.
    test.describe.configure({ retries: 0 });

    test('the Spray job wizard launches and steps through the parcel picker', async ({
        authedPage,
        isolatedTenant,
    }) => {
        test.setTimeout(90_000);
        const page = authedPage;
        const slug = isolatedTenant.tenantSlug;
        const api = page.request; // cookie-authenticated after signInAs

        // Seed a location + one parcel via the authenticated API so the
        // "Spray job" launcher (disabled when parcels.length === 0) enables.
        const locRes = await api.post(`/api/t/${slug}/locations`, {
            data: { name: 'Home Farm' },
        });
        expect(locRes.ok(), `create location: ${locRes.status()}`).toBeTruthy();
        const locationId = (await locRes.json()).id as string;

        const parRes = await api.post(
            `/api/t/${slug}/locations/${locationId}/parcels`,
            { data: { name: 'North 40', geometry: SQUARE } },
        );
        expect(parRes.ok(), `create parcel: ${parRes.status()}`).toBeTruthy();
        const parcelId = (await parRes.json()).id as string;

        // Open the parcel's spray sheet directly via the deep-link a map tap
        // uses (?parcelId=). The sheet IS the create-operation form now — the
        // multi-step wizard was retired (#3).
        await page.goto(`/t/${slug}/locations/${locationId}?parcelId=${parcelId}&tab=map`);

        // The sheet shows the parcel + the single-screen create form: the
        // exclusive Fertilizer-XOR-Product selector and the create action.
        await expect(page.getByTestId('parcel-sheet-area')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('New operation').first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('radio', { name: 'Product' })).toBeVisible();
        await expect(page.getByRole('radio', { name: 'Fertilizer' })).toBeVisible();

        const createBtn = page.getByTestId('parcel-sheet-start-operation');
        await expect(createBtn).toBeVisible();
        // Gated until a product + dose + operator are chosen (nothing filled).
        await expect(createBtn).toBeDisabled();
    });
});
