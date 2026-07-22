import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { assertPlatformSupport } from '@/lib/auth/platform-support';
import { runInTenantContext } from '@/lib/db-context';
import { updateCompany } from '@/app-layer/usecases/company';
import { UpdateCompanySchema } from '@/app-layer/schemas/promotion-admin.schemas';


/** Route params — the tenant slug plus this route's own `[id]` segment. */
type IdParams = { tenantSlug: string; id: string };

/**
 * Edit a supplier's details, including the contact address the lead digest will
 * send to. See `../route.ts` for why this surface is platform-only.
 */
export const PATCH = withApiErrorHandling(
    requirePermission<IdParams>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        assertPlatformSupport(ctx);
        const { id } = params;
        const input = UpdateCompanySchema.parse(await req.json());
        const company = await runInTenantContext(ctx, (db) => updateCompany(db, ctx, id, input));
        return jsonResponse({ id: company.id });
    }),
);
