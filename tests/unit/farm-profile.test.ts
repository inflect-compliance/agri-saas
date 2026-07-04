/**
 * Unit test — БАБХ farm-record FarmProfile usecase (PR1).
 * Proves the all-null default shape, row mapping, and that upsert
 * sanitises + blanks-to-null and keys on tenantId. Mocked DB (no real DB).
 */

jest.mock('@/lib/audit', () => ({
    appendAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

const mockDb: Record<string, unknown> = {};
jest.mock('@/lib/db-context', () => {
    const actual = jest.requireActual('@/lib/db-context');
    return {
        ...actual,
        runInTenantContext: jest.fn(async (_ctx: unknown, cb: (db: unknown) => unknown) => cb(mockDb)),
    };
});

jest.mock('@/lib/security/sanitize', () => ({
    // Strip tags REPEATEDLY until stable — a single pass leaves nested
    // leftovers (e.g. `<<a>b>`), which CodeQL flags as incomplete
    // multi-character sanitization. Test-only mock of sanitizePlainText.
    sanitizePlainText: (s: string) => {
        let prev: string;
        do {
            prev = s;
            s = s.replace(/<[^>]*>/g, '');
        } while (s !== prev);
        return s;
    },
    sanitizeRichTextHtml: (s: string) => s,
}));

import { getFarmProfile, upsertFarmProfile } from '@/app-layer/usecases/farm-profile';
import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole } from '@/lib/permissions';

function makeCtx(): RequestContext {
    return {
        requestId: 'req-fp',
        userId: 'user-1',
        tenantId: 'tenant-A',
        role: 'ADMIN',
        permissions: { canRead: true, canWrite: true, canAdmin: true, canAudit: true, canExport: true },
        appPermissions: getPermissionsForRole('ADMIN'),
    };
}

describe('farm-profile usecase', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        for (const k of Object.keys(mockDb)) delete mockDb[k];
    });

    test('getFarmProfile returns an all-null shape when the row is unset', async () => {
        mockDb.farmProfile = { findUnique: jest.fn().mockResolvedValue(null) };
        const p = await getFarmProfile(makeCtx());
        expect(p.producerName).toBeNull();
        expect(p.egn).toBeNull();
        expect(p.odbhCity).toBeNull();
    });

    test('getFarmProfile maps a stored row', async () => {
        mockDb.farmProfile = {
            findUnique: jest.fn().mockResolvedValue({
                producerName: 'ЕТ Иван Петров',
                egn: '7501011234',
                eik: null,
                municipality: 'Пловдив',
            }),
        };
        const p = await getFarmProfile(makeCtx());
        expect(p.producerName).toBe('ЕТ Иван Петров');
        expect(p.municipality).toBe('Пловдив');
        expect(p.eik).toBeNull();
    });

    test('upsertFarmProfile sanitises, blanks-to-null, and keys on tenantId', async () => {
        const upsert = jest.fn().mockResolvedValue({ id: 'fp-1', producerName: 'Иван', municipality: null, odbhCity: 'Пловдив' });
        mockDb.farmProfile = { upsert };

        await upsertFarmProfile(makeCtx(), {
            producerName: '  Иван  ',
            egn: '7501011234',
            municipality: '   ',
            odbhCity: '<b>Пловдив</b>',
        });

        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-A' } }));
        const arg = upsert.mock.calls[0][0];
        expect(arg.create.tenantId).toBe('tenant-A');
        expect(arg.create.producerName).toBe('Иван'); // trimmed
        expect(arg.update.municipality).toBeNull(); // blank → null
        expect(arg.update.odbhCity).toBe('Пловдив'); // sanitised (tags stripped)
        expect(arg.update.egn).toBe('7501011234');
    });
});
