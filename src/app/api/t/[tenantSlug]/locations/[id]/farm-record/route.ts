/**
 * POST /api/t/[tenantSlug]/locations/[id]/farm-record
 *
 * Generates the Bulgarian БАБХ "ДНЕВНИК за проведените растителнозащитни
 * мероприятия и торене" for a location + date range, and returns it as
 * `application/pdf`. With `{ save: true }` it also persists the PDF as a
 * FileRecord (domain 'reports') and returns `{ fileRecordId, fileName }`.
 *
 * Read-only data, authorised via `assertCanRead` inside the generator —
 * matching the reports/pdf/generate + year-on-farm privilege model (no
 * `requirePermission`; reports are not a privileged route root).
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { generateFarmRecordDiaryPdf } from '@/app-layer/reports/pdf/farm-record-diary';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { getStorageProvider, buildTenantObjectKey } from '@/lib/storage';
import { runInTenantContext } from '@/lib/db-context';
import { z } from 'zod';

const BodySchema = z
    .object({
        from: z.string().min(1, 'from is required'),
        to: z.string().min(1, 'to is required'),
        save: z.boolean().optional().default(false),
    })
    .strip();

/** Collect a PDFKit document into a Buffer (listeners first, then end()). */
function collectPdfBuffer(pdfDoc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);
        pdfDoc.end();
    });
}

// Force Node.js runtime — PDFKit needs stream, zlib, Buffer.
export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const body = BodySchema.parse(await req.json());

        const pdfDoc = await generateFarmRecordDiaryPdf(ctx, {
            locationId: params.id,
            from: body.from,
            to: body.to,
        });
        const pdfBuffer = await collectPdfBuffer(pdfDoc);
        const fileName = `dnevnik-${params.id}.pdf`;

        if (body.save) {
            const storage = getStorageProvider();
            const pathKey = buildTenantObjectKey(ctx.tenantId, 'reports', fileName);
            const { Readable } = await import('stream');
            const writeResult = await storage.write(pathKey, Readable.from(pdfBuffer), {
                mimeType: 'application/pdf',
            });
            const fileRecord = (await runInTenantContext(ctx, (db) =>
                db.fileRecord.create({
                    data: {
                        tenantId: ctx.tenantId,
                        pathKey,
                        originalName: fileName,
                        mimeType: 'application/pdf',
                        sizeBytes: writeResult.sizeBytes,
                        sha256: writeResult.sha256,
                        status: 'STORED',
                        uploadedByUserId: ctx.userId,
                        storedAt: new Date(),
                        storageProvider: storage.name,
                        domain: 'reports',
                        scanStatus: 'SKIPPED',
                    },
                }),
            )) as { id: string };

            return jsonResponse({ fileRecordId: fileRecord.id, fileName });
        }

        return new Response(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Cache-Control': 'no-store',
                'Content-Length': String(pdfBuffer.length),
            },
        });
    },
);
