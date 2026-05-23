import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { verifyTenantChain } from '@/lib/audit/verify';
import { jsonResponse } from '@/lib/api-response';

/**
 * GET /api/t/[tenantSlug]/audit-log/verify
 *
 * ADMIN-only endpoint to verify audit hash chain integrity for the
 * current tenant. Returns a VerificationReport JSON.
 *
 * Query params:
 *   - from: ISO-8601 date (optional, filter entries from this date)
 *   - to:   ISO-8601 date (optional, filter entries to this date)
 */
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);

    // OWNER + ADMIN. OWNER is a superset of ADMIN per CLAUDE.md RBAC.
    if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') {
        return jsonResponse({ error: 'Forbidden: ADMIN role required' }, { status: 403 });
    }

    // Parse optional query params
    const url = new URL(req.url);
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    const result = await verifyTenantChain(ctx.tenantId, {
        from: fromParam ? new Date(fromParam) : undefined,
        to: toParam ? new Date(toParam) : undefined,
        maxBreaks: 20,
    });

    return jsonResponse(result);
});
