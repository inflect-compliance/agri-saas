/**
 * SP-5 — export a frozen audit pack to SharePoint.
 *
 * Builds a ZIP ({README.md, pack.json manifest, items.csv, evidence/<files>})
 * and uploads it to a chosen SharePoint library folder so auditors can access
 * the pack in their native environment. Records the export on the AuditPack + an
 * IntegrationExecution row (for the sync-health dashboard).
 *
 * SP-F2: the ZIP now bundles the actual evidence FILE binaries under `evidence/`
 * (scanned-clean, non-deleted only; capped at SP_EXPORT_MAX_BYTES).
 *
 * @module usecases/audit-pack-sharepoint-export
 */
import JSZip from 'jszip';
import type { Readable } from 'node:stream';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { Prisma } from '@prisma/client';
import { badRequest, notFound } from '@/lib/errors/types';
import { assertCanAdmin } from '../policies/common';
import { logEvent } from '../events/audit';
import { edgeLogger } from '@/lib/observability/edge-logger';
import { getStorageProvider } from '@/lib/storage';
import { isDownloadAllowed } from '@/lib/storage/av-scan';
import { getAuditPack, exportAuditPack } from './audit-readiness/packs';
import {
    getSharePointClient,
    listSharePointConnections,
} from '../integrations/providers/sharepoint';

/** Total evidence-binary payload cap per export ZIP (manifest is always included). */
export const SP_EXPORT_MAX_BYTES = 200 * 1024 * 1024;

interface BundleFile { pathKey: string; name: string; scanStatus: string; status: string; deletedAt: Date | null }

/** Collect a storage Readable into a Buffer. */
function streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

/**
 * Add the pack's evidence FILE binaries to the ZIP under `evidence/`, skipping
 * unscanned/deleted files and stopping at SP_EXPORT_MAX_BYTES.
 */
