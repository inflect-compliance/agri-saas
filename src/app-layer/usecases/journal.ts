import { Readable } from 'stream';
import { RequestContext } from '../types';
import {
    JournalRepository,
    type LogEntryFilters,
    type LogEntryListParams,
    type CreateLogEntryInput,
    type UpdateLogEntryInput,
    type LogQuantityInput,
} from '../repositories/JournalRepository';
import { FileRepository } from '../repositories/FileRepository';
import { recordHarvestLot } from './inventory';
import { attachAutoEvidenceFromLogEntry } from './auto-evidence';
import { assertCanRead, assertCanWrite, assertCanAdmin } from '../policies/common';
import { logEvent } from '../events/audit';
import { notFound, badRequest } from '@/lib/errors/types';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { sanitizePlainText, sanitizeRichTextHtml } from '@/lib/security/sanitize';
import {
    getStorageProvider,
    buildTenantObjectKey,
    isAllowedMime,
    isAllowedSize,
    FILE_MAX_SIZE_BYTES,
} from '@/lib/storage';
import { env } from '@/env';
import { traceAgUsecase, logger } from '@/lib/observability';
import { enqueue } from '../jobs/queue';
import { trace } from '@opentelemetry/api';

/**
 * Field-journal usecases — the durable record of work done (or planned)
 * on the farm. Mirrors the Asset module end-to-end:
 *   - authorize via assertCanRead/Write/Admin BEFORE data access,
 *   - sanitize user free text at the boundary (title → plain text,
 *     notes → rich-text HTML, per Epic D.2),
 *   - emit a hash-chained audit event on EVERY mutation,
 *   - all DB access through runInTenantContext + JournalRepository
 *     (RLS-bound transaction).
 *
 * INPUT_APPLICATION is the traceability-critical spray/fertiliser
 * record; an entry's `quantities` carry the farmOS measure+value+unit
 * lines (e.g. { VOLUME 42.5 "L applied" }).
 */

// ─── Shapes coming off the validated Zod body ───────────────────────

type QuantityMeasureValue = LogQuantityInput['measure'];

interface QuantityPayload {
    measure: QuantityMeasureValue;
    value: number;
    unitId: string;
    label?: string | null;
}

/** Optional output-lot payload on a HARVEST entry — mints a HARVEST_IN
 *  inventory lot + lot genealogy (INVENTORY-module gated, see
 *  `recordHarvestLot`). Ignored for non-HARVEST types. */
interface HarvestPayload {
    itemId: string;
    quantity: number;
    lotCode?: string | null;
    locationId?: string | null;
    expiresAt?: string | null;
    /** The field harvested — drives provenance + DERIVATION genealogy. */
    parcelId?: string | null;
    sourceLotIds?: string[];
    costAmount?: number | null;
    costCurrency?: string | null;
}

interface CreateLogEntryData {
    type: CreateLogEntryInput['type'];
    status?: 'PLANNED' | 'DONE';
    occurredAt?: string | null;
    title: string;
    notes?: string | null;
    quantities?: QuantityPayload[];
    locationIds?: string[];
    equipmentIds?: string[];
    operationParcelId?: string | null;
    costAmount?: number | null;
    costCurrency?: string | null;
    harvest?: HarvestPayload | null;
    /**
     * Crop-planning plan-vs-actual links — the planting(s) + lifecycle
     * stage this entry realises (a sow / transplant / harvest record).
     * Each becomes a LogPlanting row (PLANNING module). The entry's
     * occurredAt is the actual date; `stage` names the planned date it
     * realises. Ignored when empty.
     */
    plantingLinks?: { plantingId: string; stage: 'SOW' | 'TRANSPLANT' | 'HARVEST' }[];
}

