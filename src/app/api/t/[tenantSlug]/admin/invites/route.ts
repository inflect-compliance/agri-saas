/**
 * /api/t/:slug/admin/invites
 *
 * GET  — list pending invites for the tenant.
 * POST — create a new invite token (rate-limited: 20/hr per tenant).
 *
 * Both handlers require admin.members permission.
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createInviteToken, listPendingInvites } from '@/app-layer/usecases/tenant-invites';
import { withApiErrorHandling } from '@/lib/errors/api';
import { TENANT_INVITE_CREATE_LIMIT } from '@/lib/security/rate-limit';
import { enforceRateLimit, getClientIp } from '@/lib/security/rate-limit-middleware';
import { isRateLimitBypassed } from '@/lib/security/rate-limit-middleware';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const CreateInviteSchema = z.object({
    email: z.string().email('Valid email required'),
    role: z.enum(['OWNER', 'ADMIN', 'EDITOR', 'AUDITOR', 'READER']),
});

export const GET = withApiErrorHandling(
    requirePermission('admin.members', async (_req: NextRequest, _routeArgs, ctx) => {
        const invites = await listPendingInvites(ctx);
        return jsonResponse(invites);
    }),
);

export const POST = withApiErrorHandling(
    requirePermission('admin.members', async (req: NextRequest, _routeArgs, ctx) => {
        // Rate-limit: 20/hr per (tenantId, IP). Keyed on tenant so a
        // multi-IP attacker with one compromised ADMIN session still burns
        // the shared tenant budget.
        if (!isRateLimitBypassed()) {
            const enforcement = enforceRateLimit(req, {
                scope: `invite-create:${ctx.tenantId}`,
                config: TENANT_INVITE_CREATE_LIMIT,
                ip: getClientIp(req),
                userId: ctx.userId,
            });
            if (enforcement.response) return enforcement.response;
        }

        const body = await req.json();
        const input = CreateInviteSchema.parse(body);
        const result = await createInviteToken(ctx, input);
        return jsonResponse({ invite: result.invite, url: result.url }, { status: 201 });
    }),
);
