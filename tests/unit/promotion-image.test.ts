/**
 * Promotion artwork (#12) — validation, scanning, storage.
 *
 * The reason this path scans at all: a promotion image is third-party artwork,
 * emailed to support by an outside company, rendered as an `<img>` in EVERY
 * tenant's feed. Neither existing precedent covers that — evidence uploads are
 * scanned asynchronously and gated at DOWNLOAD (which an `<img>` bypasses), and
 * avatars are not scanned at all.
 *
 * So the tests that matter are the refusals, and the ORDER of them: bytes must
 * be rejected before they are ever written.
 */
export {};

const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockHead = jest.fn();
const mockScanBuffer = jest.fn();
const mockPromotionUpdate = jest.fn();

jest.mock('@/lib/storage', () => ({
    getStorageProvider: () => ({
        write: (...a: unknown[]) => mockWrite(...a),
        delete: (...a: unknown[]) => mockDelete(...a),
        head: (...a: unknown[]) => mockHead(...a),
        readStream: () => ({ pipe: jest.fn() }),
    }),
}));
jest.mock('@/lib/storage/av-scan', () => ({ scanBuffer: (...a: unknown[]) => mockScanBuffer(...a) }));
jest.mock('@/lib/prisma', () => ({
    prisma: { promotion: { update: (...a: unknown[]) => mockPromotionUpdate(...a) } },
}));

const mockEnv: { AV_SCAN_MODE: string } = { AV_SCAN_MODE: 'strict' };
jest.mock('@/env', () => ({
    get env() {
        return mockEnv;
    },
}));

import {
    uploadPromotionImage,
    removePromotionImage,
    promotionImageStorageKey,
    promotionImageServeUrl,
    scanVerdictBlocks,
    PROMOTION_IMAGE_MAX_BYTES,
} from '@/lib/promotions/promotion-image';

/** Minimal buffer carrying the RIFF/WEBP magic number. */
function webpBuffer(size = 64): Buffer {
    const buf = Buffer.alloc(Math.max(size, 12));
    buf.write('RIFF', 0, 'ascii');
    buf.write('WEBP', 8, 'ascii');
    return buf;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.AV_SCAN_MODE = 'strict';
    mockScanBuffer.mockResolvedValue({ status: 'CLEAN', engine: 'clamav' });
    mockWrite.mockResolvedValue(undefined);
    mockPromotionUpdate.mockResolvedValue({});
});

describe('storage key and serve URL', () => {
    it('is a flat, NON-tenant key — the image belongs to every tenant', () => {
        // buildTenantObjectKey would demand a tenantId; a global catalogue has
        // none. Mirrors the `avatars/<id>.webp` precedent.
        expect(promotionImageStorageKey('p-1')).toBe('promotions/p-1.webp');
        expect(promotionImageStorageKey('p-1')).not.toContain('tenants/');
    });

    it('serves from a non-tenant route for the same reason', () => {
        expect(promotionImageServeUrl('p-1')).toBe('/api/promotions/p-1/image');
    });
});

describe('scanVerdictBlocks — the accept/reject policy', () => {
    it('refuses INFECTED in every mode', () => {
        for (const mode of ['strict', 'permissive', 'disabled']) {
            mockEnv.AV_SCAN_MODE = mode;
            expect(scanVerdictBlocks('INFECTED')).toMatch(/malware/i);
        }
    });

    it('refuses a scanner ERROR under strict — including an unconfigured scanner', () => {
        mockEnv.AV_SCAN_MODE = 'strict';
        expect(scanVerdictBlocks('ERROR')).toMatch(/unavailable/i);
    });

    it('allows a scanner ERROR under permissive', () => {
        mockEnv.AV_SCAN_MODE = 'permissive';
        expect(scanVerdictBlocks('ERROR')).toBeNull();
    });

    it('accepts CLEAN', () => {
        expect(scanVerdictBlocks('CLEAN')).toBeNull();
    });
});

