/**
 * Detect a webpack lazy-chunk load failure.
 *
 * A dynamically-imported route/component chunk that fails to download —
 * flaky rural LTE, or a stale chunk hash after a deploy — surfaces as a
 * `ChunkLoadError` (or a `Loading chunk N failed` message). Sentry already
 * treats these as benign noise; the PWA additionally RECOVERS from them by
 * reloading once (see ServiceWorkerRegistrar), so an operator isn't stranded
 * on a half-rendered page mid-navigation.
 */
export function isChunkLoadError(message: string, name?: string): boolean {
    return (
        name === 'ChunkLoadError' ||
        /Loading (?:CSS )?chunk [\w-]+ failed/i.test(message)
    );
}
