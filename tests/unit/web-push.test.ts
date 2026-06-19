/**
 * Web Push send unit tests — proves the notification → push fan-out:
 *   - configured + subscriptions → one sendNotification per device, with the
 *     JSON payload;
 *   - a 410 Gone response prunes the dead subscription;
 *   - unconfigured (no VAPID keys) → silent no-op (dev/CI/self-hosted).
 *
 * web-push + the tenant-context DB are mocked; the real send/prune wiring in
 * src/lib/notifications/web-push.ts is exercised.
 */
import type { RequestContext } from '@/app-layer/types';

const setVapidDetails = jest.fn();
const sendNotification = jest.fn();
jest.mock('web-push', () => ({
    __esModule: true,
    default: {
        setVapidDetails: (...a: unknown[]) => setVapidDetails(...a),
        sendNotification: (...a: unknown[]) => sendNotification(...a),
    },
}));

const findMany = jest.fn();
const deleteMany = jest.fn();
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, cb: (db: unknown) => unknown) =>
        cb({ pushSubscription: { findMany, deleteMany } }),
}));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/observability/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn() } }));

const ctx = { tenantId: 't1', userId: 'u-sender', requestId: 'r1' } as unknown as RequestContext;

function loadWithEnv(vapid: Record<string, string | undefined>) {
    jest.resetModules();
    jest.doMock('@/env', () => ({ env: vapid }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/lib/notifications/web-push') as typeof import('@/lib/notifications/web-push');
}

beforeEach(() => {
    setVapidDetails.mockClear();
    sendNotification.mockClear();
    findMany.mockReset();
    deleteMany.mockReset();
});

describe('sendWebPushToUser', () => {
    it('sends one push per subscription with the JSON payload when configured', async () => {
        const wp = loadWithEnv({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@y.z' });
        findMany.mockResolvedValue([
            { id: 's1', endpoint: 'https://push/1', p256dh: 'k1', auth: 'a1' },
            { id: 's2', endpoint: 'https://push/2', p256dh: 'k2', auth: 'a2' },
        ]);
        sendNotification.mockResolvedValue(undefined);

        await wp.sendWebPushToUser(ctx, 'u-recipient', { title: 'Assigned', body: 'T-1 is yours', url: '/t/acme/tasks/1' });

        expect(wp.isWebPushConfigured()).toBe(true);
        expect(sendNotification).toHaveBeenCalledTimes(2);
        const [sub, payload] = sendNotification.mock.calls[0];
        expect(sub).toEqual({ endpoint: 'https://push/1', keys: { p256dh: 'k1', auth: 'a1' } });
        expect(JSON.parse(payload as string)).toMatchObject({ title: 'Assigned', body: 'T-1 is yours', url: '/t/acme/tasks/1' });
        expect(deleteMany).not.toHaveBeenCalled();
    });

    it('prunes a subscription that returns 410 Gone', async () => {
        const wp = loadWithEnv({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' });
        findMany.mockResolvedValue([
            { id: 'dead', endpoint: 'https://push/dead', p256dh: 'k', auth: 'a' },
            { id: 'live', endpoint: 'https://push/live', p256dh: 'k', auth: 'a' },
        ]);
        sendNotification.mockImplementation((sub: { endpoint: string }) => {
            if (sub.endpoint.endsWith('/dead')) return Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 }));
            return Promise.resolve(undefined);
        });
        deleteMany.mockResolvedValue({ count: 1 });

        await wp.sendWebPushToUser(ctx, 'u-recipient', { title: 'x', body: 'y' });

        expect(deleteMany).toHaveBeenCalledTimes(1);
        expect(deleteMany.mock.calls[0][0]).toEqual({ where: { id: { in: ['dead'] } } });
    });

    it('is a silent no-op when VAPID keys are absent', async () => {
        const wp = loadWithEnv({});
        await wp.sendWebPushToUser(ctx, 'u-recipient', { title: 'x', body: 'y' });
        expect(wp.isWebPushConfigured()).toBe(false);
        expect(sendNotification).not.toHaveBeenCalled();
        expect(findMany).not.toHaveBeenCalled();
    });
});
