/**
 * Unit tests for the offline sync/replay engine
 * (`src/lib/offline/sync.ts`). The retry policy is the crux: success
 * removes, terminal-4xx drops, transient keeps + bumps, poison drops.
 */
import { InMemoryOutboxStore, enqueue, type OutboxItem } from '@/lib/offline/outbox';
import { flushOutbox, MAX_ATTEMPTS, type Sender } from '@/lib/offline/sync';

async function seed(n: number): Promise<InMemoryOutboxStore> {
    const s = new InMemoryOutboxStore();
    for (let i = 0; i < n; i++) {
        await enqueue(s, { url: `/u/${i}`, method: 'PATCH', body: { i }, label: `L${i}` });
    }
    return s;
}

const ok: Sender = async () => ({ ok: true, status: 200 });
const terminal: Sender = async () => ({ ok: false, status: 400 });
const serverErr: Sender = async () => ({ ok: false, status: 503 });
const throws: Sender = async () => {
    throw new Error('network down');
};

describe('flushOutbox', () => {
    it('removes successfully-sent items', async () => {
        const s = await seed(3);
        const res = await flushOutbox(s, ok);
        expect(res).toMatchObject({ sent: 3, failed: 0, dropped: 0, remaining: 0 });
        expect(await s.all()).toHaveLength(0);
    });

    it('drops terminal 4xx (so the queue keeps moving)', async () => {
        const s = await seed(2);
        const res = await flushOutbox(s, terminal);
        expect(res).toMatchObject({ sent: 0, dropped: 2, remaining: 0 });
    });

    it('keeps + bumps attempts on a 5xx (transient)', async () => {
        const s = await seed(1);
        const res = await flushOutbox(s, serverErr);
        expect(res).toMatchObject({ sent: 0, failed: 1, dropped: 0, remaining: 1 });
        expect((await s.all())[0].attempts).toBe(1);
    });

    it('treats a network throw as transient (status 0)', async () => {
        const s = await seed(1);
        const res = await flushOutbox(s, throws);
        expect(res.failed).toBe(1);
        expect(res.remaining).toBe(1);
    });

    it.each([408, 429])('retries on %d', async (status) => {
        const s = await seed(1);
        const res = await flushOutbox(s, async () => ({ ok: false, status }));
        expect(res.failed).toBe(1);
        expect(res.remaining).toBe(1);
    });

    it('drops a poison item once it exceeds MAX_ATTEMPTS', async () => {
        const s = new InMemoryOutboxStore();
        const it: OutboxItem = {
            id: 'poison',
            url: '/u',
            method: 'PATCH',
            body: {},
            label: 'L',
            createdAt: 1,
            attempts: MAX_ATTEMPTS - 1,
        };
        await s.add(it);
        const res = await flushOutbox(s, serverErr);
        expect(res.dropped).toBe(1);
        expect(await s.all()).toHaveLength(0);
    });

    it('flushes in FIFO order', async () => {
        const s = new InMemoryOutboxStore();
        await s.add({ id: 'second', url: '/u', method: 'PATCH', body: {}, label: 'L', createdAt: 200, attempts: 0 });
        await s.add({ id: 'first', url: '/u', method: 'PATCH', body: {}, label: 'L', createdAt: 100, attempts: 0 });
        const order: string[] = [];
        await flushOutbox(s, async (item) => {
            order.push(item.id);
            return { ok: true, status: 200 };
        });
        expect(order).toEqual(['first', 'second']);
    });

    it('handles a mixed batch: send ok, drop 4xx, keep 5xx', async () => {
        const s = new InMemoryOutboxStore();
        await s.add({ id: 'a', url: '/a', method: 'PATCH', body: {}, label: 'L', createdAt: 1, attempts: 0 });
        await s.add({ id: 'b', url: '/b', method: 'PATCH', body: {}, label: 'L', createdAt: 2, attempts: 0 });
        await s.add({ id: 'c', url: '/c', method: 'PATCH', body: {}, label: 'L', createdAt: 3, attempts: 0 });
        const send: Sender = async (item) =>
            item.id === 'a' ? { ok: true, status: 200 } : item.id === 'b' ? { ok: false, status: 422 } : { ok: false, status: 500 };
        const res = await flushOutbox(s, send);
        expect(res).toMatchObject({ sent: 1, dropped: 1, failed: 1, remaining: 1 });
        expect((await s.all())[0].id).toBe('c');
    });
});
