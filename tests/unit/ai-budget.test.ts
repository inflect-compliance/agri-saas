/**
 * AI monthly token budget — unit tests.
 *
 * Mocks the entitlement primitives so the budget thresholds (hard-stop /
 * soft-warn / unlimited) are tested in isolation without a DB.
 */
import { makeRequestContext } from '../helpers/make-context';

const mockGetEffectivePlan = jest.fn();
const mockGetLimit = jest.fn();
const mockGetUsed = jest.fn();
const mockGetMode = jest.fn(() => 'SAAS');

jest.mock('@/lib/billing/entitlements', () => ({
    getEffectivePlan: (...a: unknown[]) => mockGetEffectivePlan(...a),
    getLimit: (...a: unknown[]) => mockGetLimit(...a),
    getAiTokensUsedThisMonth: (...a: unknown[]) => mockGetUsed(...a),
    getBillingMode: () => mockGetMode(),
}));

import { assertAiBudget } from '@/app-layer/ai/budget';
import { ForbiddenError } from '@/lib/errors/types';

const ctx = makeRequestContext('ADMIN');

beforeEach(() => {
    jest.clearAllMocks();
    mockGetMode.mockReturnValue('SAAS');
});

describe('assertAiBudget', () => {
    it('passes under the limit and reports remaining', async () => {
        mockGetEffectivePlan.mockResolvedValue('PRO');
        mockGetLimit.mockReturnValue(1000);
        mockGetUsed.mockResolvedValue(100);
        const status = await assertAiBudget(ctx);
        expect(status.used).toBe(100);
        expect(status.limit).toBe(1000);
        expect(status.remaining).toBe(900);
        expect(status.softWarn).toBe(false);
    });

    it('hard-stops at the limit with forbidden(ai_budget_exceeded...)', async () => {
        mockGetEffectivePlan.mockResolvedValue('FREE');
        mockGetLimit.mockReturnValue(50_000);
        mockGetUsed.mockResolvedValue(50_000);
        await expect(assertAiBudget(ctx)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(assertAiBudget(ctx)).rejects.toThrow(/ai_budget_exceeded/);
    });

    it('hard-stops when over the limit', async () => {
        mockGetEffectivePlan.mockResolvedValue('FREE');
        mockGetLimit.mockReturnValue(50_000);
        mockGetUsed.mockResolvedValue(60_000);
        await expect(assertAiBudget(ctx)).rejects.toThrow(/ai_budget_exceeded/);
    });

    it('soft-warns at >= 80% without blocking', async () => {
        mockGetEffectivePlan.mockResolvedValue('PRO');
        mockGetLimit.mockReturnValue(1000);
        mockGetUsed.mockResolvedValue(800);
        const status = await assertAiBudget(ctx);
        expect(status.softWarn).toBe(true);
        expect(status.remaining).toBe(200);
    });

    it('does NOT soft-warn just below 80%', async () => {
        mockGetEffectivePlan.mockResolvedValue('PRO');
        mockGetLimit.mockReturnValue(1000);
        mockGetUsed.mockResolvedValue(799);
        const status = await assertAiBudget(ctx);
        expect(status.softWarn).toBe(false);
    });

    it('never blocks when the limit is null (self-hosted / ENTERPRISE)', async () => {
        mockGetEffectivePlan.mockResolvedValue('ENTERPRISE');
        mockGetLimit.mockReturnValue(null);
        const status = await assertAiBudget(ctx);
        expect(status.limit).toBeNull();
        expect(status.remaining).toBeNull();
        expect(status.softWarn).toBe(false);
        // Usage is not even queried when unlimited.
        expect(mockGetUsed).not.toHaveBeenCalled();
    });
});
