import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { buildAutomationEvidencePack } from '@/app-layer/usecases/automation-export';

type Ctx = { params: Promise<{ tenantSlug: string; id: string }> };

/**
 * VR-8 — Compliance Evidence Pack for an automation canvas: the map's rules +
 * 30-day execution aggregates, structured for an audit pack / SOC 2 evidence
 * request. The same payload backs the PDF "Workflow Diagram" export.
 */
export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const pack = await buildAutomationEvidencePack(ctx, params.id, new Date());
    return jsonResponse(pack);
});
