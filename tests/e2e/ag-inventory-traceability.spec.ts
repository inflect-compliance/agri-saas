/**
 * Tier-1 ag workflow — inventory lot traceability.
 *
 * Regression-proofs the food-safety / audit base layer: every quantity
 * change on a lot is an append-only, hash-chained ledger entry (RECEIPT /
 * RECEIPT / ADJUSTMENT), the denormalised on-hand stays the ledger sum,
 * and the recall-walk endpoint (`/trace`) returns the lot's genealogy.
 *
 * Synchronous path — no worker needed. Seeds via ag-fixtures (Item via
 * Prisma — no create-API; lot + ledger via the authenticated API).
 */
import { test, expect } from './fixtures';
import { agPrisma, resolveUnits, createProduct, createLot } from './ag-fixtures';

test('inventory: a lot keeps an append-only hash-chained ledger + trace graph', async ({ authedPage, isolatedTenant }) => {
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request;
    const prisma = agPrisma();
    try {
        const units = await resolveUnits(prisma);
        const itemId = await createProduct(prisma, isolatedTenant.tenantId, 'Calcium Nitrate', units.kg, 'FERTILIZER', 200);
        const lotId = await createLot(api, slug, itemId, 'CAN-2026-01', 500);

        // Receive more, then adjust down for spillage.
        const recv = await api.post(`/api/t/${slug}/inventory/lots/${lotId}/receive`, { data: { quantity: 250 } });
        expect(recv.ok(), `receive: ${recv.status()}`).toBeTruthy();
        const adj = await api.post(`/api/t/${slug}/inventory/lots/${lotId}/adjust`, { data: { delta: -100, reason: 'spillage' } });
        expect(adj.ok(), `adjust: ${adj.status()}`).toBeTruthy();

        // On-hand == ledger sum (500 + 250 − 100 = 650); every row hash-chained.
        const lot = await (await api.get(`/api/t/${slug}/inventory/lots/${lotId}`)).json();
        expect(lot.quantityOnHand).toBe(650);
        expect(lot.ledger.length).toBeGreaterThanOrEqual(3);
        for (const t of lot.ledger as Array<{ entryHash: string }>) {
            expect(t.entryHash, 'each ledger entry is hash-chained').toBeTruthy();
        }

        // The recall-walk endpoint responds with a genealogy structure.
        const trace = await api.get(`/api/t/${slug}/inventory/lots/${lotId}/trace`);
        expect(trace.ok(), `trace: ${trace.status()}`).toBeTruthy();

        // UI: the inventory page lists the product.
        await authedPage.goto(`/t/${slug}/inventory`);
        await expect(authedPage.getByText('Calcium Nitrate').first()).toBeVisible();
    } finally {
        await prisma.$disconnect();
    }
});
