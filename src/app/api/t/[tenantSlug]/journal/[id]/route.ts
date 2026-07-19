import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { getLogEntry, updateLogEntry, deleteLogEntry } from '@/app-layer/usecases/journal';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateLogEntrySchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await assertModuleEnabled(ctx, 'JOURNAL');
    const entry = await getLogEntry(ctx, params.id);
    return jsonResponse(entry);
});

export const PUT = withApiErrorHandling(withValidatedBody(UpdateLogEntrySchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await assertModuleEnabled(ctx, 'JOURNAL');
    const entry = await updateLogEntry(ctx, params.id, body);
    return jsonResponse({ success: true, entry });
}));

export const PATCH = PUT;

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await assertModuleEnabled(ctx, 'JOURNAL');
    await deleteLogEntry(ctx, params.id);
    return jsonResponse({ success: true });
});
