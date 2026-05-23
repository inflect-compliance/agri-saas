import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listVendorDocuments, addVendorDocument } from '@/app-layer/usecases/vendor';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateVendorDocumentSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const docs = await listVendorDocuments(ctx, params.vendorId);
    return jsonResponse(docs);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateVendorDocumentSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const doc = await addVendorDocument(ctx, params.vendorId, body);
    return jsonResponse(doc, { status: 201 });
}));
