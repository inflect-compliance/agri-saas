/**
 * Unit — КАИС OpenData client with an INJECTED fetch (no network).
 *
 * Simulates the verified wire protocol: GET landing (token + Set-Cookie) →
 * POST /Read with `target` (tree drill-down) → GET /Download. Asserts the walk
 * resolves an ЕКАТТЕ to its land-parcels ZIP, refuses ownership registers, and
 * carries the anti-forgery token + cookie on every call.
 */
import {
    CadastreOpenDataClient,
    CadastreOpenDataError,
    type KaisEntry,
} from '@/lib/cadastre/opendata-client';

const BASE = 'https://kais.example.test';
const TOKEN = 'tok-abc-123';

function dir(name: string, path: string, hasDirs = true): KaisEntry {
    return { Name: name, Path: path, Extension: '', IsDirectory: true, HasDirectories: hasDirs, Size: 0 };
}
function file(name: string, path: string, size = 100): KaisEntry {
    return { Name: name, Path: path, Extension: '.zip', IsDirectory: false, HasDirectories: false, Size: size, ModifiedUtc: '2026-07-09T19:00:00Z' };
}

// The tree: oblast → община → settlement "с. Тест (12345)" → files.
const TREE: Record<string, KaisEntry[]> = {
    '': [dir('област Тест', 'област Тест')],
    'област Тест': [dir('община Тест', 'област Тест/община Тест')],
    'област Тест/община Тест': [dir('с. Тест (12345)', 'област Тест/община Тест/с. Тест (12345)', false)],
    'област Тест/община Тест/с. Тест (12345)': [
        file('поземлени имоти', 'област Тест/община Тест/с. Тест (12345)/поземлени имоти.zip'),
        file('собственост ПИ', 'област Тест/община Тест/с. Тест (12345)/собственост ПИ.zip'),
    ],
};

const LAND_ZIP = Buffer.from('PK land-parcels');

function makeResponse(init: {
    ok?: boolean;
    status?: number;
    text?: string;
    json?: unknown;
    bytes?: Buffer;
    setCookie?: string;
}): Response {
    const headers = new Map<string, string>();
    if (init.bytes) headers.set('content-length', String(init.bytes.byteLength));
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        headers: {
            get: (k: string) => (k.toLowerCase() === 'set-cookie' ? init.setCookie ?? null : headers.get(k.toLowerCase()) ?? null),
            getSetCookie: () => (init.setCookie ? [init.setCookie] : []),
        },
        text: async () => init.text ?? '',
        json: async () => init.json,
        arrayBuffer: async () => {
            const b = init.bytes ?? Buffer.alloc(0);
            return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        },
    } as unknown as Response;
}

function makeFetch(spy: { calls: string[] }): typeof fetch {
    return (async (url: string | URL | Request, opts?: RequestInit) => {
        const u = String(url);
        spy.calls.push(u);
        if (u.endsWith('/bg/OpenData')) {
            return makeResponse({
                text: `<input name="__RequestVerificationToken" type="hidden" value="${TOKEN}" />`,
                setCookie: '.AspNetCore.Antiforgery.x=cookieval; path=/; httponly',
            });
        }
        if (u.endsWith('/bg/OpenData/Read')) {
            const body = String(opts?.body ?? '');
            const target = new URLSearchParams(body).get('target') ?? '';
            const entries = TREE[target] ?? [];
            return makeResponse({ json: entries });
        }
        if (u.includes('/bg/OpenData/Download')) {
            return makeResponse({ bytes: LAND_ZIP });
        }
        return makeResponse({ ok: false, status: 404 });
    }) as unknown as typeof fetch;
}

describe('CadastreOpenDataClient', () => {
    it('fetchIndex returns the top-level oblasti', async () => {
        const spy = { calls: [] as string[] };
        const client = new CadastreOpenDataClient({ baseUrl: BASE, fetchImpl: makeFetch(spy) });
        const index = await client.fetchIndex();
        expect(index).toHaveLength(1);
        expect(index[0].Name).toBe('област Тест');
    });

    it('fetchArchive resolves an ЕКАТТЕ to its land-parcels ZIP', async () => {
        const spy = { calls: [] as string[] };
        const client = new CadastreOpenDataClient({ baseUrl: BASE, fetchImpl: makeFetch(spy) });
        const archive = await client.fetchArchive('12345');
        expect(archive.ekatte).toBe('12345');
        expect(archive.sourcePath).toContain('поземлени имоти.zip');
        expect(archive.buffer.equals(LAND_ZIP)).toBe(true);
        expect(archive.sizeBytes).toBe(LAND_ZIP.byteLength);
    });

    it('NEVER downloads an ownership register (собственост)', async () => {
        const spy = { calls: [] as string[] };
        const client = new CadastreOpenDataClient({ baseUrl: BASE, fetchImpl: makeFetch(spy) });
        await client.fetchArchive('12345');
        const downloads = spy.calls.filter((c) => c.includes('/Download'));
        expect(downloads).toHaveLength(1);
        expect(downloads[0]).toContain(encodeURIComponent('поземлени имоти.zip'));
        expect(spy.calls.some((c) => c.includes(encodeURIComponent('собственост')))).toBe(false);
    });

    it('throws not_found for an ЕКАТТЕ absent from the tree', async () => {
        const spy = { calls: [] as string[] };
        const client = new CadastreOpenDataClient({ baseUrl: BASE, fetchImpl: makeFetch(spy) });
        await expect(client.fetchArchive('99999')).rejects.toBeInstanceOf(CadastreOpenDataError);
    });

    it('throws when the landing page has no anti-forgery token', async () => {
        const badFetch = (async (url: string | URL | Request) => {
            const u = String(url);
            if (u.endsWith('/bg/OpenData')) return makeResponse({ text: '<html>no token</html>' });
            return makeResponse({ json: [] });
        }) as unknown as typeof fetch;
        const client = new CadastreOpenDataClient({ baseUrl: BASE, fetchImpl: badFetch });
        await expect(client.fetchIndex()).rejects.toThrow(/token/i);
    });
});
