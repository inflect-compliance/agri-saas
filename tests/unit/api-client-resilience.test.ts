/**
 * Unit tests for the foreground fetch resilience (Roadmap-6 P4):
 * a Retry-After-aware error + an AbortSignal timeout on every request.
 */
import { apiGet, ApiClientError, parseRetryAfterSeconds, API_CLIENT_TIMEOUT_MS } from '@/lib/api-client';

interface MockResInit {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
}
function mockRes({ status, body = {}, headers = {} }: MockResInit): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers[k] ?? null },
        json: async () => body,
    } as unknown as Response;
}

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('parseRetryAfterSeconds', () => {
    it('reads the seconds form on a 429 / 503', () => {
        expect(parseRetryAfterSeconds(mockRes({ status: 429, headers: { 'Retry-After': '30' } }))).toBe(30);
        expect(parseRetryAfterSeconds(mockRes({ status: 503, headers: { 'Retry-After': '5' } }))).toBe(5);
    });
    it('is undefined when absent, unparseable, or on another status', () => {
        expect(parseRetryAfterSeconds(mockRes({ status: 429 }))).toBeUndefined();
        expect(parseRetryAfterSeconds(mockRes({ status: 429, headers: { 'Retry-After': 'soon' } }))).toBeUndefined();
        expect(parseRetryAfterSeconds(mockRes({ status: 500, headers: { 'Retry-After': '30' } }))).toBeUndefined();
    });
});

describe('apiGet resilience', () => {
    it('surfaces Retry-After on a 429 via ApiClientError.retryAfterSeconds', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            mockRes({ status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down' } }, headers: { 'Retry-After': '30' } }),
        ) as typeof global.fetch;
        await expect(apiGet('/api/x')).rejects.toMatchObject({
            name: 'ApiClientError',
            status: 429,
            retryAfterSeconds: 30,
        });
        await expect(apiGet('/api/x')).rejects.toBeInstanceOf(ApiClientError);
    });

    it('attaches an AbortSignal timeout when the caller passes none', async () => {
        const fetchMock = jest.fn().mockResolvedValue(mockRes({ status: 200, body: { ok: true } }));
        global.fetch = fetchMock as typeof global.fetch;
        await apiGet('/api/x');
        const init = fetchMock.mock.calls[0][1];
        expect(init.signal).toBeInstanceOf(AbortSignal);
        // Sanity: the timeout constant is a sane, non-trivial value.
        expect(API_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    });

    it("lets a caller's own signal win (override)", async () => {
        const fetchMock = jest.fn().mockResolvedValue(mockRes({ status: 200, body: { ok: true } }));
        global.fetch = fetchMock as typeof global.fetch;
        const controller = new AbortController();
        await apiGet('/api/x', undefined, { signal: controller.signal });
        expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    });
});
