/**
 * POST /api/t/[tenantSlug]/locations/[id]/farm-record (PR2).
 * Mocks getTenantCtx + the generator; asserts the stream path returns
 * 200 + application/pdf with a Content-Disposition attachment.
 */
import { NextRequest } from 'next/server';
import { EventEmitter } from 'events';

const getTenantCtxMock = jest.fn();
const generateMock = jest.fn();

jest.mock('@/app-layer/context', () => ({
    __esModule: true,
    getTenantCtx: (...a: unknown[]) => getTenantCtxMock(...a),
}));

jest.mock('@/app-layer/reports/pdf/farm-record-diary', () => ({
    __esModule: true,
    generateFarmRecordDiaryPdf: (...a: unknown[]) => generateMock(...a),
}));

import { POST } from '@/app/api/t/[tenantSlug]/locations/[id]/farm-record/route';

/** Minimal PDFKit-doc stand-in: on end() it emits one chunk then 'end'. */
function fakeDoc(): PDFKit.PDFDocument {
    const d = new EventEmitter() as unknown as PDFKit.PDFDocument & EventEmitter;
    (d as unknown as { end: () => void }).end = () => {
        d.emit('data', Buffer.from('%PDF-1.4 fake dnevnik'));
        d.emit('end');
    };
    return d;
}

function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/t/acme/locations/loc-1/farm-record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /locations/:id/farm-record', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getTenantCtxMock.mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1', requestId: 'req' });
        generateMock.mockResolvedValue(fakeDoc());
    });

    test('streams application/pdf on the happy path', async () => {
        const res = await POST(makeRequest({ from: '2026-01-01', to: '2026-12-31' }), {
            params: Promise.resolve({ tenantSlug: 'acme', id: 'loc-1' }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/pdf');
        expect(res.headers.get('Content-Disposition')).toContain('dnevnik-loc-1.pdf');
        expect(generateMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ locationId: 'loc-1', from: '2026-01-01', to: '2026-12-31' }),
        );
    });

    test('rejects a body missing from/to (400)', async () => {
        const res = await POST(makeRequest({ from: '2026-01-01' }), {
            params: Promise.resolve({ tenantSlug: 'acme', id: 'loc-1' }),
        });
        expect(res.status).toBe(400);
    });
});
