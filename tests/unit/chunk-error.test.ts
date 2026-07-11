/**
 * Unit tests for the ChunkLoadError matcher that drives the PWA's
 * reload-once recovery (see ServiceWorkerRegistrar).
 */
import { isChunkLoadError } from '@/lib/pwa/chunk-error';

describe('isChunkLoadError', () => {
    it('matches by error name', () => {
        expect(isChunkLoadError('anything', 'ChunkLoadError')).toBe(true);
    });

    it('matches the JS chunk-failure message', () => {
        expect(isChunkLoadError('Loading chunk 85600 failed.')).toBe(true);
        expect(isChunkLoadError('Loading chunk vendors-node_modules failed')).toBe(true);
    });

    it('matches the CSS chunk-failure message', () => {
        expect(isChunkLoadError('Loading CSS chunk 42 failed')).toBe(true);
    });

    it('ignores unrelated errors', () => {
        expect(isChunkLoadError('TypeError: x is not a function')).toBe(false);
        expect(isChunkLoadError('Network request failed', 'TypeError')).toBe(false);
        expect(isChunkLoadError('')).toBe(false);
    });
});
