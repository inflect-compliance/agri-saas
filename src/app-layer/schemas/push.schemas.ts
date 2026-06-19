import { z } from 'zod';

/** Web Push subscription as produced by `PushSubscription.toJSON()`. */
export const PushSubscriptionSchema = z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({
        p256dh: z.string().min(1).max(500),
        auth: z.string().min(1).max(500),
    }),
});

export const RemovePushSubscriptionSchema = z.object({
    endpoint: z.string().url().max(2000),
});
