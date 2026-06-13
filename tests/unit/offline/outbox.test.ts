/**
 * Unit tests for the offline outbox queue (`src/lib/offline/outbox.ts`).
 */
import {
    InMemoryOutboxStore,
    LocalStorageOutboxStore,
    enqueue,
    newOutboxId,
    type OutboxItem,
} from '@/lib/offline/outbox';

function item(over: Partial<OutboxItem> = {}): OutboxItem {
    return {
        id: over.id ?? newOutboxId(),
        url: over.url ?? '/api/t/acme/field-operations/t1/parcels/p1',
        method: over.method ?? 'PATCH',
        body: over.body ?? { status: 'DONE' },
        label: over.label ?? 'Mark P1 done',
        createdAt: over.createdAt ?? Date.now(),
        attempts: over.attempts ?? 0,
    };
}

describe('newOutboxId', () => {
    it('produces unique-ish ids', () => {
        const ids = new Set(Array.from({ length: 200 }, () => newOutboxId()));
        expect(ids.size).toBe(200);
    });
});

describe('InMemoryOutboxStore', () => {
    it('adds, lists FIFO, updates, and removes', async () => {
        const s = new InMemoryOutboxStore();
        await s.add(item({ id: 'b', createdAt: 2 }));
        await s.add(item({ id: 'a', createdAt: 1 }));
        expect((await s.all()).map((x) => x.id)).toEqual(['a', 'b']); // sorted by createdAt

        await s.update(item({ id: 'a', createdAt: 1, attempts: 3 }));
        expect((await s.all()).find((x) => x.id === 'a')!.attempts).toBe(3);

        await s.remove('a');
        expect((await s.all()).map((x) => x.id)).toEqual(['b']);
    });
});

describe('LocalStorageOutboxStore', () => {
    const backing = new Map<string, string>();
    beforeAll(() => {
        (globalThis as unknown as { localStorage: Storage }).localStorage = {
            getItem: (k: string) => backing.get(k) ?? null,
            setItem: (k: string, v: string) => void backing.set(k, v),
            removeItem: (k: string) => void backing.delete(k),
            clear: () => backing.clear(),
            key: () => null,
            length: 0,
        } as Storage;
    });
    beforeEach(() => backing.clear());

    it('round-trips through localStorage', async () => {
        const s = new LocalStorageOutboxStore('test.key');
        await s.add(item({ id: 'x' }));
        await s.add(item({ id: 'y' }));
        expect((await s.all()).map((i) => i.id).sort()).toEqual(['x', 'y']);
        expect(backing.has('test.key')).toBe(true);

        await s.remove('x');
        expect((await s.all()).map((i) => i.id)).toEqual(['y']);
    });

    it('fails soft on corrupt JSON (returns empty)', async () => {
        backing.set('test.key', '{not json');
        const s = new LocalStorageOutboxStore('test.key');
        expect(await s.all()).toEqual([]);
    });
});

describe('enqueue', () => {
    it('stamps id/createdAt/attempts and appends', async () => {
        const s = new InMemoryOutboxStore();
        const created = await enqueue(s, { url: '/u', method: 'POST', body: { a: 1 }, label: 'L' });
        expect(created.attempts).toBe(0);
        expect(typeof created.id).toBe('string');
        expect(created.createdAt).toBeGreaterThan(0);
        expect((await s.all())).toHaveLength(1);
    });
});
