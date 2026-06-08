import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { getGovernanceGraph } from '@/app-layer/services/governance-graph-builder';

type Ctx = { params: Promise<{ tenantSlug: string }> };

/**
 * VR-10 — the cross-map governance meta-graph (maps as nodes, sub-flow calls
 * as edges, execution health as node colour). Read-only; cacheable.
 */
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const graph = await getGovernanceGraph(ctx, new Date());
    return jsonResponse(graph);
});
