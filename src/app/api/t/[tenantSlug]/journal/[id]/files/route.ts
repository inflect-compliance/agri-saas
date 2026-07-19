/**
 * POST   /api/t/[tenantSlug]/journal/[id]/files
 *   - multipart/form-data → uploads a photo, creates the FileRecord
 *     through the shared storage pipeline, and links it (photo logging).
 *   - application/json     → attaches an already-uploaded FileRecord
 *     ({ fileRecordId, caption? }).
 *
 * DELETE /api/t/[tenantSlug]/journal/[id]/files?fileRecordId=<id>
 *   - detaches the FileRecord from the entry (the FileRecord survives).
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import {
    uploadLogEntryPhoto,
    attachLogEntryFile,
    detachLogEntryFile,
} from '@/app-layer/usecases/journal';
import { AttachLogEntryFileSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { badRequest } from '@/lib/errors/types';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await assertModuleEnabled(ctx, 'JOURNAL');

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        const file = formData.get('file');
        if (!file || !(file instanceof File)) {
            throw badRequest('Missing or invalid file in form data');
        }
        const caption = (formData.get('caption') as string | null) ?? null;
        // Offline exactly-once: the outbox replays a queued photo with the
        // item id as `Idempotency-Key`. Threaded through so a replayed upload
        // returns the original link instead of attaching the photo twice.
        const idempotencyKey = req.headers.get('Idempotency-Key');
        const link = await uploadLogEntryPhoto(ctx, params.id, file, caption, idempotencyKey);
        return jsonResponse(link, { status: 201 });
    }

    // JSON path — attach an already-uploaded FileRecord.
    let raw: unknown;
    try {
        raw = await req.json();
    } catch {
        throw badRequest('Invalid JSON payload');
    }
    const body = AttachLogEntryFileSchema.parse(raw);
    const link = await attachLogEntryFile(ctx, params.id, body.fileRecordId, body.caption);
    return jsonResponse(link, { status: 201 });
});

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await assertModuleEnabled(ctx, 'JOURNAL');
    const fileRecordId = req.nextUrl.searchParams.get('fileRecordId');
    if (!fileRecordId) throw badRequest('fileRecordId query parameter is required');
    const result = await detachLogEntryFile(ctx, params.id, fileRecordId);
    return jsonResponse(result);
});
