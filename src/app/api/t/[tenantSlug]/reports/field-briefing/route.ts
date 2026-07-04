/**
 * GET /api/t/[tenantSlug]/reports/field-briefing
 *
 * Returns the AI field-briefing read-model (the dashboard "Field briefing"
 * card that replaced the static season recap). Read-only — authorises via
 * `assertCanRead` inside `getFieldBriefing`, matching the other reports
 * routes (usecase-layer policy, not `requirePermission`).
 *
 * Node runtime + a generous duration: a cold (uncached) briefing runs
 * Earth Engine reduces + a Claude Haiku call. Successful results are cached
 * per tenant per day, so only the first load of the day pays that cost.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getFieldBriefing } from '@/app-layer/usecases/satellite-briefing';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const payload = await getFieldBriefing(ctx);
        return jsonResponse(payload);
    },
);
