import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listVendorLinks, addVendorLink } from '@/app-layer/usecases/vendor';
import { withValidatedBody } from '@/lib/validation/route';
import { AddVendorLinkSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const links = await listVendorLinks(ctx, params.vendorId);
    return jsonResponse(links);
});

export const POST = withApiErrorHandling(withValidatedBody(AddVendorLinkSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const link = await addVendorLink(ctx, params.vendorId, body);
    return jsonResponse(link, { status: 201 });
}));
