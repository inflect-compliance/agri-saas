/* eslint-disable @typescript-eslint/no-explicit-any -- standard
 * test-mock pattern; per-line typing has poor cost/benefit ratio. */

/**
 * Coverage for the equipment read usecase.
 *
 * `listEquipment` is a thin authorized read — it asserts canRead, then
 * delegates to `JournalRepository.listEquipment` inside the tenant context
 * (RLS-bound). Mocks the db-context + repository; uses the REAL
 * `assertCanRead` via the role on the RequestContext so the read gate is
 * exercised for real.
 *
 * Also satisfies the usecase-test-coverage guardrail (every usecase file
 * must be imported by a test).
 */

const mockDb = {} as any;

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
}));

jest.mock('@/app-layer/repositories/JournalRepository', () => ({
    JournalRepository: { listEquipment: jest.fn() },
}));

import { JournalRepository } from '@/app-layer/repositories/JournalRepository';
import { listEquipment } from '@/app-layer/usecases/equipment';
import { makeRequestContext } from '../helpers/make-context';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('listEquipment', () => {
    it('returns the repository rows for a reader, scoped to the tenant context', async () => {
        const rows = [
            { id: 'eq-1', name: 'John Deere 6155R' },
            { id: 'eq-2', name: 'Boom sprayer' },
        ];
        (JournalRepository.listEquipment as jest.Mock).mockResolvedValue(rows);

        const ctx = makeRequestContext('READER');
        await expect(listEquipment(ctx)).resolves.toBe(rows);
        expect(JournalRepository.listEquipment).toHaveBeenCalledWith(mockDb, ctx);
    });

    it('an EDITOR (canRead) also passes the read gate', async () => {
        (JournalRepository.listEquipment as jest.Mock).mockResolvedValue([]);
        const ctx = makeRequestContext('EDITOR');
        await expect(listEquipment(ctx)).resolves.toEqual([]);
        expect(JournalRepository.listEquipment).toHaveBeenCalledTimes(1);
    });
});