describe('uploadPromotionImage — refusals happen BEFORE any write', () => {
    it('rejects an empty upload', async () => {
        await expect(uploadPromotionImage('p-1', Buffer.alloc(0))).rejects.toThrow(/empty/i);
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it('rejects an oversized upload', async () => {
        const tooBig = webpBuffer(PROMOTION_IMAGE_MAX_BYTES + 1);
        await expect(uploadPromotionImage('p-1', tooBig)).rejects.toThrow(/too large/i);
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it('rejects non-webp bytes — the canvas step was bypassed', async () => {
        // Rejecting rather than accepting is the point: non-webp means the
        // client never re-encoded, so the bytes may still carry EXIF/GPS.
        const jpegish = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
        await expect(uploadPromotionImage('p-1', jpegish)).rejects.toThrow(/WebP/i);
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it('does not even invoke the scanner on bytes that fail cheap checks', async () => {
        await expect(uploadPromotionImage('p-1', Buffer.alloc(0))).rejects.toThrow();
        expect(mockScanBuffer).not.toHaveBeenCalled();
    });

    it('rejects INFECTED bytes and never stores them', async () => {
        mockScanBuffer.mockResolvedValue({ status: 'INFECTED', engine: 'clamav' });

        await expect(uploadPromotionImage('p-1', webpBuffer())).rejects.toThrow(/malware/i);
        expect(mockWrite).not.toHaveBeenCalled();
        expect(mockPromotionUpdate).not.toHaveBeenCalled();
    });

    it('refuses to store when the scanner is unavailable under strict', async () => {
        // The failure mode this prevents: ClamAV down, so unscanned supplier
        // artwork silently reaches every tenant's feed.
        mockScanBuffer.mockResolvedValue({ status: 'ERROR', engine: 'none' });

        await expect(uploadPromotionImage('p-1', webpBuffer())).rejects.toThrow(/unavailable/i);
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it('stores under permissive even when the scanner errored', async () => {
        mockEnv.AV_SCAN_MODE = 'permissive';
        mockScanBuffer.mockResolvedValue({ status: 'ERROR', engine: 'none' });

        await uploadPromotionImage('p-1', webpBuffer());
        expect(mockWrite).toHaveBeenCalledTimes(1);
    });
});

describe('uploadPromotionImage — the happy path', () => {
    it('scans, writes as webp, and points mediaUrl at the serve route', async () => {
        const result = await uploadPromotionImage('p-1', webpBuffer());

        expect(mockScanBuffer).toHaveBeenCalledTimes(1);
        expect(mockWrite).toHaveBeenCalledWith(
            'promotions/p-1.webp',
            expect.any(Buffer),
            expect.objectContaining({ mimeType: 'image/webp' }),
        );
        expect(mockPromotionUpdate).toHaveBeenCalledWith({
            where: { id: 'p-1' },
            data: { mediaUrl: '/api/promotions/p-1/image' },
        });
        expect(result.mediaUrl).toBe('/api/promotions/p-1/image');
    });

    it('scans before writing, not after', async () => {
        const order: string[] = [];
        mockScanBuffer.mockImplementation(async () => {
            order.push('scan');
            return { status: 'CLEAN', engine: 'clamav' };
        });
        mockWrite.mockImplementation(async () => {
            order.push('write');
        });

        await uploadPromotionImage('p-1', webpBuffer());
        expect(order).toEqual(['scan', 'write']);
    });
});

describe('removePromotionImage', () => {
    it('clears mediaUrl even when the object is already gone', async () => {
        // Storage delete is best-effort; the feed reads mediaUrl, so clearing
        // it is the operation that actually matters.
        mockDelete.mockRejectedValue(new Error('no such key'));

        await removePromotionImage('p-1');
        expect(mockPromotionUpdate).toHaveBeenCalledWith({
            where: { id: 'p-1' },
            data: { mediaUrl: null },
        });
    });
});
