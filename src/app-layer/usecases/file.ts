/**
 * File download usecase — provider-dispatched.
 * Uses the storage abstraction for all file operations.
 */
import { RequestContext } from '../types';
import { FileRepository } from '../repositories/FileRepository';
import { assertCanRead } from '../policies/common';
import { notFound, forbidden } from '@/lib/errors/types';
import { getStorageProvider, assertTenantKey } from '@/lib/storage';
import { logEvent } from '../events/audit';
import { runInTenantContext } from '@/lib/db-context';
import { logger } from '@/lib/observability/logger';

export async function downloadFile(ctx: RequestContext, fileName: string) {
    assertCanRead(ctx);
    logger.info('file download started', { component: 'file', fileName });

    return runInTenantContext(ctx, async (db) => {
        const isOwned = await FileRepository.isFileOwnedByTenant(db, ctx, fileName);
        if (!isOwned) {
            throw forbidden('You do not have permission to access this file');
        }

        const storage = getStorageProvider();

        if (storage.name === 's3') {
            // For S3: try to find the FileRecord for presigned URL

            const fileRecord = await db.fileRecord.findFirst({
                where: { tenantId: ctx.tenantId, pathKey: fileName },
            });
            if (fileRecord) {
                assertTenantKey(fileRecord.pathKey, ctx.tenantId);
                const downloadUrl = await storage.createSignedDownloadUrl(fileRecord.pathKey, {
                    expiresIn: 300,
                    downloadFilename: fileRecord.originalName,
                });
                await logEvent(db, ctx, {
                    action: 'READ',
                    entityType: 'File',
                    entityId: fileName,
                    details: `Downloaded file via presigned URL: ${fileRecord.originalName}`,
                    detailsJson: {
                        category: 'access',
                        operation: 'login',
                        detail: `File downloaded: ${fileRecord.originalName}`,
                    },
                });
                return {
                    mode: 'redirect' as const,
                    downloadUrl,
                    name: fileRecord.originalName,
                    mimeType: fileRecord.mimeType,
                };
            }
        }

        // Local fallback: read file through provider
        try {
            const stream = storage.readStream(fileName);
            // Determine mime type from extension
            const ext = fileName.split('.').pop()?.toLowerCase() || '';
            const mimeMap: Record<string, string> = {
                pdf: 'application/pdf', png: 'image/png',
                jpg: 'image/jpeg', jpeg: 'image/jpeg',
                csv: 'text/csv', doc: 'application/msword',
                docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            };
            const mimeType = mimeMap[ext] || 'application/octet-stream';
            const safeName = fileName.split('/').pop() || fileName;

            await logEvent(db, ctx, {
                action: 'READ',
                entityType: 'File',
                entityId: fileName,
                details: `Downloaded file: ${safeName}`,
                detailsJson: {
                    category: 'access',
                    operation: 'login',
                    detail: `File downloaded: ${safeName}`,
                },
            });

            // Collect stream into buffer for legacy compat
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const buffer = Buffer.concat(chunks);

            return { mode: 'stream' as const, buffer, mimeType, name: safeName };
        } catch {
            throw notFound('File not found on disk');
        }
    });
}
