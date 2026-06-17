/**
 * Tier-1 ag workflow — spray operation → stock-ledger deduction.
 *
 * THE financial/regulatory path: an operator completes a spray job and
 * each parcel line, on DONE, deducts dose×area of product from the FEFO
 * inventory lot through the append-only hash-chained ledger, and the job
 * auto-resolves once no PENDING lines remain. A regression here means a
 * mis-stated input cost + a broken spray record — both audit-critical.
 *
 * Asserts entirely against server truth (the lot ledger + job progress),
 * with one UI check that the operator page renders. Synchronous path —
 * no worker needed (markOperationParcel deducts inline).
 *
 * Mutating spec → isolated empty tenant; seeds via ag-fixtures.
 */
import { test, expect } from './fixtures';
import { agPrisma, seedSprayScenario } from './ag-fixtures';

test('spray job: marking lines DONE deducts dose×area from the FEFO lot', async ({ authedPage, isolatedTenant }) => {
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request;
    const prisma = agPrisma();
    try {
        const sc = await seedSprayScenario(
            api, prisma, slug, isolatedTenant.tenantId, isolatedTenant.ownerUserId,
            { dose: 2, opening: 1000 },
        );

        // Opening stock is the RECEIPT total.
        const before = (await (await api.get(`/api/t/${slug}/inventory/lots/${sc.lotId}`)).json()).quantityOnHand as number;
        expect(before).toBe(1000);

        // The job has one prescription line per parcel.
        const op = await (await api.get(`/api/t/${slug}/field-operations/${sc.taskId}`)).json();
        const lines = op.lines as Array<{ id: string; parcel: { areaHa: string | number } }>;
        expect(lines.length).toBe(3);

        // Mark every line DONE → each deducts dose (2 L/ha) × parcel area.
        let expectedConsumed = 0;
        for (const line of lines) {
            expectedConsumed += 2 * Number(line.parcel.areaHa);
            const mark = await api.patch(
                `/api/t/${slug}/field-operations/${sc.taskId}/parcels/${line.id}`,
                { data: { status: 'DONE' } },
            );
            expect(mark.ok(), `mark line ${line.id}: ${mark.status()}`).toBeTruthy();
        }

        // Lot on-hand fell by sum(dose×area); the ledger carries 3 CONSUMPTION rows.
        const after = await (await api.get(`/api/t/${slug}/inventory/lots/${sc.lotId}`)).json();
        expect(after.quantityOnHand).toBeLessThan(before);
        expect(before - after.quantityOnHand).toBeCloseTo(expectedConsumed, 1);
        const consumptions = (after.ledger as Array<{ type: string }>).filter((t) => t.type === 'CONSUMPTION');
        expect(consumptions.length).toBe(3);

        // Job auto-resolved — every line is no longer PENDING.
        const opAfter = await (await api.get(`/api/t/${slug}/field-operations/${sc.taskId}`)).json();
        expect(opAfter.progress.done).toBe(3);

        // UI: the operator field page renders the job.
        await authedPage.goto(`/t/${slug}/field/${sc.taskId}`);
        await expect(authedPage.getByText('North 40')).toBeVisible();
    } finally {
        await prisma.$disconnect();
    }
});
