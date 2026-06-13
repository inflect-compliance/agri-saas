/**
 * Offline outbox — the "queue" half of the operator PWA's queue-and-sync.
 *
 * When an operator marks a spray line in the field with no signal, the
 * mutation is appended here instead of being lost. On reconnect the
 * outbox is flushed (see `sync.ts`). Mutations are tiny JSON
 * (`PATCH …/parcels/:id { status }`), so a `localStorage`-backed store is
 * plenty — no IndexedDB needed until we queue photos (deferred).
 *
 * The store is an interface so the queue logic stays pure + unit-testable
 * (the in-memory store) and the browser binding is a thin adapter.
 */

export type OutboxMethod = 'POST' | 'PATCH' | 'DELETE';

export interface OutboxItem {
    /** Client-generated id — also the idempotency handle on replay. */
    id: string;
    /** Tenant-scoped API path (already built via useTenantApiUrl). */
    url: string;
    method: OutboxMethod;
    body: unknown;
    /** Human label for the pending-sync UI ("Mark North 40 done"). */
    label: string;
    createdAt: number;
    attempts: number;
}

export interface OutboxStore {
    add(item: OutboxItem): Promise<void>;
    all(): Promise<OutboxItem[]>;
    update(item: OutboxItem): Promise<void>;
    remove(id: string): Promise<void>;
}

export const OUTBOX_STORAGE_KEY = 'agri.offline.outbox.v1';

/** Stable id without a uuid dep (crypto.randomUUID where available). */
export function newOutboxId(): string {
    try {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    } catch {
        /* fall through */
    }
    return `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * `localStorage`-backed store. Reads/writes the whole array each call —
 * fine for the handful of items a field session accumulates. Fails soft
 * (returns empty / no-ops) if storage is unavailable (private mode).
 */
export class LocalStorageOutboxStore implements OutboxStore {
    constructor(private readonly key: string = OUTBOX_STORAGE_KEY) {}

    private read(): OutboxItem[] {
        try {
            const raw = globalThis.localStorage?.getItem(this.key);
            return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
        } catch {
            return [];
        }
    }
    private write(items: OutboxItem[]): void {
        try {
            globalThis.localStorage?.setItem(this.key, JSON.stringify(items));
        } catch {
            /* storage full / unavailable — drop silently */
        }
    }

    async add(item: OutboxItem): Promise<void> {
        const items = this.read();
        items.push(item);
        this.write(items);
    }
    async all(): Promise<OutboxItem[]> {
        return this.read().sort((a, b) => a.createdAt - b.createdAt);
    }
    async update(item: OutboxItem): Promise<void> {
        this.write(this.read().map((x) => (x.id === item.id ? item : x)));
    }
    async remove(id: string): Promise<void> {
        this.write(this.read().filter((x) => x.id !== id));
    }
}

/** In-memory store for tests (and SSR no-op safety). */
export class InMemoryOutboxStore implements OutboxStore {
    private items: OutboxItem[] = [];
    async add(item: OutboxItem): Promise<void> {
        this.items.push(item);
    }
    async all(): Promise<OutboxItem[]> {
        return [...this.items].sort((a, b) => a.createdAt - b.createdAt);
    }
    async update(item: OutboxItem): Promise<void> {
        this.items = this.items.map((x) => (x.id === item.id ? item : x));
    }
    async remove(id: string): Promise<void> {
        this.items = this.items.filter((x) => x.id !== id);
    }
}

export interface EnqueueInput {
    url: string;
    method: OutboxMethod;
    body: unknown;
    label: string;
}

/** Append a mutation to the outbox; returns the created item. */
export async function enqueue(store: OutboxStore, input: EnqueueInput): Promise<OutboxItem> {
    const item: OutboxItem = {
        id: newOutboxId(),
        url: input.url,
        method: input.method,
        body: input.body,
        label: input.label,
        createdAt: Date.now(),
        attempts: 0,
    };
    await store.add(item);
    return item;
}

/** The default browser store (singleton). */
let browserStore: OutboxStore | null = null;
export function getOutboxStore(): OutboxStore {
    if (!browserStore) {
        browserStore = typeof globalThis.localStorage !== 'undefined'
            ? new LocalStorageOutboxStore()
            : new InMemoryOutboxStore();
    }
    return browserStore;
}
