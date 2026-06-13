/* eslint-disable @typescript-eslint/no-explicit-any -- standard
 * test-mock pattern; per-line typing has poor cost/benefit ratio. */

/**
 * WP-2 module gating — unit tests.
 *
 * Two surfaces in one file:
 *   1. `src/lib/modules.ts` — pure helpers (no DB). The default-all
 *      contract (`resolveEnabledModules(null)` → every module) is the
 *      load-bearing invariant: gating a route stays backward-compatible
 *      until a tenant explicitly opts into a restricted list.
 *   2. `src/app-layer/usecases/modules.ts` — the DB-backed gate. Mocks
 *      the repository + db-context + audit emitter; uses real policy
 *      helpers via the role on the RequestContext so the read/admin
 *      gates are exercised for real.
 *
 * Also satisfies the usecase-test-coverage guardrail (every usecase
 * file must be imported by a test).
 */

const mockDb = {} as any;

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
}));

jest.mock('@/app-layer/repositories/ModuleSettingsRepository', () => ({
    ModuleSettingsRepository: {
        get: jest.fn(),
        upsert: jest.fn(),
    },
}));

jest.mock('@/app-layer/events/audit', () => ({
    logEvent: jest.fn(),
}));

import { ModuleSettingsRepository } from '@/app-layer/repositories/ModuleSettingsRepository';
import { logEvent } from '@/app-layer/events/audit';
import {
    ALL_MODULES,
    MODULE_LABELS,
    MODULE_DESCRIPTIONS,
    resolveEnabledModules,
    isModuleEnabledIn,
    coerceModuleKeys,
} from '@/lib/modules';
import {
    getEnabledModules,
    getModuleSettings,
    setEnabledModules,
    isModuleEnabled,
    assertModuleEnabled,
} from '@/app-layer/usecases/modules';
import { makeRequestContext } from '../helpers/make-context';

beforeEach(() => {
    jest.clearAllMocks();
});

const adminCtx = makeRequestContext('ADMIN', { userId: 'user-admin' });
const readerCtx = makeRequestContext('READER');

// ─── src/lib/modules.ts — pure helpers ─────────────────────────────

describe('pure helpers', () => {
    it('ALL_MODULES enumerates the nine canonical module keys', () => {
        expect(ALL_MODULES).toEqual([
            'JOURNAL',
            'INVENTORY',
            'PLANNING',
            'CERTIFICATION',
            'RISK',
            'VENDORS',
            'AUTOMATION',
            'PROCESSES',
            'AI',
        ]);
    });

    it('MODULE_LABELS has a non-empty label for every module key', () => {
        for (const key of ALL_MODULES) {
            expect(MODULE_LABELS[key]).toBeTruthy();
            expect(typeof MODULE_LABELS[key]).toBe('string');
        }
        // No stray labels for non-existent keys.
        expect(Object.keys(MODULE_LABELS).sort()).toEqual([...ALL_MODULES].sort());
    });

    it('MODULE_DESCRIPTIONS has copy for every module key', () => {
        for (const key of ALL_MODULES) {
            expect(MODULE_DESCRIPTIONS[key]).toBeTruthy();
        }
        expect(Object.keys(MODULE_DESCRIPTIONS).sort()).toEqual([...ALL_MODULES].sort());
    });

    it('resolveEnabledModules(null) returns ALL modules (default-on contract)', () => {
        expect(resolveEnabledModules(null)).toEqual([...ALL_MODULES]);
        expect(resolveEnabledModules(undefined)).toEqual([...ALL_MODULES]);
        // Returns a fresh array — callers must not mutate the constant.
        expect(resolveEnabledModules(null)).not.toBe(ALL_MODULES);
    });

    it('resolveEnabledModules(row) returns the row list verbatim', () => {
        expect(resolveEnabledModules({ enabledModules: ['JOURNAL', 'INVENTORY'] })).toEqual([
            'JOURNAL',
            'INVENTORY',
        ]);
        // An empty list is a real restriction, NOT a default-on trigger.
        expect(resolveEnabledModules({ enabledModules: [] })).toEqual([]);
    });

    it('isModuleEnabledIn membership test', () => {
        expect(isModuleEnabledIn(['JOURNAL', 'AI'], 'AI')).toBe(true);
        expect(isModuleEnabledIn(['JOURNAL', 'AI'], 'RISK')).toBe(false);
        expect(isModuleEnabledIn([], 'JOURNAL')).toBe(false);
    });

    it('coerceModuleKeys filters unknown strings to known ModuleKeys', () => {
        expect(coerceModuleKeys(['JOURNAL', 'NONSENSE', 'AI', ''])).toEqual(['JOURNAL', 'AI']);
        expect(coerceModuleKeys([])).toEqual([]);
        expect(coerceModuleKeys(['journal'])).toEqual([]); // case-sensitive
    });
});

// ─── getEnabledModules / isModuleEnabled ───────────────────────────

