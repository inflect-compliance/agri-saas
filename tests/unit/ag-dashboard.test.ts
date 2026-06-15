/* eslint-disable @typescript-eslint/no-explicit-any -- standard
 * test-mock pattern; per-line typing has poor cost/benefit ratio. */

/**
 * Coverage for the agriculture dashboard read-model.
 *
 * `getAgDashboard` is a THIN aggregation over three existing list
 * usecases (journal / inventory / farm-task), gated by the tenant's
 * enabled modules. The behaviour worth locking:
 *   - each card slices to STRIP_LIMIT (5),
 *   - low-stock is the `lowStock:true` subset of the lots read,
 *   - a disabled ag module short-circuits its fetch (empty list, no call),
 *   - the farm-tasks queue is ALWAYS fetched (Tasks is not module-gated).
 *
 * The four dependency usecases are mocked; `assertCanRead` runs for real
 * via the role on the RequestContext.
 *
 * Also satisfies the usecase-test-coverage guardrail.
 */

const listLogEntries = jest.fn();
const listLots = jest.fn();
const listMyFarmTasks = jest.fn();
const getEnabledModules = jest.fn();

jest.mock('@/app-layer/usecases/journal', () => ({
    listLogEntries: (...a: any[]) => listLogEntries(...a),
}));
jest.mock('@/app-layer/usecases/inventory', () => ({
    listLots: (...a: any[]) => listLots(...a),
}));
jest.mock('@/app-layer/usecases/farm-task', () => ({
    listMyFarmTasks: (...a: any[]) => listMyFarmTasks(...a),
}));
jest.mock('@/app-layer/usecases/modules', () => ({
    getEnabledModules: (...a: any[]) => getEnabledModules(...a),
}));

import { getAgDashboard } from '@/app-layer/usecases/ag-dashboard';
import { makeRequestContext } from '../helpers/make-context';

const ctx = makeRequestContext('READER');

beforeEach(() => {
    jest.clearAllMocks();
});

function journalEntry(i: number) {
    return { id: `j${i}`, type: 'HARVEST', title: `Entry ${i}`, occurredAt: new Date('2026-06-01T00:00:00Z') };
}
function lot(id: string, lowStock: boolean) {
    return {
        id,
        lowStock,
        quantityOnHand: 3,
        item: { name: `Item ${id}` },
        unit: { symbol: 'kg' },
    };
}
function task(i: number) {
    return { id: `t${i}`, title: `Task ${i}`, status: 'TODO', dueAt: new Date('2026-06-10T00:00:00Z') };
}

describe('getAgDashboard', () => {
    it('both ag modules on — slices each card to ≤5 and maps the shape', async () => {
        getEnabledModules.mockResolvedValue(['JOURNAL', 'INVENTORY', 'CERTIFICATION']);
        listLogEntries.mockResolvedValue(Array.from({ length: 7 }, (_, i) => journalEntry(i)));
        listLots.mockResolvedValue([lot('a', true), lot('b', false), lot('c', true)]);
        listMyFarmTasks.mockResolvedValue(Array.from({ length: 6 }, (_, i) => task(i)));

        const out = await getAgDashboard(ctx);

        expect(out.enabledModules).toEqual(['JOURNAL', 'INVENTORY', 'CERTIFICATION']);
        // Journal sliced 7 → 5, ISO-stringified.
        expect(out.recentJournal).toHaveLength(5);
        expect(out.recentJournal[0]).toEqual({
            id: 'j0',
            type: 'HARVEST',
            title: 'Entry 0',
            occurredAt: '2026-06-01T00:00:00.000Z',
        });
        // Low-stock is the lowStock:true subset only.
        expect(out.lowStock.map((l) => l.id)).toEqual(['a', 'c']);
        expect(out.lowStock[0]).toEqual({ id: 'a', name: 'Item a', quantityOnHand: 3, unitSymbol: 'kg' });
        // Tasks sliced 6 → 5.
        expect(out.myTasks).toHaveLength(5);
        expect(out.myTasks[0]).toEqual({ id: 't0', title: 'Task 0', status: 'TODO', dueAt: '2026-06-10T00:00:00.000Z' });
    });

    it('pure-GRC tenant (no ag modules) short-circuits journal + inventory fetches', async () => {
        getEnabledModules.mockResolvedValue(['CERTIFICATION', 'RISK']);
        listMyFarmTasks.mockResolvedValue([task(0)]);

        const out = await getAgDashboard(ctx);

        // The two ag lists are never fetched when their module is off.
        expect(listLogEntries).not.toHaveBeenCalled();
        expect(listLots).not.toHaveBeenCalled();
        expect(out.recentJournal).toEqual([]);
        expect(out.lowStock).toEqual([]);
        // Farm tasks are always fetched — Tasks is not module-gated.
        expect(listMyFarmTasks).toHaveBeenCalledTimes(1);
        expect(out.myTasks).toHaveLength(1);
    });

    it('handles null occurredAt / dueAt as null in the payload', async () => {
        getEnabledModules.mockResolvedValue(['JOURNAL']);
        listLogEntries.mockResolvedValue([{ id: 'j', type: 'NOTE', title: 'x', occurredAt: null }]);
        listLots.mockResolvedValue([]);
        listMyFarmTasks.mockResolvedValue([{ id: 't', title: 'y', status: 'TODO', dueAt: null }]);

        const out = await getAgDashboard(ctx);
        expect(out.recentJournal[0].occurredAt).toBeNull();
        expect(out.myTasks[0].dueAt).toBeNull();
    });
});
