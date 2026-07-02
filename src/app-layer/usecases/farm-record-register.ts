/**
 * БАБХ farm-record register — lists the generated ДНЕВНИК PDFs for a Location
 * (FileRecords, domain 'reports', filtered by the farm-record filename
 * prefix), and reports missing-data gaps so the UI can nudge (non-blocking).
 */
import { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { FileRepository } from '../repositories/FileRepository';
import {
    farmRecordNamePrefix,
    parseFarmRecordFileName,
} from '@/app-layer/reports/pdf/farm-record-diary';

export interface FarmRecordRow {
    fileRecordId: string;
    fileName: string;
    from: string;
    to: string;
    generatedAt: string;
    auto: boolean;
    generatedByName: string | null;
    sizeBytes: number;
}

export interface FarmRecordRegister {
    records: FarmRecordRow[];
    completeness: { missingLabels: string[] };
}

/** Bulgarian labels for the completeness nudge (document language is BG). */
async function computeCompleteness(
    ctx: RequestContext,
    db: PrismaTx,
): Promise<{ missingLabels: string[] }> {
    const [profile, certMember] = await Promise.all([
        db.farmProfile.findUnique({
            where: { tenantId: ctx.tenantId },
            select: { producerName: true, eik: true },
        }),
        db.tenantMembership.findFirst({
            where: { tenantId: ctx.tenantId, status: 'ACTIVE', applicatorCertNo: { not: null } },
            select: { id: true },
        }),
    ]);
    const missingLabels: string[] = [];
    if (!profile || !profile.producerName) missingLabels.push('Земеделски производител');
    if (!profile || !profile.eik) missingLabels.push('ЕИК');
    if (!certMember) missingLabels.push('сертификат на оператора');
    return { missingLabels };
}

/** The generated ДНЕВНИК documents for a location's Farm-records register. */
export async function listFarmRecords(
    ctx: RequestContext,
    locationId: string,
): Promise<FarmRecordRegister> {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const files = await FileRepository.listByTenant(db, ctx, {
            domain: 'reports',
            originalNamePrefix: farmRecordNamePrefix(locationId),
            status: 'STORED',
        });

        const userIds = [
            ...new Set(files.map((f) => f.uploadedByUserId).filter(Boolean)),
        ] as string[];
        const users = userIds.length
            ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
            : [];
        const nameById = new Map(users.map((u) => [u.id, u.name]));

        const records: FarmRecordRow[] = files.flatMap((f) => {
            const parsed = parseFarmRecordFileName(f.originalName, locationId);
            if (!parsed) return [];
            return [
                {
                    fileRecordId: f.id,
                    fileName: f.originalName,
                    from: parsed.from,
                    to: parsed.to,
                    generatedAt: (f.storedAt ?? f.createdAt).toISOString(),
                    auto: parsed.auto,
                    generatedByName: nameById.get(f.uploadedByUserId) ?? null,
                    sizeBytes: f.sizeBytes,
                },
            ];
        });

        const completeness = await computeCompleteness(ctx, db);
        return { records, completeness };
    });
}
