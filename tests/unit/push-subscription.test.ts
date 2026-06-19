/**
 * push-subscription usecase — self-service Web Push subscription CRUD:
 * create-when-new, update-when-existing (idempotent re-subscribe), and
 * remove-by-endpoint. The tenant-context DB is mocked.
 */
import type { RequestContext } from '@/app-layer/types';

const findFirst = jest.fn();
const create = jest.fn();
const update = jest.fn();
const deleteMany = jest.fn();
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, cb: (db: unknown) => unknown) =>
        cb({ pushSubscription: { findFirst, create, update, deleteMany } }),
}));

import { savePushSubscription, removePushSubscription } from '@/app-layer/usecases/push-subscription';

const ctx = { tenantId: 't1', userId: 'u1', requestId: 'r' } as unknown as RequestContext;

beforeEach(() => {
    findFirst.mockReset();
    create.mockReset();
    update.mockReset();
    deleteMany.mockReset();
});

describe('push-subscription usecase', () => {
    it('creates a new subscription when none exists', async () => {
        findFirst.mockResolvedValue(null);
        create.mockResolvedValue({ id: 'new' });
        const r = await savePushSubscription(ctx, { endpoint: 'https://e', p256dh: 'k', auth: 'a' });
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', userId: 'u1', endpoint: 'https://e' });
        expect(r).toEqual({ id: 'new' });
    });

    it('updates an existing subscription (idempotent re-subscribe)', async () => {
        findFirst.mockResolvedValue({ id: 'existing' });
        update.mockResolvedValue({ id: 'existing' });
        const r = await savePushSubscription(ctx, { endpoint: 'https://e', p256dh: 'k2', auth: 'a2', userAgent: 'UA' });
        expect(update).toHaveBeenCalledWith({ where: { id: 'existing' }, data: { p256dh: 'k2', auth: 'a2', userAgent: 'UA' } });
        expect(create).not.toHaveBeenCalled();
        expect(r).toEqual({ id: 'existing' });
    });

    it('removes a subscription by endpoint', async () => {
        deleteMany.mockResolvedValue({ count: 1 });
        await removePushSubscription(ctx, 'https://e');
        expect(deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1', userId: 'u1', endpoint: 'https://e' } });
    });
});