async function bundleEvidenceBinaries(
    ctx: RequestContext,
    packItems: Array<{ entityType: string; entityId: string }>,
    zip: JSZip,
): Promise<{ bundled: number; skipped: number; bytes: number }> {
    const evidenceIds = packItems.filter((i) => i.entityType === 'EVIDENCE').map((i) => i.entityId);
    const fileIds = packItems.filter((i) => i.entityType === 'FILE').map((i) => i.entityId);
    if (evidenceIds.length === 0 && fileIds.length === 0) return { bundled: 0, skipped: 0, bytes: 0 };

    const files: BundleFile[] = await runInTenantContext(ctx, async (db) => {
        const out: BundleFile[] = [];
        if (evidenceIds.length) {
            const ev = await db.evidence.findMany({
                where: { id: { in: evidenceIds }, tenantId: ctx.tenantId },
                select: { fileRecord: { select: { pathKey: true, originalName: true, scanStatus: true, status: true, deletedAt: true } } },
            });
            for (const e of ev) {
                if (e.fileRecord) {
                    const fr = e.fileRecord;
                    out.push({ pathKey: fr.pathKey, name: fr.originalName, scanStatus: fr.scanStatus, status: fr.status, deletedAt: fr.deletedAt });
                }
            }
        }
        if (fileIds.length) {
            const fr = await db.fileRecord.findMany({
                where: { id: { in: fileIds }, tenantId: ctx.tenantId },
                select: { pathKey: true, originalName: true, scanStatus: true, status: true, deletedAt: true },
            });
            out.push(...fr.map((f) => ({ pathKey: f.pathKey, name: f.originalName, scanStatus: f.scanStatus, status: f.status, deletedAt: f.deletedAt })));
        }
        return out;
    });

    const provider = getStorageProvider();
    let bundled = 0;
    let skipped = 0;
    let bytes = 0;
    const usedNames = new Set<string>();
    for (const f of files) {
        // Only bundle scanned-clean, stored, non-deleted files.
        if (f.status !== 'STORED' || f.deletedAt || !isDownloadAllowed(f.scanStatus)) { skipped++; continue; }
        try {
            const buf = await streamToBuffer(provider.readStream(f.pathKey));
            if (bytes + buf.byteLength > SP_EXPORT_MAX_BYTES) { skipped++; continue; }
            let name = f.name || 'file';
            if (usedNames.has(name)) name = `${bundled + 1}-${name}`; // de-dupe names within the ZIP
            usedNames.add(name);
            zip.file(`evidence/${name}`, buf);
            bundled++;
            bytes += buf.byteLength;
        } catch (err) {
            skipped++;
            edgeLogger.warn('Audit-pack export: evidence file read failed', {
                component: 'sharepoint',
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { bundled, skipped, bytes };
}

export interface SpExportDestination {
    connectionId?: string;
    driveId: string;
    /** Target folder item id, or 'root'. */
    folderId?: string;
    /** e.g. '{auditName}-{date}' → '<name>-2026-06-09'. */
    namingTemplate?: string;
}

function renderName(template: string, packName: string, isoDate: string): string {
    const safeName = packName.replace(/[^\w.-]+/g, '-');
    return template.replace('{auditName}', safeName).replace('{date}', isoDate).replace('{isoDate}', isoDate);
}

export async function exportAuditPackToSharePoint(
    ctx: RequestContext,
    packId: string,
    dest: SpExportDestination,
    deps: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<{ spItemId: string; webUrl: string }> {
    assertCanAdmin(ctx);
    if (!dest.driveId) throw badRequest('driveId is required');

    const pack = await getAuditPack(ctx, packId);
    if (pack.status !== 'FROZEN') throw badRequest('Only FROZEN packs can be exported to SharePoint');

    // Build the ZIP from the pack manifest (json + csv).
    const json = await exportAuditPack(ctx, packId, 'json');
    const csv = (await exportAuditPack(ctx, packId, 'csv')) as { csv: string };
    const now = deps.now ? deps.now() : new Date();
    const isoDate = now.toISOString().slice(0, 10);
    const zip = new JSZip();
    zip.file(
        'README.md',
        `# ${pack.name}\n\nFrozen audit pack exported from Agrent.\n\n` +
            `- Status: ${pack.status}\n- Frozen: ${pack.frozenAt ?? 'n/a'}\n- Items: ${pack.items.length}\n- Exported: ${now.toISOString()}\n`,
    );
    zip.file('pack.json', JSON.stringify(json, null, 2));
    zip.file('items.csv', csv.csv);
    // SP-F2 — bundle the actual evidence binaries.
    const bundle = await bundleEvidenceBinaries(ctx, pack.items, zip);
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const connectionId =
        dest.connectionId ?? (await listSharePointConnections(ctx))[0]?.id;
    if (!connectionId) throw notFound('No SharePoint connection configured');
    const client = await getSharePointClient(ctx, connectionId, deps);

    const fileName = `${renderName(dest.namingTemplate ?? '{auditName}-{isoDate}', pack.name, isoDate)}.zip`;
    const item = await client.uploadNewFile(
        dest.driveId,
        dest.folderId ?? 'root',
        fileName,
        bytes,
        'application/zip',
    );

    await runInTenantContext(ctx, async (db) => {
        await db.auditPack.update({
            where: { id: packId },
            data: { spExportItemId: item.id, spExportWebUrl: item.webUrl ?? null, spExportedAt: now },
        });
        await db.integrationExecution.create({
            data: {
                tenantId: ctx.tenantId,
                connectionId,
                provider: 'sharepoint',
                automationKey: 'sharepoint.audit_pack_export',
                status: 'PASSED',
                triggeredBy: 'manual',
                resultJson: { packId, fileName, spItemId: item.id, evidenceBundled: bundle.bundled, evidenceSkipped: bundle.skipped } as Prisma.InputJsonValue,
                completedAt: now,
            },
        });
        await logEvent(db, ctx, {
            action: 'AUDIT_PACK_EXPORTED_SHAREPOINT',
            entityType: 'AuditPack',
            entityId: packId,
            details: `Exported audit pack to SharePoint (${fileName})`,
            detailsJson: { category: 'data_lifecycle', summary: 'Audit pack exported to SharePoint' },
        });
    });

    return { spItemId: item.id, webUrl: item.webUrl ?? '' };
}
