import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { savePushSubscription, removePushSubscription } from '@/app-layer/usecases/push-subscription';
import { PushSubscriptionSchema, RemovePushSubscriptionSchema } from '@/app-layer/schemas/push.schemas';
import { isWebPushConfigured } from '@/lib/notifications/web-push';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

type Ctx = { params: Promise<{ tenantSlug: string }> };

// Self-service: a tenant member registers THIS browser for Web Push. 503 when
// the server has no VAPID keys configured (push disabled) so the client can
// degrade gracefully.
export const POST = withApiErrorHandling(
    withValidatedBody(PushSubscriptionSchema, async (req: NextRequest, { params }: Ctx, body) => {
        const ctx = await getTenantCtx(await params, req);
        if (!isWebPushConfigured()) return jsonResponse({ error: 'push_not_configured' }, { status: 503 });
        const sub = await savePushSubscription(ctx, {
            endpoint: body.endpoint,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
            userAgent: req.headers.get('user-agent'),
        });
        return jsonResponse({ id: sub.id }, { status: 201 });
    }),
);

export const DELETE = withApiErrorHandling(
    withValidatedBody(RemovePushSubscriptionSchema, async (req: NextRequest, { params }: Ctx, body) => {
        const ctx = await getTenantCtx(await params, req);
        await removePushSubscription(ctx, body.endpoint);
        return jsonResponse({ ok: true });
    }),
);
