/**
 * Push-subscription usecase — a tenant member managing their OWN Web Push
 * subscriptions (self-service, like MFA enrolment). One row per
 * (tenant, user, browser endpoint); upsert keeps re-subscribes idempotent.
 */
import { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';

export interface SavePushSubscriptionInput {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
}

export async function savePushSubscription(
    ctx: RequestContext,
    input: SavePushSubscriptionInput,
): Promise<{ id: string }> {
    return runInTenantContext(ctx, async (db) => {
        const existing = await db.pushSubscription.findFirst({
            where: { tenantId: ctx.tenantId, userId: ctx.userId, endpoint: input.endpoint },
            select: { id: true },
        });
        if (existing) {
            await db.pushSubscription.update({
                where: { id: existing.id },
                data: { p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent ?? null },
            });
            return { id: existing.id };
        }
        return db.pushSubscription.create({
            data: {
                tenantId: ctx.tenantId,
                userId: ctx.userId,
                endpoint: input.endpoint,
                p256dh: input.p256dh,
                auth: input.auth,
                userAgent: input.userAgent ?? null,
            },
            select: { id: true },
        });
    });
}

export async function removePushSubscription(ctx: RequestContext, endpoint: string): Promise<void> {
    await runInTenantContext(ctx, (db) =>
        db.pushSubscription.deleteMany({
            where: { tenantId: ctx.tenantId, userId: ctx.userId, endpoint },
        }),
    );
}
