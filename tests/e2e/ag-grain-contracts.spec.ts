/**
 * Tier-1 ag workflow — grain marketing contract.
 *
 * Regression-proofs the financial contracting surface: a SALE contract is
 * created with volume/price and is retrievable + correctly filtered by
 * type (SALE vs PURCHASE). Encrypted free-text (terms/pricingNotes) is
 * out of scope here — covered by the encryption manifest tests.
 *
 * GRAIN module (on by default). Synchronous path. Seeds via the API.
 */
import { test, expect } from './fixtures';

test('grain contract: create a SALE contract and filter the list by type', async ({ authedPage, isolatedTenant }) => {
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request;

    const res = await api.post(`/api/t/${slug}/grain/contracts`, {
        data: {
            counterparty: 'AgriBuyer Ltd',
            commodity: 'Wheat',
            type: 'SALE',
            status: 'ACTIVE',
            volumeTonnes: 500,
            pricePerTonne: 210,
            priceCurrency: 'GBP',
        },
    });
    expect(res.status(), `create contract: ${await res.text()}`).toBe(201);
    const contract = await res.json();
    expect(contract.counterparty).toBe('AgriBuyer Ltd');

    // type filter: present under SALE, absent under PURCHASE.
    const sale = await (await api.get(`/api/t/${slug}/grain/contracts?type=SALE`)).json();
    expect((sale as Array<{ id: string }>).some((c) => c.id === contract.id)).toBe(true);
    const purchase = await (await api.get(`/api/t/${slug}/grain/contracts?type=PURCHASE`)).json();
    expect((purchase as Array<{ id: string }>).some((c) => c.id === contract.id)).toBe(false);

    // UI: the contracts page lists the counterparty.
    await authedPage.goto(`/t/${slug}/grain/contracts`);
    await expect(authedPage.getByText('AgriBuyer Ltd').first()).toBeVisible();
});
