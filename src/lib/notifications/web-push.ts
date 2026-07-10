/**
 * Web Push delivery — the browser-push channel for the notification system.
 * Server-only by construction (imports the `web-push` Node lib + the
 * tenant-scoped DB context helper);
 * never import it from a client component.
 *
 * Opt-in + permission-graceful at every layer:
 *   - Unconfigured (no VAPID keys) → {@link isWebPushConfigured} is false and
 *     every send is a silent no-op, so dev/CI/self-hosted run without push.
 *   - Per recipient: a user with no subscriptions is skipped.
 *   - Dead endpoints (404/410 from the push service) are pruned so they
 *     don't accumulate.
 *
 * Never holds a DB transaction open across the network send: the
 * subscriptions are read in a short tenant-scoped tx, the actual sends fan
 * out OUTSIDE any tx, and pruning is a second short tx. Always awaited by
 * the caller so the push fires within the originating request/job.
 */
import webpush from 'web-push';
import { runInTenantContext } from '@/lib/db-context';
import { logger } from '@/lib/observability/logger';
import { env } from '@/env';
import type { RequestContext } from '@/app-layer/types';

let configured: boolean | null = null;

/** True once VAPID keys are present + applied. Cached after first check. */
export function isWebPushConfigured(): boolean {
    if (configured !== null) return configured;
    const pub = env.VAPID_PUBLIC_KEY;
    const priv = env.VAPID_PRIVATE_KEY;
    if (pub && priv) {
        webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:ops@agrent.bg', pub, priv);
        configured = true;
    } else {
        configured = false;
    }
    return configured;
}

export interface WebPushPayload {
    title: string;
    body: string;
    /** Deep-link opened on notification click. */
    url?: string;
    /** Coalescing tag — a newer push with the same tag replaces the old. */
    tag?: string;
}

/**
 * Send a Web Push to every device the recipient has subscribed in this
 * tenant. `ctx` provides the tenant scope for the (RLS-bound) subscription
 * read/prune; `recipientUserId` is who receives it. Fully best-effort.
 */
export async function sendWebPushToUser(
    ctx: RequestContext,
    recipientUserId: string,
    payload: WebPushPayload,
): Promise<void> {
    if (!isWebPushConfigured()) return;

    let subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> = [];
    try {
        subs = await runInTenantContext(ctx, (db) =>
            db.pushSubscription.findMany({
                where: { tenantId: ctx.tenantId, userId: recipientUserId },
                select: { id: true, endpoint: true, p256dh: true, auth: true },
                take: 25,
            }),
        );
    } catch {
        return; // reading subs failed — nothing to send
    }
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    const dead: string[] = [];
    await Promise.all(
        subs.map(async (s) => {
            try {
                await webpush.sendNotification(
                    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                    body,
                );
            } catch (err) {
                const status = (err as { statusCode?: number }).statusCode;
                if (status === 404 || status === 410) {
                    dead.push(s.id); // subscription expired/unsubscribed — prune
                } else {
                    logger.warn('web-push.send_failed', {
                        component: 'web-push',
                        tenantId: ctx.tenantId,
                        status: status ?? 0,
                    });
                }
            }
        }),
    );

    if (dead.length > 0) {
        try {
            await runInTenantContext(ctx, (db) =>
                db.pushSubscription.deleteMany({ where: { id: { in: dead } } }),
            );
        } catch {
            /* prune is best-effort */
        }
    }
}
