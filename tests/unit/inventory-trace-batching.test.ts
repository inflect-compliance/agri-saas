/**
 * Lock the traceability genealogy walk to BATCHED BFS — one repository
 * query per genealogy LEVEL, never one per node (the N+1 it must not be).
 *
 * `traceLot` walks ancestors (LotLink by childLotId) and descendants
 * (by parentLotId) breadth-first, passing the WHOLE frontier of the
 * previous level as a single `{ in: [...] }` query. This test mocks the
 * repository and asserts the call shape directly — so a refactor that
 * reintroduces a per-node query (e.g. looping `listParentLinks` over each
 * parent) fails here, DB-free.
 */
import { makeRequestContext } from '../helpers/make-context';

// Invoke the runInTenantContext callback with a minimal fake db.
const fakeDb = { parcel: { findMany: jest.fn().mockResolvedValue([]) } };
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeDb),
}));

// Mock the repository so we can assert the call shape.
const getLotsByIds = jest.fn();
const listParentLinks = jest.fn();
const listChildLinks = jest.fn();
const findConsumptionParcels = jest.fn();
jest.mock('@/app-layer/repositories/InventoryRepository', () => ({
    InventoryRepository: { getLotsByIds, listParentLinks, listChildLinks, findConsumptionParcels },
}));

import { traceLot } from '@/app-layer/usecases/inventory';

function lot(id: string) {
    return {
        id,
        lotCode: id.toUpperCase(),
        quantityOnHand: 0,
        attributesJson: null,
        receivedAt: null,
        item: { id: `item-${id}`, name: `Item ${id}`, category: 'PESTICIDE' },
        unit: { id: 'u', symbol: 'L' },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.parcel.findMany.mockResolvedValue([]);
    // getLotsByIds returns a lot per requested id (root check + final fetch).
    getLotsByIds.mockImplementation((_db: unknown, _ctx: unknown, ids: string[]) => ids.map(lot));
    findConsumptionParcels.mockResolvedValue([]);
    // Descendants: none (keeps the test focused on the ancestor walk).
    listChildLinks.mockResolvedValue([]);
});

describe('traceLot — batched BFS (no N+1)', () => {
    it('queries parents once PER LEVEL with the whole frontier, not once per node', async () => {
        // Genealogy: R has 2 parents (p1, p2); p1 has 1 parent (g1).
        //   level 1 frontier [R]      → p1, p2
        //   level 2 frontier [p1,p2]  → g1     (BATCHED — both parents in one call)
        //   level 3 frontier [g1]     → ∅
        listParentLinks.mockImplementation((_db: unknown, _ctx: unknown, childIds: string[]) => {
            if (childIds.includes('R')) {
                return Promise.resolve([
                    { parentLotId: 'p1', childLotId: 'R', type: 'DERIVATION' },
                    { parentLotId: 'p2', childLotId: 'R', type: 'DERIVATION' },
                ]);
            }
            if (childIds.includes('p1') || childIds.includes('p2')) {
                return Promise.resolve([{ parentLotId: 'g1', childLotId: 'p1', type: 'DERIVATION' }]);
            }
            return Promise.resolve([]);
        });

        const ctx = makeRequestContext('EDITOR', { userId: 'u1', tenantId: 't1', tenantSlug: 'acme' });
        const result = await traceLot(ctx, 'R');

        // 3 ancestor levels (the third returns ∅) — NOT 4 (one per node).
        expect(listParentLinks).toHaveBeenCalledTimes(3);
        // The level-2 call carries BOTH parents in a single frontier array
        // — the proof of batching (a per-node N+1 would be two calls here).
        const level2Frontier = listParentLinks.mock.calls[1][2];
        expect([...level2Frontier].sort()).toEqual(['p1', 'p2']);

        // The lot fetch is a single batched call over every collected id.
        const finalFetch = getLotsByIds.mock.calls.at(-1)![2];
        expect([...finalFetch].sort()).toEqual(['R', 'g1', 'p1', 'p2'].sort());
        // Consumption-parcel resolution is one batched call, not per-lot.
        expect(findConsumptionParcels).toHaveBeenCalledTimes(1);

        expect(result.root.id).toBe('R');
        expect(result.ancestors.map((a) => a.id).sort()).toEqual(['g1', 'p1', 'p2']);
    });

    it('a wide single level is still ONE query (frontier batched)', async () => {
        // R has 5 parents, none with further ancestors.
        listParentLinks.mockImplementation((_db: unknown, _ctx: unknown, childIds: string[]) => {
            if (childIds.includes('R')) {
                return Promise.resolve(
                    ['a', 'b', 'c', 'd', 'e'].map((p) => ({ parentLotId: p, childLotId: 'R', type: 'DERIVATION' })),
                );
            }
            return Promise.resolve([]);
        });

        const ctx = makeRequestContext('EDITOR', { userId: 'u1', tenantId: 't1', tenantSlug: 'acme' });
        await traceLot(ctx, 'R');

        // 5 parents at one level ⇒ 2 calls total (level 1 fans out, level 2 is ∅)
        // — emphatically NOT 5 (one per parent).
        expect(listParentLinks).toHaveBeenCalledTimes(2);
        expect([...listParentLinks.mock.calls[1][2]].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
});
