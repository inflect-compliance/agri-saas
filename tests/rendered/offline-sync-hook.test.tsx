/**
 * @jest-environment jsdom
 *
 * Behavioural test for the offline-sync hook's concurrent-flush guard:
 * two flushes fired back-to-back (the `online` event + a manual "Sync
 * now") must not drain the same outbox item twice.
 */
import { renderHook, act } from '@testing-library/react';

// One shared in-memory store behind getOutboxStore, exposed for seeding.
jest.mock('@/lib/offline/outbox', () => {
    const actual = jest.requireActual('@/lib/offline/outbox');
    const store = new actual.InMemoryOutboxStore();
    return { ...actual, getOutboxStore: () => store, __store: store };
});

import * as outbox from '@/lib/offline/outbox';
import { useOfflineSync } from '@/lib/offline/use-offline-sync';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = (outbox as any).__store;

describe('useOfflineSync — concurrent flush guard', () => {
    beforeEach(() => {
        // Drain the shared store between tests.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (store as any).items = [];
    });

    it('a second concurrent flush does not re-send the same item', async () => {
        await outbox.enqueue(store, { url: '/u', method: 'PATCH', body: { status: 'DONE' }, label: 'L' });

        const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).fetch = fetchMock;

        const { result } = renderHook(() => useOfflineSync());

        // Fire two flushes back-to-back. The first synchronously sets the
        // in-flight guard before the second runs, so the second
        // short-circuits before ever reaching the network.
        await act(async () => {
            const p1 = result.current.flush();
            const p2 = result.current.flush();
            await Promise.all([p1, p2]);
        });

        // The single queued item was delivered exactly once + removed.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await store.all()).toHaveLength(0);
    });
});
