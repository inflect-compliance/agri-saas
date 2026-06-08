/* eslint-disable @typescript-eslint/no-explicit-any -- test-mock pattern. */
/** EI-1 — entra-provider usecase: permission + config validation. */
const mockDb = { tenantIdentityProvider: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() } };
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: any, fn: (db: any) => any) => fn(mockDb),
}));
jest.mock('@/app-layer/events/audit', () => ({ logEvent: jest.fn() }));

import { getEntraProvider, upsertEntraProvider } from '@/app-layer/usecases/entra-provider';

const admin = { tenantId: 't1', userId: 'u1', permissions: { canAdmin: true } } as any;
const reader = { tenantId: 't1', userId: 'u2', permissions: { canAdmin: false } } as any;
beforeEach(() => jest.clearAllMocks());

describe('entra-provider usecase', () => {
    it('getEntraProvider rejects a non-admin', async () => {
        await expect(getEntraProvider(reader)).rejects.toBeDefined();
    });
    it('upsertEntraProvider rejects an invalid config', async () => {
        await expect(upsertEntraProvider(admin, { aadTenantId: 'x', clientId: 'y' })).rejects.toBeDefined();
    });
    it('upsertEntraProvider creates a provider on a valid config', async () => {
        mockDb.tenantIdentityProvider.findFirst.mockResolvedValue(null);
        mockDb.tenantIdentityProvider.create.mockResolvedValue({ id: 'p1' });
        const r = await upsertEntraProvider(admin, {
            aadTenantId: '11111111-1111-4111-8111-111111111111',
            clientId: '22222222-2222-4222-8222-222222222222',
        });
        expect(r.id).toBe('p1');
        expect(mockDb.tenantIdentityProvider.create).toHaveBeenCalled();
    });
});
