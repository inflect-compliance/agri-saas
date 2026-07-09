/**
 * Photo pest/disease ID job — on-demand, enqueued when a photo is
 * attached to a LogEntry. Reads the stored image, runs it through a
 * Claude vision model, and merges the structured identification into
 * `LogEntry.attributesJson.pestId` (surfaced in-page with a confidence
 * badge + "verify with an agronomist" disclaimer). Notifies the uploader.
 *
 * Fail-safe: a missing key / failed call / oversized image → no-op
 * success (the photo + log entry are untouched).
 *
 * @module app-layer/jobs/photo-pest-id
 */
import { Readable } from 'stream';
import prisma from '@/lib/prisma';
import { runJob } from '@/lib/observability/job-runner';
import { logger } from '@/lib/observability/logger';
import { getProviderByName } from '@/lib/storage';
import { publishNotificationEvent } from '@/lib/notifications/notification-bus';
import { identifyPhoto } from '@/app-layer/ai/agronomy/photo-id';
import { isLocale } from '@/lib/i18n/locales';
import type { StorageProviderType } from '@/lib/storage/types';
import type { JobRunResult, PhotoPestIdPayload } from './types';

export interface PhotoPestIdResult {
    result: JobRunResult;
    identified: boolean;
}

/** Vision-safe image cap — refuse anything larger than 8 MB. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) {
            stream.destroy();
            return null;
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks);
}

export async function runPhotoPestId(payload: PhotoPestIdPayload): Promise<PhotoPestIdResult> {
    const jobRunId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const startMs = performance.now();

    return runJob(
        'photo-pest-id',
        async () => {
            const { tenantId, logEntryId, fileRecordId } = payload;
            let identified = false;

            const file = await prisma.fileRecord.findFirst({
                where: { id: fileRecordId, tenantId },
                select: { pathKey: true, mimeType: true, storageProvider: true },
            });
            const logEntry = await prisma.logEntry.findFirst({
                where: { id: logEntryId, tenantId },
                select: {
                    title: true,
                    notes: true,
                    attributesJson: true,
                    createdByUserId: true,
                    createdBy: { select: { uiLanguage: true } },
                    tenant: { select: { slug: true } },
                },
            });

            const isImage = file?.mimeType?.startsWith('image/');
            if (file && logEntry && isImage) {
                let base64: string | null = null;
                try {
                    const provider = getProviderByName(file.storageProvider as StorageProviderType);
                    const buf = await streamToBuffer(provider.readStream(file.pathKey), MAX_IMAGE_BYTES);
                    base64 = buf?.toString('base64') ?? null;
                } catch (err) {
                    logger.warn('photo-pest-id: image read failed', {
                        component: 'job',
                        jobName: 'photo-pest-id',
                        tenantId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }

                if (base64) {
                    const result = await identifyPhoto({
                        imageBase64: base64,
                        mimeType: file.mimeType,
                        contextNote: [logEntry.title, logEntry.notes].filter(Boolean).join(' — ') || null,
                        locale: isLocale(logEntry.createdBy?.uiLanguage) ? logEntry.createdBy.uiLanguage : undefined,
                    });

                    if (result) {
                        const existing = (logEntry.attributesJson as Record<string, unknown> | null) ?? {};
                        await prisma.logEntry.update({
                            where: { id: logEntryId },
                            data: {
                                attributesJson: JSON.parse(JSON.stringify({ ...existing, pestId: { ...result, fileRecordId } })),
                            },
                        });
                        identified = true;

                        if (logEntry.createdByUserId) {
                            const dedupeKey = `photo-pest-id:${tenantId}:${logEntryId}:${fileRecordId}`;
                            const title = result.identified
                                ? `Possible ${result.category.toLowerCase()}: ${result.name ?? 'see photo'}`
                                : 'Photo analysed — no clear pest/disease';
                            await prisma.notification.createMany({
                                data: [
                                    {
                                        tenantId,
                                        userId: logEntry.createdByUserId,
                                        type: 'GENERAL' as const,
                                        title,
                                        message: `${result.recommendation} (AI suggestion — verify with an agronomist.)`,
                                        linkUrl: `/t/${logEntry.tenant?.slug ?? ''}/journal/${logEntryId}`,
                                        dedupeKey,
                                    },
                                ],
                                skipDuplicates: true,
                            });
                            publishNotificationEvent(tenantId, logEntry.createdByUserId, {
                                id: dedupeKey,
                                type: 'GENERAL',
                                title,
                                message: result.recommendation,
                                read: false,
                                linkUrl: `/t/${logEntry.tenant?.slug ?? ''}/journal/${logEntryId}`,
                                createdAt: new Date().toISOString(),
                            });
                        }
                    }
                }
            }

            logger.info('photo pest-id completed', {
                component: 'job',
                jobName: 'photo-pest-id',
                tenantId,
                logEntryId,
                identified,
            });

            const durationMs = Math.round(performance.now() - startMs);
            const result: JobRunResult = {
                jobName: 'photo-pest-id',
                jobRunId,
                success: true,
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                itemsScanned: 1,
                itemsActioned: identified ? 1 : 0,
                itemsSkipped: identified ? 0 : 1,
                details: { identified },
            };
            return { result, identified };
        },
        { tenantId: payload.tenantId },
    );
}