interface UpdateLogEntryData {
    type?: CreateLogEntryInput['type'];
    status?: 'PLANNED' | 'DONE';
    occurredAt?: string | null;
    title?: string;
    notes?: string | null;
    quantities?: QuantityPayload[];
    locationIds?: string[];
    equipmentIds?: string[];
    operationParcelId?: string | null;
    costAmount?: number | null;
    costCurrency?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Validate location + equipment links belong to the tenant; throws otherwise. */
async function assertLinksValid(
    db: PrismaTx,
    ctx: RequestContext,
    locationIds: string[] | undefined,
    equipmentIds: string[] | undefined,
) {
    if (locationIds && locationIds.length) {
        const valid = await JournalRepository.validLocationIds(db, ctx, locationIds);
        const missing = locationIds.filter((id) => !valid.has(id));
        if (missing.length) {
            throw badRequest('INVALID_LOCATION', `Location not found or belongs to a different tenant: ${missing[0]}`);
        }
    }
    if (equipmentIds && equipmentIds.length) {
        const valid = await JournalRepository.validEquipmentIds(db, ctx, equipmentIds);
        const missing = equipmentIds.filter((id) => !valid.has(id));
        if (missing.length) {
            throw badRequest('INVALID_EQUIPMENT', `Equipment not found or belongs to a different tenant: ${missing[0]}`);
        }
    }
}

// ─── Reads ──────────────────────────────────────────────────────────

export async function listLogEntries(ctx: RequestContext, filters?: LogEntryFilters) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => JournalRepository.list(db, ctx, filters));
}

export async function listLogEntriesPaginated(ctx: RequestContext, params: LogEntryListParams) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => JournalRepository.listPaginated(db, ctx, params));
}

export async function getLogEntry(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const entry = await JournalRepository.getById(db, ctx, id);
        if (!entry) throw notFound('Journal entry not found');
        return entry;
    });
}

// ─── Create ─────────────────────────────────────────────────────────

export async function createLogEntry(ctx: RequestContext, data: CreateLogEntryData) {
    return traceAgUsecase('journal.createLogEntry', ctx, () => createLogEntryImpl(ctx, data));
}

