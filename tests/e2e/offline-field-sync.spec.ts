/**
 * Offline operator PWA — end-to-end "queue-and-sync" proof.
 *
 * The original "Done" criterion for the operator PWA: an operator completes
 * a spray job with NO signal and it syncs on reconnect. This drives the real
 * browser through that flow:
 *
 *   1. Seed a field operation (one parcel line) for an isolated tenant.
 *   2. Open the operator job page online (so it loads + the SW registers).
 *   3. Go OFFLINE → mark the line Done → it shows DONE optimistically and the
 *      PATCH is QUEUED (the pending-sync count appears), with no network.
 *   4. Go back ONLINE → the outbox drains; the pending count clears.
 *   5. Reload (online) → the line is DONE from the SERVER — the queued
 *      mutation really synced, not just an optimistic/snapshot artefact.
 *
 * Mutating spec → isolated, empty tenant (per the e2e-isolation convention).
 * The operator field-op needs a product Item, which has no create-API, so it
 * is seeded directly via Prisma (same posture as the integration tests);
 * everything else is built through the authenticated API.
 */
import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// A small valid WGS84 square near [0,0] for the parcel geometry.
const SQUARE = {
    type: 'Polygon' as const,
    coordinates: [[[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]],
};

test('operator completes a spray job offline and it syncs on reconnect', async ({
    authedPage,
    isolatedTenant,
}) => {
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request; // cookie-authenticated after signInAs

    // 1 — Location + parcel via the authenticated API.
    const locRes = await api.post(`/api/t/${slug}/locations`, { data: { name: 'Home Farm' } });
    expect(locRes.ok(), `create location: ${locRes.status()}`).toBeTruthy();
    const locationId = (await locRes.json()).id as string;

    const parRes = await api.post(`/api/t/${slug}/locations/${locationId}/parcels`, {
        data: { name: 'North 40', geometry: SQUARE },
    });
    expect(parRes.ok(), `create parcel: ${parRes.status()}`).toBeTruthy();
    const parcelId = (await parRes.json()).id as string;

    // 2 — Product Item (no create-API) + a global Unit, via Prisma. Then the
    //     field operation through the API.
    const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    let taskId: string;
    try {
        const unit = await prisma.unit.findFirst({ select: { id: true } });
        if (!unit) throw new Error('no global Unit seeded — run import-units');
        const item = await prisma.item.create({
            data: {
                tenantId: isolatedTenant.tenantId,
                name: 'GlyphoMax 360',
                category: 'PESTICIDE',
                defaultUnitId: unit.id,
            },
            select: { id: true },
        });

        const opRes = await api.post(`/api/t/${slug}/locations/${locationId}/operations`, {
            data: {
                operationType: 'SPRAY',
                assigneeUserId: isolatedTenant.ownerUserId,
                parcelIds: [parcelId],
                productItemId: item.id,
                doseValue: 2,
                doseUnitId: unit.id,
            },
        });
        expect(opRes.ok(), `create operation: ${opRes.status()}`).toBeTruthy();
        taskId = (await opRes.json()).taskId as string;
    } finally {
        await prisma.$disconnect();
    }

    // 3 — Open the operator job page online; the line renders.
    await authedPage.goto(`/t/${slug}/field/${taskId}`);
    const main = authedPage.getByRole('main');
    await expect(authedPage.getByText('North 40')).toBeVisible();
    await expect(authedPage.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(authedPage.getByText('Online')).toBeVisible();

    // 4 — Go offline, mark Done. The line flips DONE optimistically and the
    //     mutation is queued (no network); the pending-sync count appears.
    await authedPage.context().setOffline(true);
    await expect(authedPage.getByText('Offline')).toBeVisible();
    await authedPage.getByRole('button', { name: 'Done' }).click();
    await expect(authedPage.getByText('DONE')).toBeVisible(); // optimistic
    await expect(authedPage.getByText('1 queued')).toBeVisible(); // outbox

    // 5 — Reconnect. The `online` event drains the outbox; the queue clears.
    await authedPage.context().setOffline(false);
    await expect(authedPage.getByText('1 queued')).toBeHidden({ timeout: 15_000 });

    // 6 — Reload online. The line is DONE from the SERVER (a fresh fetch, not
    //     the optimistic/snapshot copy) — the offline mark really synced.
    await authedPage.reload();
    await expect(authedPage.getByText('North 40')).toBeVisible();
    await expect(main.getByText('DONE')).toBeVisible();
    await expect(authedPage.getByRole('button', { name: 'Done' })).toHaveCount(0);
});
