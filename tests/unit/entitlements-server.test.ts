/**
 * Branch coverage for the server-side entitlement gate.
 *
 * `entitlements-server.ts` is the boundary that turns a tenant's
 * billing plan into a hard 403 when a feature isn't included. The
 * branches that carry product risk:
 *
 *   - getTenantPlan: billing account present → its plan;
 *     absent → null (billing not configured → ungated)
 *   - requireFeature: null plan → pass-through (self-hosted /
 *     billing-off); plan present + feature included → pass;
 *     plan present + feature missing → throw EntitlementError
 *   - EntitlementError carries the typed code/status/requiredPlan/
 *     feature fields the route mapper reads
 *
 * Prisma is mocked — these are pure decision-logic assertions.
 */

const findUniqueMock = jest.fn();
const findManyMock = jest.fn();
const settingsFindUniqueMock = jest.fn();

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        billingAccount: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
        billingEvent: { findMany: (...a: unknown[]) => findManyMock(...a) },
        tenantModuleSettings: { findUnique: (...a: unknown[]) => settingsFindUniqueMock(...a) },
    },
}));

import {
    EntitlementError,
    getTenantPlan,
    requireFeature,
    listBillingEvents,
    getAvailableModulesForTenant,
} from '@/lib/entitlements-server';
import { FEATURES } from '@/lib/entitlements';

beforeEach(() => {
    findUniqueMock.mockReset();
    findManyMock.mockReset();
    settingsFindUniqueMock.mockReset();
});

describe('getTenantPlan', () => {
    it('returns the plan when a billing account exists', async () => {
        findUniqueMock.mockResolvedValueOnce({ plan: 'PRO' });
        await expect(getTenantPlan('t1')).resolves.toBe('PRO');
    });

    it('returns null when no billing account exists', async () => {
        findUniqueMock.mockResolvedValueOnce(null);
        await expect(getTenantPlan('t1')).resolves.toBeNull();
    });

    it('queries by tenantId', async () => {
        findUniqueMock.mockResolvedValueOnce({ plan: 'FREE' });
        await getTenantPlan('tenant-xyz');
        expect(findUniqueMock).toHaveBeenCalledWith({
            where: { tenantId: 'tenant-xyz' },
            select: { plan: true },
        });
    });
});

describe('requireFeature', () => {
    it('passes through when no billing account exists (ungated)', async () => {
        findUniqueMock.mockResolvedValueOnce(null);
        await expect(
            requireFeature('t1', FEATURES.CUSTOM_INTEGRATIONS),
        ).resolves.toBeUndefined();
    });

    it('passes when the plan includes the feature', async () => {
        findUniqueMock.mockResolvedValueOnce({ plan: 'ENTERPRISE' });
        await expect(
            requireFeature('t1', FEATURES.CUSTOM_INTEGRATIONS),
        ).resolves.toBeUndefined();
    });

    it('passes for a feature at exactly the tenant plan level', async () => {
        // PDF_EXPORTS requires TRIAL; a TRIAL tenant is exactly at the bar.
        findUniqueMock.mockResolvedValueOnce({ plan: 'TRIAL' });
        await expect(
            requireFeature('t1', FEATURES.PDF_EXPORTS),
        ).resolves.toBeUndefined();
    });

    it('throws EntitlementError when the plan lacks the feature', async () => {
        findUniqueMock.mockResolvedValueOnce({ plan: 'FREE' });
        await expect(
            requireFeature('t1', FEATURES.AUDIT_PACK_SHARING),
        ).rejects.toBeInstanceOf(EntitlementError);
    });

    it('the thrown error carries the typed code, status, and required plan', async () => {
        findUniqueMock.mockResolvedValueOnce({ plan: 'TRIAL' });

        let caught: EntitlementError | undefined;
        try {
            await requireFeature('t1', FEATURES.CUSTOM_INTEGRATIONS);
        } catch (err) {
            caught = err as EntitlementError;
        }

        expect(caught).toBeInstanceOf(EntitlementError);
        expect(caught?.code).toBe('PLAN_REQUIRED');
        expect(caught?.status).toBe(403);
        expect(caught?.requiredPlan).toBe('ENTERPRISE');
        expect(caught?.feature).toBe(FEATURES.CUSTOM_INTEGRATIONS);
        // Message names both the required and current plan for the UI.
        expect(caught?.message).toContain('ENTERPRISE');
        expect(caught?.message).toContain('TRIAL');
    });
});

describe('EntitlementError', () => {
    it('is a real Error with the documented name', () => {
        const err = new EntitlementError({
            message: 'nope',
            requiredPlan: 'PRO',
            feature: FEATURES.AUDIT_PACK_SHARING,
        });
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('EntitlementError');
        expect(err.message).toBe('nope');
        expect(err.code).toBe('PLAN_REQUIRED');
        expect(err.status).toBe(403);
    });
});

describe('getAvailableModulesForTenant', () => {
    it('intersects the plan ceiling with the tenant toggle (FREE + all-enabled)', async () => {
        findUniqueMock.mockResolvedValueOnce({ plan: 'FREE' });
        settingsFindUniqueMock.mockResolvedValueOnce(null); // no row → all tenant-enabled
        // Exchange is FREE (network-effect product), so it joins the three
        // simple-mode modules in the FREE-plan availability set.
        expect((await getAvailableModulesForTenant('t1')).sort()).toEqual(
            ['EXCHANGE', 'INVENTORY', 'JOURNAL', 'PLANNING'],
        );
    });

    it('null plan (self-hosted) defers to the tenant list verbatim', async () => {
        findUniqueMock.mockResolvedValueOnce(null); // no billing account → plan null
        settingsFindUniqueMock.mockResolvedValueOnce({ enabledModules: ['JOURNAL', 'CERTIFICATION'] });
        expect((await getAvailableModulesForTenant('t1')).sort()).toEqual(
            ['CERTIFICATION', 'JOURNAL'],
        );
    });

    it('drops a tenant-enabled module the plan does not reach (PRO keeps AI off)', async () => {
        findUniqueMock.mockResolvedValueOnce({ plan: 'PRO' });
        settingsFindUniqueMock.mockResolvedValueOnce({ enabledModules: ['JOURNAL', 'AI'] });
        // AI requires ENTERPRISE → filtered out even though the tenant enabled it.
        expect(await getAvailableModulesForTenant('t1')).toEqual(['JOURNAL']);
    });
});

describe('listBillingEvents', () => {
    it('returns events ordered newest-first with the default limit', async () => {
        const events = [{ id: 'e1' }, { id: 'e2' }];
        findManyMock.mockResolvedValueOnce(events);

        const result = await listBillingEvents('t1');

        expect(result).toBe(events);
        expect(findManyMock).toHaveBeenCalledWith({
            where: { tenantId: 't1' },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
                id: true,
                type: true,
                stripeEventId: true,
                createdAt: true,
            },
        });
    });

    it('honours a custom limit', async () => {
        findManyMock.mockResolvedValueOnce([]);
        await listBillingEvents('t1', 5);
        expect(findManyMock.mock.calls[0][0].take).toBe(5);
    });
});