async function createLogEntryImpl(ctx: RequestContext, data: CreateLogEntryData) {
    assertCanWrite(ctx);

    // Sanitize at the boundary (Epic D.2): title is single-line plain
    // text; notes is TipTap rich-text HTML.
    const title = sanitizePlainText(data.title);
    if (!title) throw badRequest('Title is required');
    const notes = data.notes != null ? sanitizeRichTextHtml(data.notes) : null;

    const input: CreateLogEntryInput = {
        type: data.type,
        title,
        status: data.status,
        notes,
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
        operationParcelId: data.operationParcelId ?? null,
        costAmount: data.costAmount ?? null,
        costCurrency: data.costCurrency ?? null,
        quantities: data.quantities?.map((q) => ({
            measure: q.measure,
            value: q.value,
            unitId: q.unitId,
            label: q.label != null ? sanitizePlainText(q.label) : null,
        })),
        locationIds: data.locationIds,
        equipmentIds: data.equipmentIds,
        plantingLinks: data.plantingLinks,
    };

    return runInTenantContext(ctx, async (db) => {
        await assertLinksValid(db, ctx, data.locationIds, data.equipmentIds);
        // Crop-planning actuals — validate every linked planting belongs
        // to the tenant before the LogPlanting rows are written (no
        // orphan link on a foreign/bad id).
        if (data.plantingLinks && data.plantingLinks.length) {
            const ids = data.plantingLinks.map((p) => p.plantingId);
            const found = await db.planting.findMany({
                where: { id: { in: ids }, tenantId: ctx.tenantId, deletedAt: null },
                select: { id: true },
            });
            const validIds = new Set(found.map((p) => p.id));
            const missing = ids.filter((id) => !validIds.has(id));
            if (missing.length) {
                throw badRequest('INVALID_PLANTING', `Planting not found or belongs to a different tenant: ${missing[0]}`);
            }
        }

        const entry = await JournalRepository.createLogEntry(db, ctx, input);

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'LogEntry',
            entityId: entry.id,
            details: `Created journal entry: ${entry.title}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'LogEntry',
                operation: 'created',
                after: {
                    type: entry.type,
                    title: entry.title,
                    status: entry.status,
                    quantityCount: input.quantities?.length ?? 0,
                },
                summary: `Created journal entry: ${entry.title}`,
            },
        });

        // A HARVEST entry can mint its output lot + record genealogy in the
        // same transaction (INVENTORY-module gated inside recordHarvestLot).
        if (data.type === 'HARVEST' && data.harvest) {
            await recordHarvestLot(db, ctx, {
                logEntryId: entry.id,
                itemId: data.harvest.itemId,
                quantity: data.harvest.quantity,
                lotCode: data.harvest.lotCode ?? null,
                locationId: data.harvest.locationId ?? null,
                expiresAt: data.harvest.expiresAt ?? null,
                parcelId: data.harvest.parcelId ?? null,
                sourceLotIds: data.harvest.sourceLotIds,
                costAmount: data.harvest.costAmount ?? null,
                costCurrency: data.harvest.costCurrency ?? null,
            });
        }

        // A directly-authored INPUT_APPLICATION record (spray/fertiliser) is
        // itself the certification evidence for the plant-protection /
        // input-record control points. Attach it to every scheme control the
        // tenant has mapped — in the SAME transaction, so it's atomic with
        // the journal write. No-op when no scheme is installed. Cheap type
        // guard keeps the common (non-spray) create path untouched.
        if (data.type === 'INPUT_APPLICATION') {
            await attachAutoEvidenceFromLogEntry(db, ctx, entry.id);
        }

        trace.getActiveSpan()?.setAttributes({
            'ag.logEntryId': entry.id,
            'ag.logEntryType': entry.type,
            'ag.isHarvest': data.type === 'HARVEST' && !!data.harvest,
            ...(data.type === 'HARVEST' && data.harvest
                ? {
                      'ag.harvestItemId': data.harvest.itemId,
                      'ag.harvestQuantity': data.harvest.quantity,
                  }
                : {}),
        });

        return entry;
    });
}

// ─── Update ─────────────────────────────────────────────────────────

export async function updateLogEntry(ctx: RequestContext, id: string, data: UpdateLogEntryData) {
    assertCanWrite(ctx);

    const input: UpdateLogEntryInput = {
        type: data.type,
        status: data.status,
        title: data.title !== undefined ? sanitizePlainText(data.title) : undefined,
        notes:
            data.notes === undefined
                ? undefined
                : data.notes === null
                    ? null
                    : sanitizeRichTextHtml(data.notes),
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
        operationParcelId: data.operationParcelId,
        costAmount: data.costAmount,
        costCurrency: data.costCurrency,
        quantities: data.quantities?.map((q) => ({
            measure: q.measure,
            value: q.value,
            unitId: q.unitId,
            label: q.label != null ? sanitizePlainText(q.label) : null,
        })),
        locationIds: data.locationIds,
        equipmentIds: data.equipmentIds,
    };

    if (input.title !== undefined && !input.title) {
        throw badRequest('Title is required');
    }

    return runInTenantContext(ctx, async (db) => {
        const existing = await JournalRepository.getById(db, ctx, id);
        if (!existing) throw notFound('Journal entry not found');

        await assertLinksValid(db, ctx, data.locationIds, data.equipmentIds);

        const entry = await JournalRepository.updateLogEntry(db, ctx, id, input);

        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'LogEntry',
            entityId: id,
            details: 'Journal entry updated',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'LogEntry',
                operation: 'updated',
                changedFields: Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined),
                after: { type: entry.type, title: entry.title, status: entry.status },
                summary: 'Journal entry updated',
            },
        });

        return entry;
    });
}

// ─── Delete (soft) ──────────────────────────────────────────────────

export async function deleteLogEntry(ctx: RequestContext, id: string) {
    assertCanWrite(ctx);

    return runInTenantContext(ctx, async (db) => {
        const existing = await JournalRepository.getById(db, ctx, id);
        if (!existing) throw notFound('Journal entry not found');

        await JournalRepository.softDelete(db, ctx, id);

        await logEvent(db, ctx, {
            action: 'SOFT_DELETE',
            entityType: 'LogEntry',
            entityId: id,
            details: 'Journal entry soft-deleted',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'LogEntry',
                operation: 'deleted',
                summary: 'Journal entry soft-deleted',
            },
        });

        return { success: true };
    });
}

// ─── Restore / Purge ────────────────────────────────────────────────
//
// LogEntry is not registered with the shared soft-delete middleware
// (`SOFT_DELETE_MODELS`), so restore/purge are implemented here against
// the explicit deletedAt column rather than via
// `soft-delete-operations.ts` (whose model union + restore-validator
// registry would need a schema-coupled entry). ADMIN-only, same posture
// as the shared helpers.

export async function restoreLogEntry(ctx: RequestContext, id: string) {
    assertCanAdmin(ctx);

    return runInTenantContext(ctx, async (db) => {
        const record = await JournalRepository.getByIdWithDeleted(db, ctx, id);
        if (!record) throw notFound('Journal entry not found');
        if (!record.deletedAt) throw notFound('Journal entry is not deleted');

        const restored = await JournalRepository.restore(db, ctx, id);

        await logEvent(db, ctx, {
            action: 'ENTITY_RESTORED',
            entityType: 'LogEntry',
            entityId: id,
            details: 'Journal entry restored from soft-delete',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'LogEntry',
                operation: 'restored',
                before: { deletedAt: record.deletedAt.toISOString() },
                summary: 'Journal entry restored from soft-delete',
            },
        });

        return restored;
    });
}

export async function purgeLogEntry(ctx: RequestContext, id: string) {
    assertCanAdmin(ctx);

    return runInTenantContext(ctx, async (db) => {
        const record = await JournalRepository.getByIdWithDeleted(db, ctx, id);
        if (!record) throw notFound('Journal entry not found');
        if (!record.deletedAt) throw notFound('Journal entry must be soft-deleted before purging');

        await JournalRepository.purge(db, ctx, id);

        await logEvent(db, ctx, {
            action: 'ENTITY_PURGED',
            entityType: 'LogEntry',
            entityId: id,
            details: 'Journal entry permanently purged',
            detailsJson: {
                category: 'data_lifecycle',
                operation: 'purged',
                model: 'LogEntry',
                reason: 'Manual purge via admin action',
            },
        });

        return { success: true, purged: true };
    });
}

// ─── Photo logging (file attach / detach) ───────────────────────────

/**
 * Upload a photo/document, create its FileRecord through the same
 * storage pipeline evidence uploads use, and link it to the entry via
 * LogEntryFile. Returns the created link (with the FileRecord).
 */
export async function uploadLogEntryPhoto(
    ctx: RequestContext,
    logEntryId: string,
    file: File,
    caption?: string | null,
) {
    assertCanWrite(ctx);

    const mimeType = file.type || 'application/octet-stream';
    if (!isAllowedMime(mimeType)) {
        throw badRequest('FILE_TYPE_NOT_ALLOWED', `MIME type "${mimeType}" is not allowed`);
    }
    if (!isAllowedSize(file.size)) {
        throw badRequest('FILE_TOO_LARGE', `File exceeds maximum size of ${FILE_MAX_SIZE_BYTES} bytes`);
    }

    const storage = getStorageProvider();
    const originalName = file.name || 'photo';
    const pathKey = buildTenantObjectKey(ctx.tenantId, 'general', originalName);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const readable = Readable.from(buffer);
    const writeResult = await storage.write(pathKey, readable, { mimeType });

    const cleanCaption = caption != null ? sanitizePlainText(caption) || null : null;

    const { link, fileRecordId, isImage } = await runInTenantContext(ctx, async (db) => {
        const entry = await JournalRepository.getById(db, ctx, logEntryId);
        if (!entry) throw notFound('Journal entry not found');

        // Reuse an existing identical FileRecord if one is already stored
        // (SHA-256 dedup), else create + mark stored.
        const existingFile = await FileRepository.findBySha256(db, ctx.tenantId, writeResult.sha256);
        let fileRecordId: string;
        if (existingFile && existingFile.status === 'STORED') {
            fileRecordId = existingFile.id;
            try { await storage.delete(pathKey); } catch { /* best effort */ }
        } else {
            const fileRecord = await FileRepository.createPending(db, ctx, {
                pathKey,
                originalName,
                mimeType,
                sizeBytes: writeResult.sizeBytes,
                sha256: writeResult.sha256,
                storageProvider: storage.name,
                bucket: env.S3_BUCKET || null,
                domain: 'general',
            });
            await FileRepository.markStored(db, ctx, fileRecord.id);
            fileRecordId = fileRecord.id;
        }

        const link = await JournalRepository.attachFile(db, ctx, logEntryId, fileRecordId, cleanCaption);

        await logEvent(db, ctx, {
            action: 'LOG_ENTRY_FILE_ATTACHED',
            entityType: 'LogEntry',
            entityId: logEntryId,
            details: `Photo attached: ${originalName}`,
            detailsJson: {
                category: 'relationship',
                operation: 'linked',
                sourceEntity: 'LogEntry',
                sourceId: logEntryId,
                targetEntity: 'FileRecord',
                targetId: fileRecordId,
                relation: 'PHOTO',
            },
        });

        return { link, fileRecordId, isImage: mimeType.startsWith('image/') };
    });

    // Photo pest/disease classification — async vision (feat/ai-vision).
    // On-device ONNX first, Claude fallback; the job + orchestrator are
    // fully fail-safe (no-op when no backend is available), so we enqueue
    // for every image upload and let the job decide. Fire-and-forget — a
    // queue failure must NEVER fail the upload.
    if (isImage) {
        try {
            await enqueue('classify-photo', { tenantId: ctx.tenantId, logEntryId, fileId: fileRecordId });
        } catch (err) {
            logger.warn('journal: classify-photo enqueue failed', {
                component: 'journal',
                tenantId: ctx.tenantId,
                logEntryId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return link;
}

/** Attach an already-uploaded FileRecord to a journal entry. */
export async function attachLogEntryFile(
    ctx: RequestContext,
    logEntryId: string,
    fileRecordId: string,
    caption?: string | null,
) {
    assertCanWrite(ctx);
    const cleanCaption = caption != null ? sanitizePlainText(caption) || null : null;

    return runInTenantContext(ctx, async (db) => {
        const entry = await JournalRepository.getById(db, ctx, logEntryId);
        if (!entry) throw notFound('Journal entry not found');

        const file = await FileRepository.getById(db, ctx, fileRecordId);
        if (!file) throw badRequest('INVALID_FILE', 'File not found or belongs to a different tenant');

        const existingLink = await JournalRepository.getFileLink(db, ctx, logEntryId, fileRecordId);
        if (existingLink) return existingLink;

        const link = await JournalRepository.attachFile(db, ctx, logEntryId, fileRecordId, cleanCaption);

        await logEvent(db, ctx, {
            action: 'LOG_ENTRY_FILE_ATTACHED',
            entityType: 'LogEntry',
            entityId: logEntryId,
            details: `File attached: ${fileRecordId}`,
            detailsJson: {
                category: 'relationship',
                operation: 'linked',
                sourceEntity: 'LogEntry',
                sourceId: logEntryId,
                targetEntity: 'FileRecord',
                targetId: fileRecordId,
                relation: 'PHOTO',
            },
        });

        return link;
    });
}

/** Detach a FileRecord from a journal entry (the FileRecord survives). */
export async function detachLogEntryFile(ctx: RequestContext, logEntryId: string, fileRecordId: string) {
    assertCanWrite(ctx);

    return runInTenantContext(ctx, async (db) => {
        const link = await JournalRepository.getFileLink(db, ctx, logEntryId, fileRecordId);
        if (!link) throw notFound('Journal entry file link not found');

        await JournalRepository.detachFile(db, ctx, logEntryId, fileRecordId);

        await logEvent(db, ctx, {
            action: 'LOG_ENTRY_FILE_DETACHED',
            entityType: 'LogEntry',
            entityId: logEntryId,
            details: `File detached: ${fileRecordId}`,
            detailsJson: {
                category: 'relationship',
                operation: 'unlinked',
                sourceEntity: 'LogEntry',
                sourceId: logEntryId,
                targetEntity: 'FileRecord',
                targetId: fileRecordId,
            },
        });

        return { success: true };
    });
}
