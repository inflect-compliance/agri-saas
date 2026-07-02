/**
 * Unit test — БАБХ farm-record register listing (PR3).
 * Proves listFarmRecords maps FileRecords (domain 'reports') into register
 * rows via the filename parser (from/to/auto), joins uploader names, and
 * computes the completeness nudge. Mocked DB + FileRepository (no real DB).
 */

const mockDb: Record<string, unknown> = {};
jest.mock('@/lib/db-context', () => {
    const actual = jest.requireActual('@/lib/db-context');
    return {
        ...actual,
        runInTenantContext: jest.fn(async (_ctx: unknown, cb: (db: unknown) => unknown) => cb(mockDb)),
    };
});
jest.mock('@/app-layer/repositories/FileRepository', () => ({
    FileRepository: { listByTenant: jest.fn() },
}));

import { listFarmRecords } from '@/app-layer/usecases/farm-record-register';
import { FileRepository } from '@/app-layer/repositories/FileRepository';
import { getPermissionsForRole } from '@/lib/permissions';
import type { RequestContext } from '@/app-layer/types';

function makeCtx(): RequestContext {
    return {
        requestId: 'req-reg',
        userId: 'user-1',
        tenantId: 'tenant-A',
        role: 'ADMIN',
        permissions: { canRead: true, canWrite: true, canAdmin: true, canAudit: true, canExport: true },
        appPermissions: getPermissionsForRole('ADMIN'),
    };
}

describe('farm-record register — listFarmRecords', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        for (const k of Object.keys(mockDb)) delete mockDb[k];
    });

    test('maps FileRecords to register rows (from/to/auto) + completeness', async () => {
        (FileRepository.listByTenant as jest.Mock).mockResolvedValue([
            {
                id: 'fr1',
                originalName: 'dnevnik-loc1-2026-01-01_2026-07-02.pdf',
                uploadedByUserId: 'u1',
                sizeBytes: 2048,
                storedAt: new Date('2026-07-02T10:00:00Z'),
                createdAt: new Date('2026-07-02T10:00:00Z'),
            },
            {
                id: 'fr2',
                originalName: 'dnevnik-loc1-2026-03-01_2026-06-01-auto.pdf',
                uploadedByUserId: 'u2',
                sizeBytes: 1024,
                storedAt: new Date('2026-06-01T09:00:00Z'),
                createdAt: new Date('2026-06-01T09:00:00Z'),
            },
        ]);
        mockDb.user = { findMany: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Иван Петров' }]) };
        mockDb.farmProfile = {
            findUnique: jest.fn().mockResolvedValue({ producerName: 'ЕТ Х', eik: null }),
        };
        mockDb.tenantMembership = { findFirst: jest.fn().mockResolvedValue(null) };

        const res = await listFarmRecords(makeCtx(), 'loc1');

        expect(res.records).toHaveLength(2);
        expect(res.records[0]).toMatchObject({
            fileRecordId: 'fr1',
            from: '2026-01-01',
            to: '2026-07-02',
            auto: false,
            generatedByName: 'Иван Петров',
            sizeBytes: 2048,
        });
        expect(res.records[1]).toMatchObject({ fileRecordId: 'fr2', auto: true, generatedByName: null });

        // eik null + no cert-carrying member → those two gaps; producerName is set.
        expect(res.completeness.missingLabels).toEqual(
            expect.arrayContaining(['ЕИК', 'сертификат на оператора']),
        );
        expect(res.completeness.missingLabels).not.toContain('Земеделски производител');

        expect(FileRepository.listByTenant).toHaveBeenCalledWith(
            mockDb,
            expect.anything(),
            expect.objectContaining({ domain: 'reports', status: 'STORED' }),
        );
    });
});
