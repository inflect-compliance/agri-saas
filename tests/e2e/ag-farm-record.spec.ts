/**
 * Tier-1 ag workflow — БАБХ ДНЕВНИК manual generation + register.
 *
 * An operator completes a spray job; each DONE line mints an
 * INPUT_APPLICATION journal entry (the diary's source rows). The manual
 * "Дневник (PDF)" generation then produces a valid application/pdf, and
 * saving it lands a row in the location's Farm-records register.
 *
 * The AUTO-generation-on-completion job enqueue is proven by the unit test
 * on the resolution hook — e2e CI runs no BullMQ worker, so this spec covers
 * only the MANUAL path + the register listing.
 *
 * Mutating spec → isolated empty tenant; seeds via ag-fixtures.
 */
import { test, expect } from './fixtures';
import { agPrisma, seedSprayScenario } from './ag-fixtures';

test('farm-record: completing a spray job enables ДНЕВНИК generation + register listing', async ({
    authedPage,
    isolatedTenant,
}) => {
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request;
    const prisma = agPrisma();
    try {
        const sc = await seedSprayScenario(
            api, prisma, slug, isolatedTenant.tenantId, isolatedTenant.ownerUserId,
            { dose: 2, opening: 1000 },
        );

        // Complete every line → auto-resolve + INPUT_APPLICATION entries.
        const op = await (await api.get(`/api/t/${slug}/field-operations/${sc.taskId}`)).json();
        for (const line of op.lines as Array<{ id: string }>) {
            const mark = await api.patch(
                `/api/t/${slug}/field-operations/${sc.taskId}/parcels/${line.id}`,
                { data: { status: 'DONE' } },
            );
            expect(mark.ok(), `mark line ${line.id}: ${mark.status()}`).toBeTruthy();
        }

        const range = { from: '2026-01-01', to: '2026-12-31' };

        // Manual generation streams a real PDF.
        const pdf = await api.post(`/api/t/${slug}/locations/${sc.locationId}/farm-record`, {
            data: range,
        });
        expect(pdf.ok(), `generate: ${pdf.status()}`).toBeTruthy();
        expect(pdf.headers()['content-type']).toContain('application/pdf');
        const bytes = await pdf.body();
        expect(bytes.slice(0, 5).toString()).toBe('%PDF-');

        // Saving lands it in the register (domain 'reports').
        const saved = await api.post(`/api/t/${slug}/locations/${sc.locationId}/farm-record`, {
            data: { ...range, save: true },
        });
        expect(saved.ok(), `save: ${saved.status()}`).toBeTruthy();
        expect((await saved.json()).fileRecordId).toBeTruthy();

        // The register lists the saved diary.
        const list = await (await api.get(`/api/t/${slug}/locations/${sc.locationId}/farm-records`)).json();
        expect(Array.isArray(list.records)).toBeTruthy();
        expect(list.records.length).toBeGreaterThan(0);

        // UI: the Farm-records tab renders the register.
        await authedPage.goto(`/t/${slug}/locations/${sc.locationId}?tab=records`);
        await expect(
            authedPage.getByRole('main').getByText('Изтегли').first(),
        ).toBeVisible();
    } finally {
        await prisma.$disconnect();
    }
});

test('farm-record: the location detail exposes the Дневник (PDF) action @mobile', async ({
    authedPage,
    isolatedTenant,
}) => {
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request;
    const prisma = agPrisma();
    try {
        const sc = await seedSprayScenario(
            api, prisma, slug, isolatedTenant.tenantId, isolatedTenant.ownerUserId,
            { dose: 2, opening: 1000 },
        );
        await authedPage.goto(`/t/${slug}/locations/${sc.locationId}`);
        await expect(authedPage.locator('#dnevnik-pdf-btn')).toBeVisible();
    } finally {
        await prisma.$disconnect();
    }
});