describe('getEnabledModules', () => {
    it('returns ALL modules when the tenant has no settings row', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue(null);
        expect(await getEnabledModules(readerCtx)).toEqual([...ALL_MODULES]);
    });

    it('returns the saved list when a settings row exists', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue({
            enabledModules: ['JOURNAL', 'PLANNING'],
        });
        expect(await getEnabledModules(readerCtx)).toEqual(['JOURNAL', 'PLANNING']);
    });
});

describe('isModuleEnabled', () => {
    it('true when present in the resolved set', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue({
            enabledModules: ['CERTIFICATION'],
        });
        expect(await isModuleEnabled(readerCtx, 'CERTIFICATION')).toBe(true);
    });

    it('false when the tenant has restricted it away', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue({
            enabledModules: ['JOURNAL'],
        });
        expect(await isModuleEnabled(readerCtx, 'CERTIFICATION')).toBe(false);
    });

    it('true by default (no row) — gating is backward-compatible', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue(null);
        expect(await isModuleEnabled(readerCtx, 'CERTIFICATION')).toBe(true);
    });
});

// ─── assertModuleEnabled ───────────────────────────────────────────

describe('assertModuleEnabled', () => {
    it('passes silently when the module is enabled', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue({
            enabledModules: ['CERTIFICATION'],
        });
        await expect(assertModuleEnabled(readerCtx, 'CERTIFICATION')).resolves.toBeUndefined();
    });

    it('throws a forbidden carrying the module_disabled code when disabled', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue({
            enabledModules: ['JOURNAL'],
        });
        await expect(assertModuleEnabled(readerCtx, 'CERTIFICATION')).rejects.toThrow(
            /module_disabled: CERTIFICATION/,
        );
    });
});

// ─── getModuleSettings (admin read) ────────────────────────────────

describe('getModuleSettings', () => {
    it('returns the customised shape when a row exists', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue({
            id: 'tms-1',
            enabledModules: ['JOURNAL', 'INVENTORY'],
        });
        const out = await getModuleSettings(adminCtx);
        expect(out).toEqual({
            enabledModules: ['JOURNAL', 'INVENTORY'],
            customized: true,
            allModules: [...ALL_MODULES],
        });
    });

    it('reports customized:false and the default list when no row exists', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue(null);
        const out = await getModuleSettings(adminCtx);
        expect(out.customized).toBe(false);
        expect(out.enabledModules).toEqual([...ALL_MODULES]);
    });

    it('READER passes the read gate (settings are readable to view the UI)', async () => {
        (ModuleSettingsRepository.get as jest.Mock).mockResolvedValue(null);
        await expect(getModuleSettings(readerCtx)).resolves.toBeDefined();
    });
});

// ─── setEnabledModules (admin write) ───────────────────────────────

describe('setEnabledModules', () => {
    it('upserts the list, audits, and returns the saved modules', async () => {
        (ModuleSettingsRepository.upsert as jest.Mock).mockResolvedValue({
            id: 'tms-1',
            enabledModules: ['JOURNAL', 'PLANNING'],
        });

        const out = await setEnabledModules(adminCtx, ['JOURNAL', 'PLANNING']);

        expect(ModuleSettingsRepository.upsert).toHaveBeenCalledWith(mockDb, adminCtx, [
            'JOURNAL',
            'PLANNING',
        ]);
        expect(out).toEqual({ enabledModules: ['JOURNAL', 'PLANNING'] });

        expect(logEvent).toHaveBeenCalledTimes(1);
        const [, , payload] = (logEvent as jest.Mock).mock.calls[0];
        expect(payload.action).toBe('TENANT_MODULES_UPDATED');
        expect(payload.entityType).toBe('TenantModuleSettings');
        expect(payload.entityId).toBe('tms-1');
        expect(payload.detailsJson.category).toBe('entity_lifecycle');
        expect(payload.detailsJson.after).toEqual({ enabledModules: ['JOURNAL', 'PLANNING'] });
    });

    it('READER is rejected by the admin gate before any write', async () => {
        await expect(setEnabledModules(readerCtx, [])).rejects.toThrow(/permission/i);
        expect(ModuleSettingsRepository.upsert).not.toHaveBeenCalled();
        expect(logEvent).not.toHaveBeenCalled();
    });

    it('an empty list is a valid restriction (records "(none)" in the audit detail)', async () => {
        (ModuleSettingsRepository.upsert as jest.Mock).mockResolvedValue({
            id: 'tms-1',
            enabledModules: [],
        });
        await setEnabledModules(adminCtx, []);
        const [, , payload] = (logEvent as jest.Mock).mock.calls[0];
        expect(payload.details).toContain('(none)');
    });

    it('normalizes the input — drops unknown keys and dedupes — before persisting', async () => {
        (ModuleSettingsRepository.upsert as jest.Mock).mockResolvedValue({
            id: 'tms-1',
            enabledModules: ['JOURNAL', 'INVENTORY'],
        });
        await setEnabledModules(adminCtx, ['JOURNAL', 'JOURNAL', 'NONSENSE', 'INVENTORY'] as never);
        // The upsert receives a deduped, known-only list.
        expect(ModuleSettingsRepository.upsert).toHaveBeenCalledWith(mockDb, adminCtx, ['JOURNAL', 'INVENTORY']);
    });
});
