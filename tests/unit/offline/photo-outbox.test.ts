/**
 * @jest-environment jsdom
 *
 * Unit tests for the binary (photo) outbox path (Roadmap-6 P2). The outbox
 * carries a second item kind whose downscaled BYTES ride as a Blob; on replay
 * the `fetchSender` must reconstruct multipart FormData and POST it exactly
 * once, carrying the item id as the idempotency handle. An oversized blob is
 * rejected at ENQUEUE so it can never wedge the queue.
 *
 * jsdom gives us Blob / File / FormData; `fetch` is mocked per test.
 */
import {
    InMemoryOutboxStore,
    enqueuePhoto,
    isPhotoItem,
    MAX_QUEUED_PHOTO_BYTES,
    PhotoTooLargeError,
} from '@/lib/offline/outbox';
import { flushOutbox, fetchSender } from '@/lib/offline/sync';

type Init = RequestInit & { headers?: Record<string, string>; body?: unknown };

function fakeResponse(status: number): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
    } as unknown as Response;
}

afterEach(() => {
    // @ts-expect-error — restore between tests
    delete global.fetch;
    jest.restoreAllMocks();
});

describe('binary photo outbox', () => {
    it('rejects an oversized blob at enqueue (never queued)', async () => {
        const store = new InMemoryOutboxStore();
        const big = new Blob([new Uint8Array(MAX_QUEUED_PHOTO_BYTES + 1)], { type: 'image/jpeg' });
        await expect(
            enqueuePhoto(store, { url: '/u', blob: big, fileName: 'p.jpg', fileType: 'image/jpeg', label: 'L' }),
        ).rejects.toBeInstanceOf(PhotoTooLargeError);
        expect(await store.all()).toHaveLength(0);
    });

    it('a blob at the cap is accepted (boundary)', async () => {
        const store = new InMemoryOutboxStore();
        const atCap = new Blob([new Uint8Array(MAX_QUEUED_PHOTO_BYTES)], { type: 'image/jpeg' });
        await enqueuePhoto(store, { url: '/u', blob: atCap, fileName: 'p.jpg', fileType: 'image/jpeg', label: 'L' });
        expect(await store.all()).toHaveLength(1);
    });

    it('a queued blob survives → replays as a multipart POST exactly once', async () => {
        const store = new InMemoryOutboxStore();
        const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
        const item = await enqueuePhoto(store, {
            url: '/journal/e1/files',
            blob,
            fileName: 'north.jpg',
            fileType: 'image/jpeg',
            label: 'L',
        });
        expect(isPhotoItem((await store.all())[0])).toBe(true);

        const calls: Array<{ url: string; init: Init }> = [];
        const fetchMock = jest.fn(async (url: string, init: Init) => {
            calls.push({ url, init });
            return fakeResponse(201);
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const res = await flushOutbox(store, fetchSender());

        expect(res).toMatchObject({ sent: 1, remaining: 0 });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const { url, init } = calls[0];
        expect(url).toBe('/journal/e1/files');
        expect(init.method).toBe('POST');
        expect(init.body).toBeInstanceOf(FormData);
        // Idempotency handle carried (server dedupes a replay to exactly-once).
        expect(init.headers?.['Idempotency-Key']).toBe(item.id);
        // No JSON content-type — the runtime sets the multipart boundary.
        expect(init.headers?.['Content-Type']).toBeUndefined();
        // The photo bytes made the trip under the `file` field.
        const sent = (init.body as FormData).get('file');
        expect(sent).toBeInstanceOf(File);
        expect((sent as File).name).toBe('north.jpg');
        expect((sent as File).type).toBe('image/jpeg');
        // Drained — not left to re-send.
        expect(await store.all()).toHaveLength(0);
    });

    it('a lost-response replay re-sends the SAME item id (dedupe handle is stable)', async () => {
        const store = new InMemoryOutboxStore();
        const blob = new Blob([new Uint8Array([9])], { type: 'image/jpeg' });
        const item = await enqueuePhoto(store, {
            url: '/f',
            blob,
            fileName: 'p.jpg',
            fileType: 'image/jpeg',
            label: 'L',
        });

        const seenKeys: string[] = [];
        let n = 0;
        global.fetch = jest.fn(async (_url: string, init: Init) => {
            seenKeys.push(String(init.headers?.['Idempotency-Key']));
            n += 1;
            return fakeResponse(n > 1 ? 201 : 503); // first 5xx (kept), then ok
        }) as unknown as typeof fetch;

        await flushOutbox(store, fetchSender()); // 503 → kept + attempts bumped
        expect(await store.all()).toHaveLength(1);
        expect((await store.all())[0].attempts).toBe(1);

        await flushOutbox(store, fetchSender()); // ok → removed
        expect(await store.all()).toHaveLength(0);

        // Same idempotency key on both attempts — the server sees at-least-once
        // delivery as exactly-once.
        expect(seenKeys).toEqual([item.id, item.id]);
    });
});
