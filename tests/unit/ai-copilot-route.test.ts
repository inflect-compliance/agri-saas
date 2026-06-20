/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks +
 * NextRequest shims mirror runtime contracts; per-line typing has poor
 * cost/benefit in route tests (codebase-standard file-level disable). */
/**
 * Copilot SSE route — unit tests (mocked provider/routing, NO network).
 *
 * Covers:
 *   (a) non-streaming fallback (stream:false → single JSON completion)
 *   (b) SSE streaming (stream:true → text/event-stream with data lines)
 *   (c) cancellation (client abort tears down + cancels upstream)
 *   (d) tier-gate denial surfaces as an error (403 via withApiErrorHandling)
 */

jest.mock('@/app-layer/context', () => ({
    getTenantCtx: jest.fn(),
}));

const mockCompleteWithRouting = jest.fn();
jest.mock('@/app-layer/ai/routing', () => ({
    completeWithRouting: (...args: any[]) => mockCompleteWithRouting(...args),
}));

import { POST } from '@/app/api/t/[tenantSlug]/ai/copilot/route';
import { getTenantCtx } from '@/app-layer/context';
import { getPermissionsForRole } from '@/lib/permissions';
import { forbidden } from '@/lib/errors/types';
import type { Role } from '@prisma/client';

const ctx = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    requestId: 'req-test',
    tenantSlug: 'acme',
    role: 'ADMIN' as Role,
    permissions: { canRead: true, canWrite: true, canAdmin: true, canAudit: true, canExport: true },
    appPermissions: getPermissionsForRole('ADMIN'),
};

function makeReq(body: unknown, signal?: AbortSignal): any {
    return {
        json: async () => body,
        signal: signal ?? new AbortController().signal,
        // headers/url touched by withApiErrorHandling internals
        headers: new Headers(),
        method: 'POST',
        url: 'http://test/api/t/acme/ai/copilot',
        nextUrl: { pathname: '/api/t/acme/ai/copilot', searchParams: new URLSearchParams() },
    };
}

const params = Promise.resolve({ tenantSlug: 'acme' });

async function readSse(res: Response): Promise<string> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
    }
    return out;
}

beforeEach(() => {
    jest.clearAllMocks();
    (getTenantCtx as jest.Mock).mockResolvedValue(ctx);
});

// ─── (a) non-streaming fallback ───

describe('non-streaming fallback', () => {
    it('returns a single JSON completion when stream:false', async () => {
        mockCompleteWithRouting.mockResolvedValueOnce({
            text: 'the answer',
            toolCalls: [{ id: 'c1', name: 'tool', arguments: '{}' }],
        });

        const res = await POST(makeReq({ task: 'copilot-chat', messages: [{ role: 'user', content: 'q' }], stream: false }), {
            params,
        } as any);

        expect(res.headers.get('Content-Type')).toContain('application/json');
        const body = await res.json();
        expect(body.text).toBe('the answer');
        expect(body.toolCalls).toEqual([{ id: 'c1', name: 'tool', arguments: '{}' }]);

        // Routed through completeWithRouting with the resolved ctx + task.
        const [passedCtx, task, opts] = mockCompleteWithRouting.mock.calls[0];
        expect(passedCtx).toBe(ctx);
        expect(task).toBe('copilot-chat');
        expect(opts.stream).toBeUndefined(); // non-stream path
    });
});

// ─── (b) SSE streaming ───

describe('SSE streaming', () => {
    it('streams the completion as text/event-stream with a done event', async () => {
        mockCompleteWithRouting.mockResolvedValueOnce({ text: 'streamed text' });

        const res = await POST(makeReq({ task: 'spray-explanation', messages: [{ role: 'user', content: 'explain' }] }), {
            params,
        } as any);

        expect(res.headers.get('Content-Type')).toContain('text/event-stream');
        const sse = await readSse(res);
        expect(sse).toContain(': connected');
        expect(sse).toContain('"type":"text"');
        expect(sse).toContain('streamed text');
        expect(sse).toContain('"type":"done"');

        // The provider call requested streaming.
        const [, , opts] = mockCompleteWithRouting.mock.calls[0];
        expect(opts.stream).toBe(true);
    });

    it('emits an error event when the completion fails (not aborted)', async () => {
        mockCompleteWithRouting.mockRejectedValueOnce(new Error('model exploded'));

        const res = await POST(makeReq({ messages: [{ role: 'user', content: 'q' }] }), { params } as any);
        const sse = await readSse(res);
        expect(sse).toContain('"type":"error"');
        expect(sse).toContain('model exploded');
    });
});

// ─── (c) cancellation ───

describe('cancellation', () => {
    it('threads the client abort signal into the provider call', async () => {
        const controller = new AbortController();
        mockCompleteWithRouting.mockResolvedValueOnce({ text: 'x' });

        const res = await POST(makeReq({ messages: [{ role: 'user', content: 'q' }] }, controller.signal), {
            params,
        } as any);
        await readSse(res);

        const [, , opts] = mockCompleteWithRouting.mock.calls[0];
        expect(opts.signal).toBe(controller.signal);
    });

    it('does NOT emit an error event when the failure is due to client abort', async () => {
        const controller = new AbortController();
        controller.abort();
        mockCompleteWithRouting.mockRejectedValueOnce(new Error('aborted'));

        const res = await POST(makeReq({ messages: [{ role: 'user', content: 'q' }] }, controller.signal), {
            params,
        } as any);
        const sse = await readSse(res);
        // Connected line is emitted, but no error event (client is gone).
        expect(sse).not.toContain('"type":"error"');
    });
});

// ─── (d) tier-gate denial ───

describe('tier-gate denial (non-streaming)', () => {
    it('surfaces a routing forbidden() as a 403 for stream:false', async () => {
        mockCompleteWithRouting.mockRejectedValueOnce(forbidden('ai_tier_not_allowed: FREE plan'));

        // withApiErrorHandling shapes the thrown ForbiddenError into a
        // 403 JSON response rather than throwing out of POST.
        const res = await POST(makeReq({ task: 'dosage-calc', messages: [{ role: 'user', content: 'q' }], stream: false }), {
            params,
        } as any);
        expect(res.status).toBe(403);
    });
});
